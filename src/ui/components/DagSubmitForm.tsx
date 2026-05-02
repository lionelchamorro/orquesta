import { useMemo, useState } from "react";
import { RunSubmissionSchema } from "../../core/schemas";
import { DAEMON_HTTP } from "../config";

const example = JSON.stringify({
  prompt: "Implement the requested change",
  max_iterations: 2,
  tasks: [
    { id: "task-a", title: "Implement slice", description: "Make the smallest vertical change.", depends_on: [] },
  ],
}, null, 2);

const validateDagShape = (value: unknown) => {
  const parsed = RunSubmissionSchema.safeParse(value);
  if (!parsed.success) return parsed.error.errors[0]?.message ?? "Invalid DAG";
  const ids = new Set<string>();
  for (const task of parsed.data.tasks) {
    if (ids.has(task.id)) return `Duplicate task id: ${task.id}`;
    ids.add(task.id);
  }
  for (const task of parsed.data.tasks) {
    for (const dep of task.depends_on) {
      if (!ids.has(dep)) return `${task.id} depends on missing task ${dep}`;
    }
  }
  return null;
};

export function DagSubmitForm({ onStarted }: { onStarted: () => void }) {
  const [text, setText] = useState(example);
  const [message, setMessage] = useState<string>("");
  const parsed = useMemo(() => {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  }, [text]);
  const validation = parsed === null ? "Invalid JSON" : validateDagShape(parsed);
  const tasks = parsed && typeof parsed === "object" && Array.isArray((parsed as { tasks?: unknown }).tasks)
    ? (parsed as { tasks: Array<{ id?: string; title?: string; depends_on?: string[] }> }).tasks
    : [];

  const submit = async () => {
    if (validation || parsed === null) return;
    setMessage("Starting run...");
    const response = await fetch(`${DAEMON_HTTP}/api/runs`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(body.error?.message ?? body.error ?? "Run submission failed");
      return;
    }
    setMessage(`Started ${body.runId}`);
    onStarted();
  };

  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    setText(await file.text());
  };

  return (
    <div className="panel dag-submit">
      <div className="section-head"><strong>Start Run</strong><span>Task DAG JSON</span></div>
      <div className="dag-submit-body">
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onDrop={(event) => {
            event.preventDefault();
            void loadFile(event.dataTransfer.files[0]);
          }}
          onDragOver={(event) => event.preventDefault()}
          spellCheck={false}
        />
        <div className="dag-preview">
          <div className={validation ? "dag-error" : "dag-ok"}>{validation ?? `${tasks.length} task DAG ready`}</div>
          <div className="dag-list">
            {tasks.map((task) => (
              <div className="dag-row" key={task.id ?? task.title}>
                <strong>{task.id}</strong>
                <span>{task.title}</span>
                <code>{task.depends_on?.length ? task.depends_on.join(", ") : "root"}</code>
              </div>
            ))}
          </div>
          <label className="file-picker">
            JSON file
            <input type="file" accept="application/json,.json" onChange={(event) => void loadFile(event.target.files?.[0])} />
          </label>
          <button type="button" disabled={Boolean(validation)} onClick={() => void submit()}>Start</button>
          {message && <div className="muted">{message}</div>}
        </div>
      </div>
    </div>
  );
}
