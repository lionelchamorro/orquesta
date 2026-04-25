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
