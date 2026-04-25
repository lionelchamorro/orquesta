import WebTTY from "../../../demo/WebTTY";
import type { Agent } from "../../core/types";

export function TerminalDrawer({
  agentId,
  agent,
  onClose,
}: {
  agentId?: string;
  agent?: Agent;
  onClose: () => void;
}) {
  if (!agentId) return null;
  const isDead = agent?.status === "dead";
  return (
    <div className="drawer">
      <div className="topbar">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <strong>Terminal {agentId}</strong>
          {agent && (
            <span className={`badge ${isDead ? "idle" : "live"}`}>
              {isDead ? "exited · replay" : agent.status}
            </span>
          )}
        </div>
        <button onClick={onClose}>close</button>
      </div>
      <div className="terminal-host">
        <WebTTY wsUrl={`/tty/${agentId}`} readOnly={isDead} />
      </div>
    </div>
  );
}
