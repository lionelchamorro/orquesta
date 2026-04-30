export function EmptyState() {
  return (
    <div className="empty-state">
      <h1>No run yet</h1>
      <p>
        Build a Task DAG and start a run with{" "}
        <code>orq import &lt;file&gt;</code>{" "}
        followed by <code>orq start</code>.
      </p>
      <p className="muted">
        See{" "}
        <a href="/docs/CONTEXT.md" target="_blank" rel="noreferrer">
          CONTEXT.md
        </a>{" "}
        and the PRD at{" "}
        <a href="/docs/prd/0001-tui-fix-and-planner-ui-strip.md" target="_blank" rel="noreferrer">
          tasks/prd/0001
        </a>{" "}
        for the import payload format.
      </p>
    </div>
  );
}
