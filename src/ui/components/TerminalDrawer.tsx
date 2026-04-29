import { useState } from "react";
import WebTTY from "./WebTTY";
import type { Agent } from "../../core/types";
import { DAEMON_HTTP, DAEMON_WS } from "../config";

const RESUME_SUPPORTED_CLIS = new Set(["claude", "codex"]);

export function TerminalDrawer({
  agentId,
  agent,
  onClose,
}: {
  agentId?: string;
  agent?: Agent;
  onClose: () => void;
}) {
  const [resumeTtyId, setResumeTtyId] = useState<string | null>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [resuming, setResuming] = useState(false);

  if (!agentId) return null;
  const isDead = agent?.status === "dead";
  const canResume =
    isDead
    && !!agent?.cli_session_id
    && !!agent?.cli
    && RESUME_SUPPORTED_CLIS.has(agent.cli);
  const ttyTarget = resumeTtyId ?? agentId;

  const startResume = async () => {
    if (!agentId || resuming) return;
    setResuming(true);
    setResumeError(null);
    try {
      const res = await fetch(`${DAEMON_HTTP}/api/agents/${agentId}/resume`, { method: "POST", credentials: "include" });
      const body = (await res.json()) as { ok: boolean; ttyId?: string; error?: string };
      if (!res.ok || !body.ok || !body.ttyId) {
        setResumeError(body.error ?? `resume failed (${res.status})`);
        return;
      }
      setResumeTtyId(body.ttyId);
    } catch (error) {
      setResumeError(error instanceof Error ? error.message : "resume failed");
    } finally {
      setResuming(false);
    }
  };

  return (
    <div className="drawer">
      <div className="topbar">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <strong>Terminal {ttyTarget}</strong>
          {agent && (
            <span className={`badge ${isDead ? "idle" : "live"}`}>
              {resumeTtyId ? "resumed" : isDead ? "exited · replay" : agent.status}
            </span>
          )}
          {canResume && !resumeTtyId && (
            <button onClick={startResume} disabled={resuming}>
              {resuming ? "resuming…" : "Resume session"}
            </button>
          )}
          {resumeError && <span style={{ color: "#ff6b6b", fontSize: 12 }}>{resumeError}</span>}
        </div>
        <button onClick={onClose}>close</button>
      </div>
      <div className="terminal-host">
        <WebTTY wsUrl={`${DAEMON_WS}/tty/${ttyTarget}`} readOnly={isDead && !resumeTtyId} />
      </div>
    </div>
  );
}
