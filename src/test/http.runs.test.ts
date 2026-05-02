import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHttpHandler } from "../api/http";
import { Bus } from "../bus/bus";
import { PlanStore } from "../core/plan-store";

const makeHandler = async (options: { sessionToken?: string; planStatus?: string } = {}) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "orq-http-runs-"));
  mkdirSync(path.join(root, ".orquesta", "crew"), { recursive: true });
  await Bun.write(path.join(root, ".orquesta", "crew", "config.json"), JSON.stringify({
    git: { enabled: false, baseBranch: "main", autoCommit: false, removeWorktreeOnArchive: false },
  }));
  if (options.planStatus) {
    await Bun.write(path.join(root, ".orquesta", "crew", "plan.json"), JSON.stringify({
      runId: "run-existing",
      prd: "(prompt)",
      prompt: "existing",
      status: options.planStatus,
      created_at: "a",
      updated_at: "a",
      task_count: 1,
      completed_count: 0,
      current_iteration: 1,
      max_iterations: 1,
    }));
  }
  const store = new PlanStore(root);
  const handler = createHttpHandler({
    root,
    store,
    pool: { write() {}, kill() {} } as never,
    bus: new Bus(),
    askRouter: { answer: async () => {} } as never,
    mcpHandler: async () => new Response("ok"),
    sessionToken: options.sessionToken,
  });
  return { root, store, handler };
};

const body = (override: Record<string, unknown> = {}) => JSON.stringify({
  prompt: "build",
  tasks: [{ id: "task-a", title: "A" }],
  ...override,
});

test("POST /api/runs accepts a DAG submission and starts the run", async () => {
  const { root, store, handler } = await makeHandler();
  const response = await handler(new Request("http://localhost/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body(),
  }));

  expect(response.status).toBe(201);
  const payload = await response.json();
  expect(payload.ok).toBe(true);
  expect((await store.loadPlan()).status).toBe("running");

  rmSync(root, { recursive: true, force: true });
});

test("POST /api/runs requires token when configured", async () => {
  const { root, handler } = await makeHandler({ sessionToken: "secret" });
  const unauthorized = await handler(new Request("http://localhost/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body(),
  }));
  const authorized = await handler(new Request("http://localhost/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-orquesta-token": "secret" },
    body: body(),
  }));

  expect(unauthorized.status).toBe(401);
  expect(authorized.status).toBe(201);
  rmSync(root, { recursive: true, force: true });
});

test("POST /api/runs rejects active runs and invalid DAGs", async () => {
  const active = await makeHandler({ planStatus: "running" });
  const conflict = await active.handler(new Request("http://localhost/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body(),
  }));
  expect(conflict.status).toBe(409);
  rmSync(active.root, { recursive: true, force: true });

  const invalid = await makeHandler();
  const invalidId = await invalid.handler(new Request("http://localhost/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body({ tasks: [{ id: "Task 1", title: "bad" }] }),
  }));
  expect(invalidId.status).toBe(400);
  rmSync(invalid.root, { recursive: true, force: true });
});
