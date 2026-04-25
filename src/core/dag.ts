import type { Subtask, Task, TaskStatus } from "./types";

const TERMINAL_STATUSES: TaskStatus[] = ["done", "failed", "blocked", "cancelled"];

export const isTerminal = (status: TaskStatus) => TERMINAL_STATUSES.includes(status);

export const readySet = (tasks: Task[]) => {
  const done = new Set(tasks.filter((task) => task.status === "done").map((task) => task.id));
  return tasks.filter(
    (task) =>
      task.status === "pending" &&
      task.depends_on.every((dependency) => done.has(dependency)),
  );
};

export const blockedByFailedDeps = (tasks: Task[]) => {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const isUnreachableDep = (depId: string): boolean => {
    const dep = byId.get(depId);
    if (!dep) return false;
    if (dep.status === "failed" || dep.status === "blocked" || dep.status === "cancelled") return true;
    return false;
  };
  return tasks.filter(
    (task) =>
      task.status === "pending" &&
      task.depends_on.some((dependency) => isUnreachableDep(dependency)),
  );
};

export const detectCycle = (tasks: Task[]) => {
  const graph = new Map(tasks.map((task) => [task.id, task.depends_on]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  const visit = (node: string): string[] | null => {
    if (visiting.has(node)) {
      const index = stack.indexOf(node);
      return [...stack.slice(index), node];
    }
    if (visited.has(node)) return null;
    visiting.add(node);
    stack.push(node);
    for (const dependency of graph.get(node) ?? []) {
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
    return null;
  };

  for (const task of tasks) {
    const cycle = visit(task.id);
    if (cycle) return cycle;
  }
  return null;
};

export const rollupStatus = (task: Task, subtasks: Subtask[]): TaskStatus => {
  if (subtasks.length === 0) return task.status;
  if (subtasks.some((subtask) => subtask.status === "failed")) return "failed";
  const last = subtasks[subtasks.length - 1];
  if (subtasks.every((subtask) => subtask.status === "done") && last.type === "critic" && !last.findings?.length) {
    return "done";
  }
  if (subtasks.some((subtask) => subtask.status === "running")) return "running";
  return task.status === "done" ? "running" : task.status;
};
