import { expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHttpHandler } from "../api/http";
import { Bus } from "../bus/bus";
import { PlanStore } from "../core/plan-store";

const makeRunningRun = async () => {
  const root = path.join(os.tmpdir(), `orq-run-cancel-${crypto.randomUUID()}`);
  mkdirSync(path.join(root, ".orquesta", "crew", "tasks"), { recursive: true });
  mkdirSync(path.join(root, ".orquesta", "crew", "agents"), { recursive: true });
  const store = new PlanStore(root);
  await store.savePlan({
    runId: "run-1",
    prd: "(prompt)",
    prompt: "x",
    status: "running",
    created_at: "a",
    updated_at: "a",
    task_count: 1,
    completed_count: 0,
    current_iteration: 1,
    max_iterations: 1,
  });
  await store.saveTask({
    id: "task-1",
    title: "Task",
    status: "running",
    depends_on: [],
    iteration: 1,
    created_at: "a",
    updated_at: "a",
    attempt_count: 0,
    subtasks: [],
  });
  await store.saveAgent({
    id: "agent-1",
    role: "coder",
    cli: "claude",
    model: "m",
    status: "live",
    session_cwd: ".",
  });
  return { root, store };
};

test("POST /api/runs/:id/cancel kills live agents and archives the run", async () => {
  const { root, store } = await makeRunningRun();
  const killed: string[] = [];
  const handler = createHttpHandler({
    root,
    store,
    pool: { kill(agentId: string) { killed.push(agentId); }, write() {} } as never,
    bus: new Bus(),
    askRouter: { answer: async () => {} } as never,
    mcpHandler: async () => new Response("ok"),
  });

  const response = await handler(new Request("http://localhost/api/runs/run-1/cancel", { method: "POST" }));
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.ok).toBe(true);
  expect(killed).toEqual(["agent-1"]);
  expect(existsSync(path.join(body.archive_path, "plan.json"))).toBe(true);
  expect(existsSync(path.join(body.archive_path, "tasks", "task-1.json"))).toBe(true);
  expect(existsSync(store.crewPath("plan.json"))).toBe(false);

  rmSync(root, { recursive: true, force: true });
});

test("GET /api/runs/archive lists archived runs", async () => {
  const { root, store } = await makeRunningRun();
  await store.archiveRun("cancelled", new Date("2026-05-02T00:00:00.000Z"));
  const handler = createHttpHandler({
    root,
    store,
    pool: { kill() {}, write() {} } as never,
    bus: new Bus(),
    askRouter: { answer: async () => {} } as never,
    mcpHandler: async () => new Response("ok"),
  });

  const response = await handler(new Request("http://localhost/api/runs/archive"));
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body).toHaveLength(1);
  expect(body[0].runId).toBe("run-1");
  expect(body[0].archive_path).toContain("run-1-cancelled-2026-05-02T00-00-00-000Z");

  rmSync(root, { recursive: true, force: true });
});
