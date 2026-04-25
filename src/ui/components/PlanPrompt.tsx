import { useState } from "react";

export function PlanPrompt({ onStarted }: { onStarted: (agentId: string, runId: string) => void }) {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = prompt.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: trimmed }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? "failed to start planner");
        return;
      }
      onStarted(body.agentId, body.runId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "network error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel plan-prompt">
      <div className="section-head">
        <strong>Start a run</strong>
      </div>
      <div className="plan-prompt-body">
        <p className="muted">
          Describe what you want built. A planner agent will draft a DAG of tasks and dialogue with you before you approve.
        </p>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void submit();
          }}
          placeholder="e.g. build a hello CLI with bun that accepts a name flag and prints a greeting"
          rows={6}
          disabled={busy}
        />
        {error && <div className="plan-prompt-error">{error}</div>}
        <div className="plan-prompt-actions">
          <span className="muted">⌘/Ctrl+Enter to submit</span>
          <button onClick={() => void submit()} disabled={busy || !prompt.trim()}>
            {busy ? "Starting…" : "Start plan"}
          </button>
        </div>
      </div>
    </div>
  );
}
