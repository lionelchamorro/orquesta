import { existsSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";
import { AgentPool } from "../agents/pool";
import { Bus } from "../bus/bus";
import { Journal } from "../bus/journal";
import { gitAvailable, isGitRepo, safeGitOutput } from "../core/git";
import { newRunId } from "../core/ids";
import { PlanStore } from "../core/plan-store";
import { getOrCreateSessionToken } from "../core/session-token";
import type { Config, Plan } from "../core/types";
import { AskRouter } from "../daemon/ask-router";
import { importTasks, readRunSource } from "../daemon/task-import";
import { createMcpHandler } from "../mcp/server";

const root = process.cwd();

function resolveDaemonEntry(): string {
  const fromSource = path.resolve(import.meta.dir, "..", "daemon", "index.ts");
  if (existsSync(fromSource)) return fromSource;
  const binDir = path.dirname(realpathSync(process.execPath));
  return path.join(binDir, "..", "src", "daemon", "index.ts");
}

const templatesDir = path.resolve(import.meta.dir, "..", "..", "templates");
const store = new PlanStore(root);
const PLANNER_TIMEOUT_MS = Number(Bun.env.ORQ_PLANNER_TIMEOUT_MS ?? 300_000);

const defaultConfig = (): Config => ({
  dependencies: "strict",
  concurrency: { workers: 2, max: 4 },
  review: { enabled: true, maxIterations: 2 },
  work: { maxAttemptsPerTask: 3, maxWaves: 50, maxIterations: 2 },
  team: [
    { role: "planner", cli: "claude", model: "claude-opus-4-7" },
    { role: "coder", cli: "codex", model: "gpt-5.5" },
    { role: "tester", cli: "claude", model: "claude-opus-4-7" },
    { role: "critic", cli: "claude", model: "claude-opus-4-7" },
    { role: "architect", cli: "claude", model: "claude-opus-4-7" },
    { role: "pm", cli: "claude", model: "claude-opus-4-7" },
    { role: "qa", cli: "claude", model: "claude-opus-4-7" },
  ],
});

const plannerMember = (config: Config) => config.team.find((member) => member.role === "planner") ?? config.team[0];

const clearPreviousTasks = () => {
  for (const relative of ["tasks", "subtasks", "iterations", "agents", "sessions", "worktrees", "asks"]) {
    rmSync(store.crewPath(relative), { recursive: true, force: true });
    mkdirSync(store.crewPath(relative), { recursive: true });
  }
  rmSync(store.crewPath("journal.sqlite"), { force: true });
  rmSync(store.crewPath("journal.sqlite-shm"), { force: true });
  rmSync(store.crewPath("journal.sqlite-wal"), { force: true });
};

const ensurePlanScaffold = async (prompt: string) => {
  const now = new Date().toISOString();
  const plan: Plan = {
    runId: newRunId(),
    prd: "(prompt)",
    prompt,
    status: "drafting",
    created_at: now,
    updated_at: now,
    task_count: 0,
    completed_count: 0,
    current_iteration: 1,
    max_iterations: 2,
  };
  clearPreviousTasks();
  await store.savePlan(plan);
  await store.saveConfig(await store.loadConfig().catch(() => defaultConfig()));
  return plan;
};

const printStatus = async () => {
  const plan = await store.loadPlan();
  const tasks = await store.loadTasks();
  console.log(`Run ${plan.runId} - ${plan.status} - iteration ${plan.current_iteration}/${plan.max_iterations}`);
  for (const task of tasks) {
    console.log(`${task.id} [${task.status}] ${task.title}`);
  }
};

export const waitForAgentCompletion = (bus: Bus, pool: AgentPool, agentId: string) =>
  new Promise<string>((resolve, reject) => {
    let settled = false;
    const unsubscribe = bus.subscribe(agentId, (event) => {
      if (event.payload.type === "agent_completed" && event.payload.agentId === agentId) {
        settled = true;
        clearTimeout(timeout);
        unsubscribe();
        resolve(event.payload.summary);
      }
      if (event.payload.type === "tasks_emitted") {
        settled = true;
        clearTimeout(timeout);
        unsubscribe();
        resolve(`Planner emitted ${event.payload.taskIds.length} task${event.payload.taskIds.length === 1 ? "" : "s"}.`);
      }
    });
    const timeout = setTimeout(() => {
      settled = true;
      unsubscribe();
      reject(new Error(`Timed out waiting for agent ${agentId}`));
    }, PLANNER_TIMEOUT_MS);
    void pool.waitForExit(agentId).then(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      unsubscribe();
      reject(new Error(`Agent ${agentId} exited before completion`));
    });
  });

