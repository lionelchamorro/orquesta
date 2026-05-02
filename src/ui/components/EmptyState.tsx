import { DagSubmitForm } from "./DagSubmitForm";
import { RunHistoryView } from "./RunHistoryView";

export function EmptyState({ onStarted }: { onStarted: () => void }) {
  return (
    <div className="empty-state">
      <h1>No run yet</h1>
      <p>
        Build a Task DAG and start a run with <code>orq run start &lt;file&gt;</code>.
      </p>
      <DagSubmitForm onStarted={onStarted} />
      <RunHistoryView />
    </div>
  );
}
