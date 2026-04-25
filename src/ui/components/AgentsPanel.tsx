import type { Agent } from "../../core/types";
import { taskDisplayId } from "../main";

const roleGlyph: Record<Agent["role"], string> = {
  planner: "✦",
  coder: "⌘",
  tester: "✓",
  critic: "⚑",
  architect: "◫",
  pm: "☰",
  qa: "⟲",
};

const statusLabel = (status: Agent["status"], pinned: boolean): { label: string; cls: string } => {
  if (status === "live") return { label: "live", cls: "live" };
  if (status === "working") return { label: "working", cls: "working" };
  if (status === "dead") return { label: pinned ? "history" : "idle", cls: "idle" };
  return { label: String(status), cls: "idle" };
};

export function AgentsPanel({
  agents,
  agentTaskId,
  selectedAgentId,
  selectedTaskId,
  selectedTaskLabel,
  pinnedAgentIds,
  onTogglePin,
  onSelect,
  onOpenTerminal,
}: {
  agents: Agent[];
  agentTaskId: (agent: Agent) => string | null;
  selectedAgentId?: string;
  selectedTaskId?: string;
  selectedTaskLabel?: string;
  pinnedAgentIds: Set<string>;
  onTogglePin: (agentId: string) => void;
  onSelect: (agentId: string) => void;
  onOpenTerminal: (agentId: string) => void;
}) {
  const forTask: Agent[] = [];
  const others: Agent[] = [];
  const completed: Agent[] = [];
  for (const agent of agents) {
    if (agent.status === "dead") {
      if (pinnedAgentIds.has(agent.id)) completed.push(agent);
      continue;
    }
    const taskId = agentTaskId(agent);
    if (selectedTaskId && taskId === selectedTaskId) forTask.push(agent);
    else others.push(agent);
  }

  const renderRow = (agent: Agent) => {
    const pinned = pinnedAgentIds.has(agent.id);
    const status = statusLabel(agent.status, pinned);
    const taskId = agentTaskId(agent);
    const taskTag = taskId ? taskDisplayId(taskId) : null;
    const canPin = agent.status === "dead";
    return (
      <div
        key={agent.id}
        className={`agent-row ${selectedAgentId === agent.id ? "selected" : ""} ${agent.status === "dead" ? "dead" : ""}`}
        onClick={() => onSelect(agent.id)}
        onDoubleClick={() => onOpenTerminal(agent.id)}
      >
        <span className="agent-glyph">{roleGlyph[agent.role]}</span>
        <div className="agent-body">
          <span className="agent-role">{agent.role}</span>
          {taskTag && <span className="agent-task">{taskTag}</span>}
        </div>
        {canPin && (
          <button
            type="button"
            className={`pill pin-btn ${pinned ? "active" : ""}`}
            title={pinned ? "Unpin — drop this terminal on next cleanup" : "Pin — keep this terminal for debug"}
            onClick={(event) => {
              event.stopPropagation();
              onTogglePin(agent.id);
            }}
          >
            {pinned ? "◉" : "○"}
          </button>
        )}
        <button
          type="button"
          className="pill terminal-btn"
          title="Open terminal"
          onClick={(event) => {
            event.stopPropagation();
            onOpenTerminal(agent.id);
          }}
        >
          ⌘
        </button>
        <span className={`badge ${status.cls}`}>{status.label}</span>
      </div>
    );
  };

  return (
    <div className="panel agents-panel">
      <div className="section-head">
        <strong>Agents</strong>
        {selectedTaskLabel && <span className="iter-tag">· {selectedTaskLabel}</span>}
      </div>
      <div className="agents-list">
        {selectedTaskId && forTask.length === 0 && (
          <div className="muted" style={{ padding: 12 }}>No agents bound to {selectedTaskLabel ?? "this task"} yet.</div>
        )}
        {forTask.map(renderRow)}
        {selectedTaskId && others.length > 0 && (
          <div className="agents-group-head muted">Other agents</div>
        )}
        {others.map(renderRow)}
        {completed.length > 0 && (
          <div className="agents-group-head muted">Completed agents</div>
        )}
        {completed.map(renderRow)}
      </div>
    </div>
  );
}
