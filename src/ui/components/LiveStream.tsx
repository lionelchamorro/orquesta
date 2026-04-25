import WebTTY from "../../../demo/WebTTY";
import type { Agent } from "../../core/types";

export function LiveStream({ agent }: { agent?: Agent }) {
  const isDead = agent?.status === "dead";
  const label = agent
    ? `${agent.role.toUpperCase()}${agent.bound_subtask ? ` · ${agent.bound_subtask.toUpperCase()}` : ""}${isDead ? " · REPLAY" : " LIVE"}`
    : "Live stream";
  return (
    <div className="panel live-panel">
      <div className="section-head">
        <strong>{label}</strong>
        {agent && !isDead && <span className="running-badge">streaming</span>}
        {isDead && <span className="badge idle">exited</span>}
      </div>
      <div className="terminal-host">
        {agent ? <WebTTY wsUrl={`/tty/${agent.id}`} readOnly={isDead} /> : <div className="muted">Select an agent</div>}
      </div>
    </div>
  );
}
