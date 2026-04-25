import { useMemo, useState } from "react";
import type { TaggedBusEvent } from "../../core/types";

const ROLE_TAG_RE = /^(coder|tester|architect|pm|critic|planner|qa)$/;
const SUBTASK_TAG_RE = /^sub-\d+$/;

const extractRole = (event: TaggedBusEvent): string => {
  const payload = event.payload as { fromRole?: string; type: string };
  if (payload.fromRole) return payload.fromRole;
  const roleTag = event.tags.find((tag) => ROLE_TAG_RE.test(tag));
  if (roleTag) return roleTag;
  return "system";
};

const extractSubtaskId = (event: TaggedBusEvent): string | null => {
  const payload = event.payload as { subtaskId?: string };
  if (typeof payload.subtaskId === "string" && payload.subtaskId) return payload.subtaskId;
  return event.tags.find((tag) => SUBTASK_TAG_RE.test(tag)) ?? null;
};

export function ActivityFeed({
  events,
  iterationNumber,
  selectedTaskId,
}: {
  events: TaggedBusEvent[];
  iterationNumber: number;
  selectedTaskId?: string;
}) {
  const [filter, setFilter] = useState<"all" | "mine" | "messages">("all");
  const filtered = useMemo(() => {
    const withoutTerminalNoise = events.filter((event) => event.payload.type !== "subtask_output");
    const scoped = selectedTaskId && filter === "mine"
      ? withoutTerminalNoise.filter((event) => event.tags.includes(selectedTaskId))
      : withoutTerminalNoise;
    if (filter === "messages") {
      return scoped.filter((event) =>
        ["broadcast", "ask_user", "ask_user_answered"].includes(event.payload.type),
      );
    }
    return scoped;
  }, [events, filter, selectedTaskId]);

  const renderText = (event: TaggedBusEvent) => {
    const payload = event.payload;
    const sub = extractSubtaskId(event);
    const prefix = sub ? `${sub} · ` : "";
    switch (payload.type) {
      case "activity":
        return `${prefix}${payload.message}`;
      case "subtask_output":
        return payload.chunk.trim() || "[stream chunk]";
      case "subtask_completed":
        return `${prefix}completed — ${payload.summary}`;
      case "subtask_failed":
        return `${prefix}failed — ${payload.reason}`;
      case "critic_findings":
        return `${prefix}${payload.findings.length} finding${payload.findings.length === 1 ? "" : "s"} raised`;
      case "ask_user":
        return `? ${payload.question}`;
      case "ask_user_answered":
        return `→ ${payload.answer}`;
      case "broadcast":
        return `→ ${payload.toAgent}: ${payload.message}`;
      case "iteration_started":
        return `iteration #${payload.number} · ${payload.trigger}`;
      case "plan_approved":
        return "plan approved";
      case "run_completed":
        return "run completed";
      case "tasks_emitted":
        return `${payload.taskIds.length} task${payload.taskIds.length === 1 ? "" : "s"} emitted`;
      case "task_ready":
        return `${payload.taskId} ready`;
      case "task_started":
        return `${payload.taskId} started`;
      case "task_completed":
        return `${payload.taskId} completed`;
      case "task_cancelled":
        return `${payload.taskId} cancelled`;
      case "task_merged":
        return `${payload.taskId} merged into ${payload.branch}`;
      case "task_archived":
        return `${payload.taskId} archived`;
      case "subtask_started":
        return `${payload.subtaskId} started`;
      case "agent_completed":
        return "agent finished";
      case "agent_failed":
        return `agent failed — ${payload.reason}`;
      case "iteration_completed":
        return "iteration completed";
      default:
        return (payload as { type: string }).type;
    }
  };

  return (
    <div className="panel activity-panel">
      <div className="section-head">
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <strong>Activity</strong>
          <span className="iter-tag">· iter #{iterationNumber}</span>
        </div>
        <div className="feed-filters">
          {(["all", "mine", "messages"] as const).map((item) => (
            <button
              key={item}
              className={filter === item ? "pill active" : "pill"}
              onClick={() => setFilter(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      <div className="feed">
        {filtered.slice().reverse().map((event) => {
          const role = extractRole(event);
          const time = new Date(event.ts).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          });
          return (
            <div key={event.id} className="activity-row">
              <span className="activity-time">{time}</span>
              <span className={`activity-role ${role}`}>{role}</span>
              <span className="activity-text">{renderText(event)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
