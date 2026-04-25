import { expect, test } from "bun:test";
import { detectCycle, readySet, rollupStatus } from "../core/dag";
import type { Subtask, Task } from "../core/types";

const task = (id: string, depends_on: string[] = [], status: Task["status"] = "pending"): Task => ({
  id,
  title: id,
  status,
  depends_on,
  iteration: 1,
  created_at: "",
  updated_at: "",
  attempt_count: 0,
  subtasks: [],
});

test("readySet returns runnable tasks", () => {
  const tasks = [task("task-1", [], "done"), task("task-2", ["task-1"]), task("task-3", ["task-2"])];
  expect(readySet(tasks).map((item) => item.id)).toEqual(["task-2"]);
});

test("detectCycle finds loop", () => {
  const tasks = [task("task-1", ["task-2"]), task("task-2", ["task-1"])];
  expect(detectCycle(tasks)).toEqual(["task-1", "task-2", "task-1"]);
});

test("rollupStatus requires critic done without findings", () => {
  const subtasks: Subtask[] = [
    { id: "sub-1", taskId: "task-1", type: "code", role: "coder", status: "done", prompt: "", depends_on: [], created_at: "" },
    { id: "sub-2", taskId: "task-1", type: "critic", role: "critic", status: "done", prompt: "", depends_on: ["sub-1"], created_at: "", findings: [] },
  ];
  expect(rollupStatus(task("task-1"), subtasks)).toBe("done");
  expect(rollupStatus(task("task-1"), [{ ...subtasks[1], status: "failed" }])).toBe("failed");
});
