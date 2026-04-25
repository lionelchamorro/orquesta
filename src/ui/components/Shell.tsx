import type { Plan } from "../../core/types";

export function Shell({ plan }: { plan: Plan | null }) {
  return (
    <div className="panel topbar">
      <div className="shell-title">
        <span>Dashboard</span>
        {plan && (
          <>
            <span className="sep">—</span>
            <strong>Run #{plan.runId}</strong>
            <span className="sep">—</span>
            <span>Iteración #{plan.current_iteration} of {plan.max_iterations}</span>
          </>
        )}
      </div>
    </div>
  );
}
