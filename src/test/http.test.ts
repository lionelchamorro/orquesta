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
    runId: "run-1", prd: "(prompt)", prompt: "x", status: "running", created_at: "a", updated_at: "a", task_count: 1, completed_count: 0, current_iteration: 1, max_iterations: 2,
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

test("http handler returns 404 for missing task records", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "orq-http-missing-task-"));
  mkdirSync(path.join(root, ".orquesta", "crew"), { recursive: true });
  const store = new PlanStore(root);
  const handler = createHttpHandler({
    root,
    store,
    pool: { write() {} } as never,
    bus: new Bus(),
    askRouter: { answer: async () => {} } as never,
    mcpHandler: async () => new Response("ok"),
  });

  const response = await handler(new Request("http://localhost/api/tasks/task-missing"));

  expect(response.status).toBe(404);
  rmSync(root, { recursive: true, force: true });
});

test("http handler serves health and diagnostics", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "orq-http-diagnostics-"));
  mkdirSync(path.join(root, ".orquesta", "crew"), { recursive: true });
  await Bun.write(path.join(root, ".orquesta", "crew", "config.json"), JSON.stringify({
    git: { enabled: false, baseBranch: "main", autoCommit: true, removeWorktreeOnArchive: true },
  }));
  const store = new PlanStore(root);
  const handler = createHttpHandler({
    root,
    store,
    pool: { write() {} } as never,
    bus: new Bus(),
    askRouter: { answer: async () => {} } as never,
    mcpHandler: async () => new Response("ok"),
    sessionToken: "secret",
  });

  const health = await handler(new Request("http://localhost/api/health"));
  const diagnostics = await handler(new Request("http://localhost/api/diagnostics"));
  const exported = await handler(new Request("http://localhost/api/export"));
  const body = await diagnostics.json();
  const exportBody = await exported.json();

  expect(health.status).toBe(200);
  expect(body.ok).toBeTrue();
  expect(body.git.enabled).toBeFalse();
  expect(body.git.ready).toBeTrue();
  expect(body.token.configured).toBeTrue();
  expect(exportBody.plan.runId).toBe("run-1");
  rmSync(root, { recursive: true, force: true });
});

test("http health is degraded for non-git roots when git is enabled", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "orq-http-degraded-"));
  mkdirSync(path.join(root, ".orquesta", "crew"), { recursive: true });
  const store = new PlanStore(root);
  const handler = createHttpHandler({
    root,
    store,
    pool: { write() {} } as never,
    bus: new Bus(),
    askRouter: { answer: async () => {} } as never,
    mcpHandler: async () => new Response("ok"),
  });

  const health = await handler(new Request("http://localhost/api/health"));
  const body = await health.json();

  expect(health.status).toBe(503);
  expect(body.status).toBe("degraded");
  expect(body.reason).toContain("daemon root is not a git repository");
  rmSync(root, { recursive: true, force: true });
});
