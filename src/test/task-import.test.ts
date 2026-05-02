import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHttpHandler } from "../api/http";
import { Bus } from "../bus/bus";
import { PlanStore } from "../core/plan-store";
import { importTasks } from "../daemon/task-import";

const tmpRoot = (label: string) => {
  const root = mkdtempSync(path.join(os.tmpdir(), `orq-import-${label}-`));
  mkdirSync(path.join(root, ".orquesta", "crew"), { recursive: true });
  // Disable git for tmp roots so the import endpoint readiness gate passes.
  Bun.write(
    path.join(root, ".orquesta", "crew", "config.json"),
    JSON.stringify({
      dependencies: "strict",
      concurrency: { workers: 1, max: 1 },
      review: { enabled: false, maxIterations: 1 },
      work: { maxAttemptsPerTask: 1, maxWaves: 1, maxIterations: 1 },
      git: { enabled: false, baseBranch: "main", autoCommit: false, removeWorktreeOnArchive: false },
      team: [{ role: "coder", cli: "codex", model: "gpt-5.5" }],
    }),
  );
  return root;
};

test("importTasks happy path writes plan, tasks, and iteration-1 atomically", async () => {
  const root = tmpRoot("happy");
  const store = new PlanStore(root);

  const result = await importTasks(store, {
    prompt: "imported plan",
    tasks: [
      { id: "task-1", title: "first" },
      { id: "task-2", title: "second", depends_on: ["task-1"] },
    ],
  });

  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("unreachable");

  const plan = await store.loadPlan();
  expect(plan.runId).toBe(result.runId);
  expect(plan.status).toBe("running");
  expect(plan.current_iteration).toBe(1);
  expect(plan.task_count).toBe(2);
  expect(plan.prompt).toBe("imported plan");

  const tasks = await store.loadTasks();
  expect(tasks.map((task) => task.id).sort()).toEqual(["task-1", "task-2"]);
  expect(tasks.find((task) => task.id === "task-2")?.depends_on).toEqual(["task-1"]);
  expect(tasks.every((task) => task.iteration === 1)).toBe(true);
  expect(tasks.every((task) => task.status === "pending")).toBe(true);

  const iterations = await store.loadIterations();
  expect(iterations.length).toBe(1);
  expect(iterations[0].number).toBe(1);
  expect(iterations[0].runId).toBe(plan.runId);
  expect(iterations[0].task_ids.sort()).toEqual(["task-1", "task-2"]);

  rmSync(root, { recursive: true, force: true });
});

test("importTasks rejects cycles without writing partial state", async () => {
  const root = tmpRoot("cycle");
  const store = new PlanStore(root);
  const result = await importTasks(store, {
    prompt: "x",
    tasks: [
      { id: "task-1", title: "a", depends_on: ["task-2"] },
      { id: "task-2", title: "b", depends_on: ["task-1"] },
    ],
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("unreachable");
  expect(result.error.code).toBe("cycle_detected");
  expect(await store.loadTasks()).toEqual([]);
  expect(await store.loadIterations()).toEqual([]);
  rmSync(root, { recursive: true, force: true });
});

test("importTasks rejects missing dependencies", async () => {
  const root = tmpRoot("missing-dep");
  const store = new PlanStore(root);
  const result = await importTasks(store, {
    prompt: "x",
    tasks: [{ id: "task-1", title: "a", depends_on: ["task-99"] }],
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("unreachable");
  expect(result.error.code).toBe("missing_dependency");
  expect(await store.loadTasks()).toEqual([]);
  rmSync(root, { recursive: true, force: true });
});

test("importTasks rejects when a run is in progress", async () => {
  const root = tmpRoot("running");
  const store = new PlanStore(root);
  await store.savePlan({
    runId: "run-1",
    prd: "(prompt)",
    prompt: "",
    status: "running",
    created_at: "a",
    updated_at: "a",
    task_count: 0,
    completed_count: 0,
    current_iteration: 1,
    max_iterations: 1,
  });
  const result = await importTasks(store, {
    prompt: "x",
    tasks: [{ id: "task-1", title: "a" }],
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("unreachable");
  expect(result.error.code).toBe("run_in_progress");
  // plan unchanged
  expect((await store.loadPlan()).runId).toBe("run-1");
  rmSync(root, { recursive: true, force: true });
});

test("POST /api/tasks/import returns 401 without token, 200 with token", async () => {
  const root = tmpRoot("http");
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
  const body = JSON.stringify({ prompt: "x", tasks: [{ id: "task-1", title: "a" }] });

  const unauth = await handler(new Request("http://localhost/api/tasks/import", { method: "POST", headers: { "Content-Type": "application/json" }, body }));
  expect(unauth.status).toBe(401);

  const ok = await handler(new Request("http://localhost/api/tasks/import", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-orquesta-token": "secret" },
    body,
  }));
  expect(ok.status).toBe(200);
  const okBody = await ok.json();
  expect(okBody.ok).toBe(true);
  expect(typeof okBody.runId).toBe("string");

  rmSync(root, { recursive: true, force: true });
});

test("POST /api/tasks/import returns 409 when a run is in progress", async () => {
  const root = tmpRoot("http-conflict");
  const store = new PlanStore(root);
  await store.savePlan({
    runId: "run-1",
    prd: "(prompt)",
    prompt: "",
    status: "running",
    created_at: "a",
    updated_at: "a",
    task_count: 0,
    completed_count: 0,
    current_iteration: 1,
    max_iterations: 1,
  });
  const handler = createHttpHandler({
    root,
    store,
    pool: { write() {} } as never,
    bus: new Bus(),
    askRouter: { answer: async () => {} } as never,
    mcpHandler: async () => new Response("ok"),
  });
  const response = await handler(new Request("http://localhost/api/tasks/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "x", tasks: [{ id: "task-1", title: "a" }] }),
  }));
  expect(response.status).toBe(409);
  const body = await response.json();
  expect(body.error.code).toBe("run_in_progress");
  rmSync(root, { recursive: true, force: true });
});

test("importTasks overwrites a previous terminal run", async () => {
  const root = tmpRoot("overwrite");
  const store = new PlanStore(root);
  await store.savePlan({
    runId: "run-old",
    prd: "(prompt)",
    prompt: "",
    status: "done",
    created_at: "a",
    updated_at: "a",
    task_count: 1,
    completed_count: 1,
    current_iteration: 1,
    max_iterations: 1,
  });
  await store.saveTask({
    id: "task-99",
    title: "stale",
    status: "done",
    depends_on: [],
    iteration: 1,
    created_at: "a",
    updated_at: "a",
    attempt_count: 0,
    subtasks: [],
  });
  const result = await importTasks(store, {
    prompt: "fresh",
    tasks: [{ id: "task-1", title: "a" }],
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  const tasks = await store.loadTasks();
  expect(tasks.map((t) => t.id)).toEqual(["task-1"]);
  expect((await store.loadPlan()).runId).toBe(result.runId);
  rmSync(root, { recursive: true, force: true });
});
