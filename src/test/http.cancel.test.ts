import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHttpHandler } from "../api/http";
import { Bus } from "../bus/bus";
import { PlanStore } from "../core/plan-store";

test("cancel task kills bound agents and publishes cancellation", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "orq-cancel-"));
  mkdirSync(path.join(root, ".orquesta", "crew", "tasks"), { recursive: true });
  mkdirSync(path.join(root, ".orquesta", "crew", "agents"), { recursive: true });
  await Bun.write(path.join(root, ".orquesta", "crew", "plan.json"), JSON.stringify({
    runId: "run-1", prd: "(prompt)", prompt: "x", status: "running", created_at: "a", updated_at: "a", task_count: 1, completed_count: 0, current_iteration: 1, max_iterations: 2,
  }));
  await Bun.write(path.join(root, ".orquesta", "crew", "tasks", "task-1.json"), JSON.stringify({
    id: "task-1", title: "Task", status: "running", depends_on: [], iteration: 1, created_at: "a", updated_at: "a", attempt_count: 0, subtasks: ["sub-1"],
  }));
  await Bun.write(path.join(root, ".orquesta", "crew", "agents", "agent-1.json"), JSON.stringify({
    id: "agent-1", role: "coder", cli: "claude", model: "m", status: "live", session_cwd: ".", bound_subtask: "sub-1",
  }));
  const store = new PlanStore(root);
  const killed: string[] = [];
  const seen: string[] = [];
  const bus = new Bus();
  bus.subscribe("task-1", (event) => {
    if (event.payload.type === "task_cancelled") seen.push(event.payload.taskId);
  });
  const handler = createHttpHandler({
    root,
    store,
    pool: { kill(agentId: string) { killed.push(agentId); }, write() {} } as never,
    bus,
    askRouter: { answer: async () => {} } as never,
    mcpHandler: async () => new Response("ok"),
  });
  const response = await handler(new Request("http://localhost/api/tasks/task-1/cancel", { method: "POST" }));
  expect(response.status).toBe(200);
  expect(killed).toEqual(["agent-1"]);
  expect(seen).toEqual(["task-1"]);
  expect((await store.loadTask("task-1")).status).toBe("cancelled");
  rmSync(root, { recursive: true, force: true });
});
