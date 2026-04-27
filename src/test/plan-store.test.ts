import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PlanStore } from "../core/plan-store";
import type { Task } from "../core/types";

test("plan store loads defaults and saves tasks", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "orq-store-"));
  mkdirSync(path.join(root, ".orquesta", "crew"), { recursive: true });
  await Bun.write(
    path.join(root, ".orquesta", "crew", "plan.json"),
    JSON.stringify({ prompt: "x", prd: "(prompt)", created_at: "a", updated_at: "b", task_count: 0, completed_count: 0 }),
  );
  const store = new PlanStore(root);
  const plan = await store.loadPlan();
  expect(plan.runId).toBe("run-1");
  const task: Task = {
    id: "task-1",
    title: "Task",
    status: "pending",
    depends_on: [],
    iteration: 1,
    created_at: "x",
    updated_at: "y",
    attempt_count: 0,
    subtasks: [],
  };
  await store.saveTask(task);
  expect((await store.loadTask("task-1")).title).toBe("Task");
  rmSync(root, { recursive: true, force: true });
});

test("plan store rejects invalid persisted tasks", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "orq-store-invalid-"));
  mkdirSync(path.join(root, ".orquesta", "crew", "tasks"), { recursive: true });
  await Bun.write(path.join(root, ".orquesta", "crew", "tasks", "task-1.json"), JSON.stringify({
    id: "task-1",
    title: "Task",
    status: "nonsense",
    depends_on: [],
    iteration: 1,
    created_at: "x",
    updated_at: "y",
    attempt_count: 0,
    subtasks: [],
  }));
  const store = new PlanStore(root);

  await expect(store.loadTasks()).rejects.toThrow();
  rmSync(root, { recursive: true, force: true });
});

test("plan store enforces task transitions and recalculates counters", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "orq-store-transition-"));
  mkdirSync(path.join(root, ".orquesta", "crew"), { recursive: true });
  const store = new PlanStore(root);
  await store.savePlan({
    runId: "run-1",
    prd: "(prompt)",
    prompt: "x",
    status: "running",
    created_at: "a",
    updated_at: "a",
    task_count: 0,
    completed_count: 0,
    current_iteration: 1,
    max_iterations: 1,
  });
  await store.saveTask({
    id: "task-1",
    title: "Task",
    status: "pending",
    depends_on: [],
    iteration: 1,
    created_at: "x",
    updated_at: "y",
    attempt_count: 0,
    subtasks: [],
  });

  await expect(store.transitionTask("task-1", "done")).rejects.toThrow("Invalid status transition");
  await store.transitionTask("task-1", "running");
  await store.transitionTask("task-1", "done");

  const plan = await store.loadPlan();
  expect(plan.task_count).toBe(1);
  expect(plan.completed_count).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("plan store recovery resets orphaned running records to pending", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "orq-store-recover-"));
  mkdirSync(path.join(root, ".orquesta", "crew"), { recursive: true });
  const store = new PlanStore(root);
  await store.savePlan({
    runId: "run-1",
    prd: "(prompt)",
    prompt: "x",
    status: "running",
    created_at: "a",
    updated_at: "a",
    task_count: 0,
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
    created_at: "x",
    updated_at: "y",
    attempt_count: 1,
    subtasks: ["sub-1"],
  });
  await store.saveSubtask({
    id: "sub-1",
    taskId: "task-1",
    type: "code",
    role: "coder",
    status: "running",
    prompt: "x",
    depends_on: [],
    created_at: "x",
  });
  await store.saveAgent({
    id: "agent-1",
    role: "coder",
    cli: "claude",
    model: "m",
    status: "live",
    session_cwd: ".",
  });

  const recovered = await store.recoverInterruptedRun();

  expect(recovered).toEqual({ tasks: ["task-1"], subtasks: ["sub-1"], agents: ["agent-1"] });
  expect((await store.loadTask("task-1")).status).toBe("pending");
  expect((await store.loadSubtask("task-1", "sub-1")).status).toBe("failed");
  expect((await store.loadAgent("agent-1"))?.status).toBe("dead");
  rmSync(root, { recursive: true, force: true });
});
