import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PlanStore } from "../core/plan-store";
import { PlannerService } from "../daemon/planner-service";
import type { Agent } from "../core/types";

type SpawnCall = { role: string; cli: string; model: string; prompt: string; port?: number };

const makeFakePool = (store: PlanStore) => {
  const spawns: SpawnCall[] = [];
  const killed: string[] = [];
  const exitResolvers = new Map<string, (code: number) => void>();
  let counter = 0;

  const pool = {
    async spawn(role: string, cli: string, model: string, prompt: string, options: { port?: number } = {}) {
      counter += 1;
      const id = `agent-${counter}`;
      spawns.push({ role, cli, model, prompt, port: options.port });
      const agent: Agent = {
        id,
        role: role as Agent["role"],
        cli: cli as Agent["cli"],
        model,
        status: "live",
        session_cwd: ".",
      };
      await store.saveAgent(agent);
      return agent;
    },
    kill(agentId: string) {
      killed.push(agentId);
      const resolver = exitResolvers.get(agentId);
      if (resolver) {
        resolver(0);
        exitResolvers.delete(agentId);
      }
    },
    waitForExit(agentId: string) {
      return new Promise<number>((resolve) => {
        exitResolvers.set(agentId, resolve);
      });
    },
  };
  return { pool: pool as never, spawns, killed, triggerExit(agentId: string, code = 0) {
    const resolver = exitResolvers.get(agentId);
    if (resolver) { resolver(code); exitResolvers.delete(agentId); }
  } };
};

const makeStore = async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "orq-planner-"));
  mkdirSync(path.join(root, ".orquesta", "crew"), { recursive: true });
  return { root, store: new PlanStore(root) };
};

test("startPlanner scaffolds plan and spawns planner agent", async () => {
  const { root, store } = await makeStore();
  const { pool, spawns } = makeFakePool(store);
  const service = new PlannerService(store, pool, { mcpPort: 1234 });

  const result = await service.startPlanner("build a hello CLI");

  expect(result.runId).toBe("run-1");
  expect(spawns.length).toBe(1);
  expect(spawns[0].role).toBe("planner");
  expect(spawns[0].port).toBe(1234);
  expect(spawns[0].prompt).toContain("build a hello CLI");

  const plan = await store.loadPlan();
  expect(plan.status).toBe("drafting");
  expect(plan.prompt).toBe("build a hello CLI");
  expect(service.getCurrentAgentId()).toBe(result.agentId);
  rmSync(root, { recursive: true, force: true });
});

test("startPlanner is idempotent while planner is alive", async () => {
  const { root, store } = await makeStore();
  const { pool, spawns } = makeFakePool(store);
  const service = new PlannerService(store, pool, { mcpPort: 1234 });

  const first = await service.startPlanner("one");
  const second = await service.startPlanner("two");

  expect(spawns.length).toBe(1);
  expect(second.agentId).toBe(first.agentId);
  rmSync(root, { recursive: true, force: true });
});

test("reset kills active planner and clears tasks", async () => {
  const { root, store } = await makeStore();
  const { pool, killed } = makeFakePool(store);
  const service = new PlannerService(store, pool, { mcpPort: 1234 });

  const { agentId } = await service.startPlanner("seed");
  await store.saveTask({
    id: "task-1",
    title: "leftover",
    status: "pending",
    depends_on: [],
    iteration: 1,
    created_at: "a",
    updated_at: "a",
    attempt_count: 0,
    subtasks: [],
  });

  await service.reset();

  expect(killed).toContain(agentId);
  expect(service.getCurrentAgentId()).toBeNull();
  expect((await store.loadTasks()).length).toBe(0);
  const plan = await store.loadPlan();
  expect(plan.status).toBe("done");
  rmSync(root, { recursive: true, force: true });
});

test("planner exit with emitted tasks moves plan to awaiting_approval", async () => {
  const { root, store } = await makeStore();
  const { pool, triggerExit } = makeFakePool(store);
  const service = new PlannerService(store, pool, { mcpPort: 1234 });

  const { agentId } = await service.startPlanner("seed");
  await store.saveTask({
    id: "task-1",
    title: "A",
    status: "pending",
    depends_on: [],
    iteration: 1,
    created_at: "a",
    updated_at: "a",
    attempt_count: 0,
    subtasks: [],
  });

  triggerExit(agentId, 0);
  await new Promise((resolve) => setTimeout(resolve, 10));

  const plan = await store.loadPlan();
  expect(plan.status).toBe("awaiting_approval");
  expect(plan.task_count).toBe(1);
  expect(service.getCurrentAgentId()).toBeNull();
  rmSync(root, { recursive: true, force: true });
});
