import { useMemo, useState } from "react";
import type { Agent, Role, Subtask, Task } from "../../core/types";

const statusEndIcon = (status: Task["status"]) => {
  if (status === "done") return "✓";
  if (status === "running") return "◐";
  if (status === "failed") return "✕";
  if (status === "cancelled") return "⊘";
  if (status === "ready") return "✎";
  return "";
};

const roleGlyph: Record<Role, string> = {
  planner: "✦",
  coder: "⌘",
  tester: "✓",
  critic: "⚑",
  architect: "◫",
  pm: "☰",
  qa: "⟲",
};

type LayoutNode = { task: Task; depth: number };

const layoutTasks = (tasks: Task[]): LayoutNode[] => {
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

const flatTasks = (tasks: Task[]): LayoutNode[] =>
  tasks
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
    .map((task) => ({ task, depth: 0 }));

export function TasksPanel({
  tasks,
  subtasks,
  agents,
  iterationNumber,
  selectedTaskId,
  onSelect,
}: {
  tasks: Task[];
  subtasks: Subtask[];
  agents: Agent[];
  iterationNumber: number;
  selectedTaskId?: string;
  onSelect: (taskId: string) => void;
}) {
  const [viewMode, setViewMode] = useState<"tree" | "list">("tree");
  const nodes = useMemo(
    () => (viewMode === "tree" ? layoutTasks(tasks) : flatTasks(tasks)),
    [tasks, viewMode],
  );

  const roleByTaskId = useMemo(() => {
    const agentByKey = new Map<string, Agent>();
    for (const agent of agents) {
      if (!agent.bound_subtask) continue;
      const taskId = agent.bound_task;
      if (!taskId) continue;
      agentByKey.set(`${taskId}:${agent.bound_subtask}`, agent);
    }
    const byTask = new Map<string, Role>();
    for (const task of tasks) {
      const live = task.subtasks
        .map((id) => subtasks.find((sub) => sub.id === id && sub.taskId === task.id))
        .filter((sub): sub is Subtask => Boolean(sub));
      const running = live.find((sub) => {
        const agent = agentByKey.get(`${task.id}:${sub.id}`);
        return agent && agent.status !== "dead";
      });
      const latest = running ?? live[live.length - 1];
      if (latest) byTask.set(task.id, latest.role);
    }
    return byTask;
  }, [tasks, subtasks, agents]);

  return (
    <div className="panel tasks-panel">
      <div className="section-head">
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <strong>Tasks</strong>
          <span className="iter-tag">· iter #{iterationNumber}</span>
        </div>
        <div className="feed-filters">
          {(["tree", "list"] as const).map((mode) => (
            <button
              key={mode}
              className={viewMode === mode ? "pill active" : "pill"}
              onClick={() => setViewMode(mode)}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>
      <div className="tasks-list">
        {nodes.length === 0 && <div className="muted" style={{ padding: 12 }}>No tasks yet.</div>}
        {nodes.map(({ task, depth }) => {
          const isSelected = selectedTaskId === task.id;
          const role = roleByTaskId.get(task.id);
          return (
            <div
              key={task.id}
              className={`task-row status-${task.status} ${isSelected ? "selected" : ""}`}
              style={{ paddingLeft: 8 + Math.min(depth, 4) * 14 }}
              onClick={() => onSelect(task.id)}
            >
              {depth > 0 && <span className="task-branch" aria-hidden>└</span>}
              <span className="task-accent" />
              <div className="task-body">
                <span className="task-id">
                  {task.id.toUpperCase()}
                  {role && (
                    <span className={`task-role activity-role ${role}`} title={role}>
                      {" "}{roleGlyph[role]} {role}
                    </span>
                  )}
                </span>
                <span className="task-sub" title={task.title}>{task.title}</span>
                {task.depends_on.length > 0 && (
                  <span className="task-deps">depends on {task.depends_on.map((id) => id.replace(/^task-/i, "T").toUpperCase()).join(", ")}</span>
                )}
              </div>
              <span className="task-end">{statusEndIcon(task.status)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
