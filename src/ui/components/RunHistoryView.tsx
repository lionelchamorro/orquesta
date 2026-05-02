import { useEffect, useState } from "react";
import { DAEMON_HTTP } from "../config";

interface ArchivedRun {
  runId: string;
  status: string;
  prompt: string;
  archive_path: string;
  task_count: number;
}

export function RunHistoryView() {
  const [runs, setRuns] = useState<ArchivedRun[]>([]);

  useEffect(() => {
    void fetch(`${DAEMON_HTTP}/api/runs/archive`, { credentials: "include" })
      .then((response) => response.ok ? response.json() : [])
      .then((body) => setRuns(Array.isArray(body) ? body : []))
      .catch(() => setRuns([]));
  }, []);

  return (
    <div className="panel run-history">
      <div className="section-head"><strong>History</strong><span>{runs.length} archived</span></div>
      <div className="history-list">
        {runs.length === 0 && <div className="muted history-empty">No archived runs</div>}
        {runs.map((run) => (
          <div className="history-row" key={run.archive_path}>
            <div>
              <strong>{run.runId}</strong>
              <span>{run.prompt || "(no prompt)"}</span>
            </div>
            <code>{run.status} · {run.task_count} tasks</code>
          </div>
        ))}
      </div>
    </div>
  );
}
