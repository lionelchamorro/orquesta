import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHttpHandler } from "../api/http";
import { Bus } from "../bus/bus";
import { PlanStore } from "../core/plan-store";

test("http handler serves run details", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "orq-http-"));
  mkdirSync(path.join(root, ".orquesta", "crew"), { recursive: true });
  await Bun.write(path.join(root, ".orquesta", "crew", "plan.json"), JSON.stringify({
    runId: "run-1", prd: "(prompt)", prompt: "x", status: "approved", created_at: "a", updated_at: "a", task_count: 1, completed_count: 0, current_iteration: 1, max_iterations: 2,
  }));
  await Bun.write(path.join(root, ".orquesta", "crew", "tasks", "task-1.json"), JSON.stringify({
    id: "task-1", title: "Task", status: "pending", depends_on: [], iteration: 1, created_at: "a", updated_at: "a", attempt_count: 0, subtasks: [],
  }));
  const store = new PlanStore(root);
  const handler = createHttpHandler({
    root,
    store,
    pool: { write() {} } as never,
    bus: new Bus(),
    askRouter: { answer: async () => {} } as never,
    mcpHandler: async () => new Response("ok"),
  });
  const response = await handler(new Request("http://localhost/api/runs/run-1"));
  const body = await response.json();
  expect(body.plan.runId).toBe("run-1");
  expect(body.tasks.length).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("http handler serves task history and archive listing", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "orq-http-history-"));
  mkdirSync(path.join(root, ".orquesta", "crew", "tasks"), { recursive: true });
  await Bun.write(path.join(root, ".orquesta", "crew", "plan.json"), JSON.stringify({
    runId: "run-1", prd: "(prompt)", prompt: "x", status: "done", created_at: "a", updated_at: "a", task_count: 1, completed_count: 1, current_iteration: 1, max_iterations: 1,
  }));
  await Bun.write(path.join(root, ".orquesta", "crew", "tasks", "task-1.json"), JSON.stringify({
    id: "task-1", title: "Task", status: "done", depends_on: [], iteration: 1, created_at: "a", updated_at: "a", attempt_count: 1, subtasks: [], archive_path: "/tmp/archive", merge_commit: "abc", closure_reason: "critic_ok",
  }));
  await Bun.write(path.join(root, ".orquesta", "crew", "tasks", "task-1.md"), "# history");
  const store = new PlanStore(root);
  const handler = createHttpHandler({
    root,
    store,
    pool: { write() {} } as never,
    bus: new Bus(),
    askRouter: { answer: async () => {} } as never,
    mcpHandler: async () => new Response("ok"),
  });
  const history = await handler(new Request("http://localhost/api/tasks/task-1/history"));
  const historyBody = await history.json();
  expect(historyBody.archive_path).toBe("/tmp/archive");
  const archive = await handler(new Request("http://localhost/api/archive"));
  const archiveBody = await archive.json();
  expect(archiveBody.length).toBe(1);
  rmSync(root, { recursive: true, force: true });
});
