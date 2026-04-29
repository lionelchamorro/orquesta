import type { Task } from "../../core/types";

export type LayoutNode = { task: Task; depth: number };

export const layoutTasks = (tasks: Task[]): LayoutNode[] => {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const depthCache = new Map<string, number>();
  const resolveDepth = (task: Task, stack: Set<string>): number => {
    if (depthCache.has(task.id)) return depthCache.get(task.id)!;
    if (stack.has(task.id)) return 0;
    stack.add(task.id);
    const parents = task.depends_on
      .map((id) => byId.get(id))
      .filter((parent): parent is Task => Boolean(parent));
    const depth = parents.length === 0
      ? 0
      : 1 + Math.max(...parents.map((parent) => resolveDepth(parent, stack)));
    stack.delete(task.id);
    depthCache.set(task.id, depth);
    return depth;
  };
  const nodes = tasks.map((task) => ({ task, depth: resolveDepth(task, new Set()) }));
  return nodes.sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;
    return a.task.id.localeCompare(b.task.id, undefined, { numeric: true });
  });
};

export const flatTasks = (tasks: Task[]): LayoutNode[] =>
  tasks
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
    .map((task) => ({ task, depth: 0 }));
