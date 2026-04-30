import { useMemo, useState } from "react";
import type { TaggedBusEvent } from "../../core/types";
import { renderEventText } from "../utils/eventLabel";

const ROLE_TAG_RE = /^(coder|tester|architect|pm|critic|planner|qa)$/;

const extractRole = (event: TaggedBusEvent): string => {
  const payload = event.payload as { fromRole?: string; type: string };
  if (payload.fromRole) return payload.fromRole;
  const roleTag = event.tags.find((tag) => ROLE_TAG_RE.test(tag));
  if (roleTag) return roleTag;
  return "system";
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
    const withoutTerminalNoise = events.filter((event) => event.payload.type !== "subtask_output" && event.payload.type !== "agent_output");
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
              <span className="activity-text">{renderEventText(event)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
