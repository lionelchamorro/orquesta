import { mkdirSync } from "node:fs";
import path from "node:path";
import { AgentPool } from "../agents/pool";
import { Bus } from "../bus/bus";
import { Journal } from "../bus/journal";
import { createHttpHandler } from "../api/http";
import { createWebSocketHandlers } from "../api/ws";
import { PlanStore } from "../core/plan-store";
import { AskRouter } from "./ask-router";
import { IterationManager } from "./iteration-manager";
import { createMcpHandler } from "../mcp/server";
import { Orchestrator } from "./orchestrator";
import { PlannerService } from "./planner-service";
import { TaskPipeline } from "./task-pipeline";
import { getOrCreateSessionToken } from "../core/session-token";
import { ensureRepoReady } from "../core/git";

const root = process.cwd();
const packageRoot = path.resolve(import.meta.dir, "..", "..");
const templatesDir = path.join(packageRoot, "templates");
const store = new PlanStore(root);
mkdirSync(store.crewPath(), { recursive: true });
const sessionToken = await getOrCreateSessionToken(store);
const journal = new Journal(store.crewPath("journal.sqlite"));
const bus = new Bus({ journal });
const port = Number(Bun.env.ORQ_PORT ?? 8000);
const pool = new AgentPool(root, store, bus, { mcpPort: port, templatesDir, mcpToken: sessionToken });
const autonomous = Bun.env.ORQ_AUTONOMOUS === "1" || Bun.env.ORQ_AUTONOMOUS === "true";
const askRouter = new AskRouter(store, pool, bus, { autonomous });
const config = await store.loadConfig();
const userTeam = await Bun.file(store.crewPath("config.json")).json().then(
  (raw) => (Array.isArray(raw?.team) ? new Set(raw.team.map((m: { role: string }) => m.role)) : new Set<string>()),
  () => new Set<string>(),
);
const filledRoles = config.team.filter((member) => !userTeam.has(member.role)).map((member) => member.role);
console.log(
  `[daemon] team: ${config.team.map((member) => `${member.role}=${member.cli}/${member.model}`).join(" ")}`,
);
if (filledRoles.length > 0) {
  console.log(`[daemon] roles using defaults (not in config.json): ${filledRoles.join(", ")}`);
}
if (config.git?.enabled !== false && !ensureRepoReady(root, config.git?.baseBranch ?? "main")) {
  console.error(
    `[daemon] degraded: daemon root is not a git repository with base branch ${config.git?.baseBranch ?? "main"}; planning will be rejected until git is initialized or git.enabled=false is set`,
  );
}
const recovered = await store.recoverInterruptedRun();
const pipeline = new TaskPipeline(store, bus, pool, config);
const iterationManager = new IterationManager(store, pool, bus, config);
const orchestrator = new Orchestrator(store, pipeline, iterationManager, config);
const plannerService = new PlannerService(store, pool, { mcpPort: port, bus, autonomous });
const mcpHandler = createMcpHandler({ store, bus, askRouter, agentPool: pool, sessionToken });
const uiBuildDir = path.join(packageRoot, "dist", "ui");
await askRouter.recoverPendingAsks();
const httpHandler = createHttpHandler({
  root: packageRoot,
  store,
  pool,
  bus,
  askRouter,
  mcpHandler,
  plannerService,
  uiBuildDir,
  sessionToken,
  journal,
  corsOrigin: Bun.env.ORQ_CORS_ORIGIN,
});
const wsHandlers = createWebSocketHandlers(bus, pool, journal, {
  sessionToken,
  corsOrigin: Bun.env.ORQ_CORS_ORIGIN,
});

const server = Bun.serve({
  hostname: Bun.env.ORQ_HOST ?? "127.0.0.1",
  port,
  fetch(req, server) {
    if (wsHandlers.upgrade(req, server)) return;
    return httpHandler(req);
  },
  websocket: wsHandlers.websocket,
});

process.on("unhandledRejection", (reason) => {
  console.error("[daemon] unhandled rejection:", reason instanceof Error ? reason.stack ?? reason.message : reason);
});
process.on("uncaughtException", (error) => {
  console.error("[daemon] uncaught exception:", error.stack ?? error.message);
});

void orchestrator.run().catch((error) => {
  console.error("[daemon] orchestrator.run terminated:", error instanceof Error ? error.stack ?? error.message : error);
});

const shutdown = () => {
  orchestrator.stop();
  askRouter.close();
  for (const agentId of pool.list()) pool.kill(agentId);
  journal.close();
  server.stop();
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

console.log(`orquesta daemon listening on http://${server.hostname}:${port}`);
if (recovered.tasks.length || recovered.subtasks.length || recovered.agents.length) {
  console.log(
    `[daemon] recovered interrupted state tasks=${recovered.tasks.length} subtasks=${recovered.subtasks.length} agents=${recovered.agents.length}`,
  );
}
