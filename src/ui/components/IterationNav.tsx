import type { Iteration, Plan } from "../../core/types";

export function IterationNav({
  plan,
  iteration,
  onPrev,
  onNext,
}: {
  plan: Plan | null;
  iteration: Iteration | null;
  onPrev: () => void;
  onNext: () => void;
}) {
  const canPrev = (plan?.current_iteration ?? 1) > 1;
  const canNext = (plan?.current_iteration ?? 1) < (plan?.max_iterations ?? 1);
  const time = iteration?.started_at
    ? new Date(iteration.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "";
  const status = plan?.status ?? "idle";
  const isRunning = status === "running" || status === "approved";

  return (
    <div className="panel nav">
      <div className="nav-left">
        <button onClick={onPrev} disabled={!canPrev}>◀</button>
        <button onClick={onNext} disabled={!canNext}>▶</button>
        <div className="nav-summary">
          <strong>{plan ? `Iter #${plan.current_iteration} of ${plan.max_iterations}` : "No iteration"}</strong>
          <span className="muted">
            trigger: {iteration?.trigger ?? "initial"}{time ? ` · ${time}` : ""}
          </span>
        </div>
      </div>
      <div className="nav-right">
        {isRunning ? (
          <span className="running-badge">{status}</span>
        ) : (
          <span className={`badge ${status}`}>{status}</span>
        )}
        <span className="run-badge">Run #{plan?.runId ?? "?"}</span>
      </div>
    </div>
  );
}
