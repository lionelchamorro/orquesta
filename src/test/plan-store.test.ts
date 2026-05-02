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
  expect((await store.loadSubtask("task-1", "sub-1")).status).toBe("cancelled");
  expect((await store.loadAgent("agent-1"))?.status).toBe("dead");
  rmSync(root, { recursive: true, force: true });
});

test("plan store recovery reopens tasks failed only because their subtask was interrupted", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "orquesta-recovery-failed-"));
  const store = new PlanStore(root);
  await store.savePlan({
    runId: "run-failed",
    prd: "p",
    prompt: "p",
    status: "failed",
    created_at: "a",
    updated_at: "a",
    task_count: 1,
    completed_count: 0,
    current_iteration: 1,
    max_iterations: 2,
  });
  await store.saveTask({
    id: "task-1",
    title: "Task",
    status: "failed",
    closure_reason: "failed_subtask",
    depends_on: [],
    iteration: 1,
    created_at: "x",
    updated_at: "y",
    completed_at: "y",
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

  const recovered = await store.recoverInterruptedRun();

  expect(recovered.tasks).toEqual(["task-1"]);
  expect(recovered.subtasks).toEqual(["sub-1"]);
  const task = await store.loadTask("task-1");
  expect(task.status).toBe("pending");
  expect(task.closure_reason).toBeUndefined();
  expect(task.completed_at).toBeUndefined();
  expect((await store.loadSubtask("task-1", "sub-1")).status).toBe("cancelled");
  expect((await store.loadPlan()).status).toBe("running");
  rmSync(root, { recursive: true, force: true });
});

test("plan store recovery cascades through blocked-by-dep descendants and bumps iteration cap", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "orquesta-recovery-cascade-"));
  const store = new PlanStore(root);
  await store.savePlan({
    runId: "run-cascade",
    prd: "p",
    prompt: "p",
    status: "failed",
    created_at: "a",
    updated_at: "a",
    task_count: 3,
    completed_count: 0,
    current_iteration: 2,
    max_iterations: 2,
  });
  await store.saveTask({
    id: "task-1",
    title: "Root",
    status: "failed",
    closure_reason: "failed_subtask",
    depends_on: [],
    iteration: 1,
    created_at: "x",
    updated_at: "y",
    completed_at: "y",
    attempt_count: 1,
    subtasks: ["sub-1"],
  });
  await store.saveTask({
    id: "task-2",
    title: "Mid",
    status: "blocked",
    closure_reason: "blocked_by_dep",
    depends_on: ["task-1"],
    iteration: 1,
    created_at: "x",
    updated_at: "y",
    completed_at: "y",
    attempt_count: 0,
    subtasks: [],
  });
  await store.saveTask({
    id: "task-3",
    title: "Leaf",
    status: "blocked",
    closure_reason: "blocked_by_dep",
    depends_on: ["task-2"],
    iteration: 1,
    created_at: "x",
    updated_at: "y",
    completed_at: "y",
    attempt_count: 0,
    subtasks: [],
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

  const recovered = await store.recoverInterruptedRun();

  expect(new Set(recovered.tasks)).toEqual(new Set(["task-1", "task-2", "task-3"]));
  for (const id of ["task-1", "task-2", "task-3"]) {
    const task = await store.loadTask(id);
    expect(task.status).toBe("pending");
    expect(task.closure_reason).toBeUndefined();
    expect(task.completed_at).toBeUndefined();
  }
  const plan = await store.loadPlan();
  expect(plan.status).toBe("running");
  expect(plan.max_iterations).toBe(3);
  rmSync(root, { recursive: true, force: true });
});

test("plan store config merges user team entries with default team by role", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "orquesta-config-merge-"));
  mkdirSync(path.join(root, ".orquesta", "crew"), { recursive: true });
  await Bun.write(
    path.join(root, ".orquesta", "crew", "config.json"),
    JSON.stringify({
      team: [
        { role: "coder", cli: "codex", model: "gpt-5.5" },
        { role: "qa", cli: "gemini", model: "gemini-2.5-pro" },
      ],
    }),
  );
  const store = new PlanStore(root);
  const config = await store.loadConfig();

  const byRole = new Map(config.team.map((member) => [member.role, member]));
  expect(byRole.get("coder")).toMatchObject({ role: "coder", cli: "codex", model: "gpt-5.5" });
  expect(byRole.get("qa")).toMatchObject({ role: "qa", cli: "gemini", model: "gemini-2.5-pro" });
  expect(byRole.get("architect")?.cli).toBe("claude");
  expect(byRole.get("pm")?.cli).toBe("claude");
  expect(byRole.get("tester")?.cli).toBe("claude");
  expect(byRole.get("critic")?.cli).toBe("claude");
  rmSync(root, { recursive: true, force: true });
});

test("plan store recovery unblocks descendants whose dep is already done", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "orquesta-recovery-stale-"));
  const store = new PlanStore(root);
  await store.savePlan({
    runId: "run-stale",
    prd: "p",
    prompt: "p",
    status: "failed",
    created_at: "a",
    updated_at: "a",
    task_count: 2,
    completed_count: 1,
    current_iteration: 2,
    max_iterations: 2,
  });
  await store.saveTask({
    id: "task-1",
    title: "Root",
    status: "done",
    closure_reason: "critic_ok",
    depends_on: [],
    iteration: 1,
    created_at: "x",
    updated_at: "y",
    completed_at: "y",
    attempt_count: 2,
    subtasks: [],
  });
  await store.saveTask({
    id: "task-2",
    title: "Leaf",
    status: "blocked",
    closure_reason: "blocked_by_dep",
    depends_on: ["task-1"],
    iteration: 1,
    created_at: "x",
    updated_at: "y",
    completed_at: "y",
    attempt_count: 0,
    subtasks: [],
  });

  const recovered = await store.recoverInterruptedRun();

  expect(recovered.tasks).toEqual(["task-2"]);
  expect((await store.loadTask("task-1")).status).toBe("done");
  expect((await store.loadTask("task-2")).status).toBe("pending");
  expect((await store.loadPlan()).status).toBe("running");
  expect((await store.loadPlan()).max_iterations).toBe(3);
  rmSync(root, { recursive: true, force: true });
});
