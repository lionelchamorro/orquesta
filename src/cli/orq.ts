import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { AgentPool } from "../agents/pool";
import { Bus } from "../bus/bus";
import { Journal } from "../bus/journal";
import { PlanStore } from "../core/plan-store";
import type { Config, Plan } from "../core/types";
import { AskRouter } from "../daemon/ask-router";
import { createMcpHandler } from "../mcp/server";

const root = process.cwd();
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
    { role: "coder", cli: "claude", model: "claude-opus-4-7" },
    { role: "tester", cli: "claude", model: "claude-opus-4-7" },
    { role: "critic", cli: "claude", model: "claude-opus-4-7" },
    { role: "architect", cli: "claude", model: "claude-opus-4-7" },
    { role: "pm", cli: "claude", model: "claude-opus-4-7" },
    { role: "qa", cli: "claude", model: "claude-opus-4-7" },
  ],
});

const plannerMember = (config: Config) => config.team.find((member) => member.role === "planner") ?? config.team[0];

const clearPreviousTasks = () => {
  for (const relative of ["tasks", "subtasks", "iterations", "agents", "sessions"]) {
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
    runId: "run-1",
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
  const pool = new AgentPool(root, store, bus, { templatesDir });
  const askRouter = new AskRouter(store, pool, bus);
  let server: ReturnType<typeof Bun.serve> | null = null;

  try {
    const mcpHandler = createMcpHandler({ store, bus, askRouter, agentPool: pool });
    server = serveEphemeralMcp((req) => mcpHandler(req));

    const member = plannerMember(config);
    const prompt = `Initial user prompt:\n\n${plan.prompt}`;
    const agent = await pool.spawn("planner", member.cli, member.model, prompt, {
      command: member.command,
      port: server.port,
    });
    const summary = await waitForAgentCompletion(bus, pool, agent.id);
    const tasks = await ensurePlannerProducedTasks();
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
    console.log("Usage: orq <plan|approve|start|status>");
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
    try {
      const response = await fetch(daemonUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

  if (command === "approve") {
    const plan = await store.loadPlan();
    await store.savePlan({ ...plan, status: "approved", updated_at: new Date().toISOString() });
    console.log("Plan approved");
    return;
  }

  if (command === "start") {
    const proc = Bun.spawn(["bun", "run", "src/daemon/index.ts"], { stdout: "inherit", stderr: "inherit", stdin: "inherit" });
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

  console.log(`Unknown command: ${command}`);
};

if (import.meta.main) {
  await main();
}
