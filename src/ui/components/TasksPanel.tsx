import { useMemo, useState } from "react";
import type { Agent, Role, Subtask, Task } from "../../core/types";
import { buildRoleByTaskId } from "../utils/agentRole";
import { flatTasks, layoutTasks } from "../utils/layout";

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

  const roleByTaskId = useMemo(() => buildRoleByTaskId(tasks, subtasks, agents), [tasks, subtasks, agents]);

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
