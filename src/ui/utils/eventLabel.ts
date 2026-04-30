import type { TaggedBusEvent } from "../../core/types";

const SUBTASK_TAG_RE = /^sub-\d+$/;

const extractSubtaskId = (event: TaggedBusEvent): string | null => {
  const payload = event.payload as { subtaskId?: string };
  if (typeof payload.subtaskId === "string" && payload.subtaskId) return payload.subtaskId;
  return event.tags.find((tag) => SUBTASK_TAG_RE.test(tag)) ?? null;
};

export const renderEventText = (event: TaggedBusEvent) => {
  const payload = event.payload;
  const sub = extractSubtaskId(event);
  const prefix = sub ? `${sub} · ` : "";
  switch (payload.type) {
    case "activity":
      return `${prefix}${payload.message}`;
    case "subtask_output":
      return payload.chunk.trim() || "[stream chunk]";
    case "agent_output":
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
