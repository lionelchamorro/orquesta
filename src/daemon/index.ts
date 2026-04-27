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
const askRouter = new AskRouter(store, pool, bus);
const config = await store.loadConfig();
const recovered = await store.recoverInterruptedRun();
const pipeline = new TaskPipeline(store, bus, pool, config);
const iterationManager = new IterationManager(store, pool, bus, config);
const orchestrator = new Orchestrator(store, pipeline, iterationManager, config);
const plannerService = new PlannerService(store, pool, { mcpPort: port });
const mcpHandler = createMcpHandler({ store, bus, askRouter, agentPool: pool, sessionToken });
const uiBuildDir = path.join(root, ".orquesta", "build", "ui");
mkdirSync(uiBuildDir, { recursive: true });
const uiBuild = await Bun.build({
  entrypoints: [path.join(packageRoot, "src", "ui", "main.tsx")],
  outdir: path.join(uiBuildDir, "assets"),
  target: "browser",
  splitting: false,
  minify: false,
});
if (!uiBuild.success) {
  console.error("ui build failed", uiBuild.logs);
  process.exit(1);
}
await Bun.write(
  path.join(uiBuildDir, "index.html"),
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Orquesta</title>
    <link rel="stylesheet" href="/theme.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/assets/main.js"></script>
  </body>
</html>`,
);
await askRouter.recoverPendingAsks();
const httpHandler = createHttpHandler({ root: packageRoot, store, pool, bus, askRouter, mcpHandler, plannerService, uiBuildDir, sessionToken, journal });
const wsHandlers = createWebSocketHandlers(bus, pool, journal, { sessionToken });

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