const isMissedPlannerCompletion = (error: unknown, agentId: string) =>
  error instanceof Error && error.message === `Agent ${agentId} exited before completion`;

export const waitForPlannerCompletionOrTasks = async (
  bus: Bus,
  pool: AgentPool,
  agentId: string,
  loadTasks: () => Promise<unknown[]>,
) => {
  try {
    return await waitForAgentCompletion(bus, pool, agentId);
  } catch (error) {
    const tasks = await loadTasks();
    if (tasks.length === 0 || !isMissedPlannerCompletion(error, agentId)) throw error;
    return "";
  }
};

const serveEphemeralMcp = (handler: (req: Request) => Promise<Response>) => {
  return Bun.serve({ port: 0, fetch: handler });
};

const ensurePlannerProducedTasks = async () => {
  const tasks = await store.loadTasks();
  if (tasks.length === 0) {
    throw new Error("Planner completed without emitting tasks");
  }
  return tasks;
};

export const runPlanner = async (plan: Plan, config: Config) => {
  const journal = new Journal(store.crewPath("journal.sqlite"));
  const bus = new Bus({ journal });
  const sessionToken = await getOrCreateSessionToken(store);
  const pool = new AgentPool(root, store, bus, { templatesDir, mcpToken: sessionToken });
  const askRouter = new AskRouter(store, pool, bus);
  let server: ReturnType<typeof Bun.serve> | null = null;

  try {
    const mcpHandler = createMcpHandler({ store, bus, askRouter, agentPool: pool, sessionToken });
    server = serveEphemeralMcp((req) => mcpHandler(req));

    const member = plannerMember(config);
    const prompt = `Initial user prompt:\n\n${plan.prompt}`;
    const agent = await pool.spawn("planner", member.cli, member.model, prompt, {
      command: member.command,
      port: server.port,
    });
    const summary = await waitForPlannerCompletionOrTasks(bus, pool, agent.id, () => store.loadTasks());
    const tasks = await ensurePlannerProducedTasks();
    pool.kill(agent.id);
    await store.savePlan({
      ...plan,
      task_count: tasks.length,
      updated_at: new Date().toISOString(),
      status: "awaiting_approval",
    });
    return { tasks, summary };
  } finally {
    askRouter.close();
    journal.close();
    server?.stop();
  }
};

export const main = async () => {
  const [command, ...rest] = Bun.argv.slice(2);
  if (!command) {
    console.log("Usage: orq <plan|import|approve|start|status|logs|doctor>");
    return;
  }

  if (command === "plan") {
    const prompt = rest.join(" ").trim();
    if (!prompt) {
      console.log("Usage: orq plan <prompt>");
      return;
    }
    const daemonPort = Number(Bun.env.ORQ_PORT ?? 8000);
    const daemonUrl = `http://localhost:${daemonPort}/api/plan`;
    const sessionToken = await Bun.file(store.crewPath("session.token")).text().then((text) => text.trim()).catch(() => "");
    try {
      const response = await fetch(daemonUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(sessionToken ? { "X-Orquesta-Token": sessionToken } : {}) },
        body: JSON.stringify({ prompt }),
      });
      if (response.ok) {
        const body = await response.json();
        console.log(`Planner started via daemon: agentId=${body.agentId} runId=${body.runId}`);
        console.log(`Open http://localhost:${daemonPort}/ to chat with the planner.`);
        return;
      }
      const body = await response.json().catch(() => ({}));
      console.error(`Daemon rejected plan request (${response.status}): ${body.error ?? "unknown error"}`);
      return;
    } catch {
      console.log(`Daemon not reachable on :${daemonPort}. Running planner standalone…`);
      const plan = await ensurePlanScaffold(prompt);
      const config = await store.loadConfig().catch(() => defaultConfig());
      await runPlanner(plan, config);
      await printStatus();
      return;
    }
  }

  if (command === "import") {
    const file = rest[0];
    if (!file) {
      console.log("Usage: orq import <file>");
      return;
    }
    const filePath = path.resolve(root, file);
    const fileHandle = Bun.file(filePath);
    if (!(await fileHandle.exists())) {
      console.error(`Import file not found: ${filePath}`);
      process.exitCode = 1;
      return;
    }
    const payload = await fileHandle.json().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to parse ${filePath}: ${message}`);
      process.exitCode = 1;
      return null;
    });
    if (payload === null) return;

    const daemonPort = Number(Bun.env.ORQ_PORT ?? 8000);
    const sessionToken = await Bun.file(store.crewPath("session.token")).text().then((text) => text.trim()).catch(() => "");
    try {
      const response = await fetch(`http://localhost:${daemonPort}/api/tasks/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(sessionToken ? { "X-Orquesta-Token": sessionToken } : {}) },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok) {
        console.log(`Imported via daemon: runId=${body.runId}`);
        return;
      }
      console.error(`Daemon rejected import (${response.status}): ${body.error?.message ?? body.error ?? "unknown error"}`);
      process.exitCode = 1;
      return;
    } catch {
      console.log(`Daemon not reachable on :${daemonPort}. Importing in-process…`);
      const result = await importTasks(store, payload);
      if (!result.ok) {
        console.error(`Import failed (${result.error.code}): ${result.error.message}`);
        process.exitCode = 1;
        return;
      }
      console.log(`Imported in-process: runId=${result.runId}`);
      return;
    }
  }

  if (command === "approve") {
    const plan = await store.loadPlan();
    await store.savePlan({ ...plan, status: "approved", updated_at: new Date().toISOString() });
    console.log("Plan approved");
    return;
  }

  if (command === "start") {
    const daemonEntry = resolveDaemonEntry();
    const proc = Bun.spawn(["bun", "run", daemonEntry], { stdout: "inherit", stderr: "inherit", stdin: "inherit" });
    await proc.exited;
    return;
  }

  if (command === "status") {
    await printStatus();
    return;
  }

  if (command === "logs") {
    const journal = new Journal(store.crewPath("journal.sqlite"));
    for (const event of journal.query({ limit: 25 })) {
      console.log(`${event.ts} ${event.payload.type} ${event.tags.join(",")}`);
    }
    journal.close();
    return;
  }

  if (command === "doctor") {
    const plan = await store.loadPlan();
    const tasks = await store.loadTasks();
    const tokenExists = await Bun.file(store.crewPath("session.token")).exists();
    console.log(`Bun: ${Bun.version}`);
    console.log(`Git available: ${gitAvailable() ? "yes" : "no"}`);
    console.log(`Git repo: ${isGitRepo(root) ? "yes" : "no"}`);
    console.log(`Branch: ${safeGitOutput(root, ["branch", "--show-current"]).trim() || "-"}`);
    console.log(`Dirty: ${safeGitOutput(root, ["status", "--porcelain"]).trim() ? "yes" : "no"}`);
    console.log(`CLIs: claude=${Bun.which("claude") ? "yes" : "no"} codex=${Bun.which("codex") ? "yes" : "no"} gemini=${Bun.which("gemini") ? "yes" : "no"}`);
    console.log(`Session token: ${tokenExists ? "present" : "missing"}`);
    console.log(`Crew dir: ${store.crewPath()}`);
    console.log(`Plan: ${plan.runId} ${plan.status} tasks=${tasks.length} completed=${tasks.filter((task) => task.status === "done").length}`);
    console.log(`Imported-run support: ok`);
    console.log(`Run source: ${await readRunSource(store)}`);
    return;
  }

  if (!command) {
    console.log("Usage: orq <plan|import|approve|start|status|logs|doctor>");
    return;
  }

  console.log(`Unknown command: ${command}`);
};

if (import.meta.main) {
  await main();
}
