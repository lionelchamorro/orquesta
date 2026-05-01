import { expect, test } from "bun:test";

// The "recent events" panel in scripts/test-daemon-flow.sh uses this jq filter
// to render a one-line snippet per event. Issue 004 reported that the filter
// looked at fields that don't exist on chatty events, so the message column
// was always blank. This test runs the filter against synthetic events of
// each common type and asserts the snippet is non-empty and bounded.
const SNIPPET_FILTER = `
.events[-8:][]? |
  (.payload.message // .payload.summary // .payload.chunk // .payload.reason // "") as $msg |
  "\\(.journal_id // "-") \\(.ts) \\(.payload.type) \\(.tags | join(",")) \\($msg | tostring | gsub("[\\r\\n\\t]+"; " ") | .[0:120])"
`;

const runJq = (filter: string, input: unknown): string[] => {
  const proc = Bun.spawnSync(["jq", "-r", filter], {
    stdin: new TextEncoder().encode(JSON.stringify(input)),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) throw new Error(proc.stderr.toString());
  return proc.stdout
    .toString()
    .split("\n")
    .filter((line) => line.length > 0);
};

test("snippet filter shows activity message", () => {
  const lines = runJq(SNIPPET_FILTER, {
    events: [
      { journal_id: 1, ts: "2026-04-30T01:00:00Z", tags: ["task-1"], payload: { type: "activity", fromAgent: "system", message: "starting Go module scaffolding" } },
    ],
  });
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain("activity");
  expect(lines[0]).toContain("starting Go module scaffolding");
});

test("snippet filter shows subtask_completed summary", () => {
  const lines = runJq(SNIPPET_FILTER, {
    events: [
      { journal_id: 2, ts: "2026-04-30T01:00:01Z", tags: ["task-1", "sub-1"], payload: { type: "subtask_completed", subtaskId: "sub-1", summary: "coder finished writing main.go" } },
    ],
  });
  expect(lines[0]).toContain("subtask_completed");
  expect(lines[0]).toContain("coder finished writing main.go");
});

test("snippet filter shows subtask_output chunk", () => {
  const lines = runJq(SNIPPET_FILTER, {
    events: [
      { journal_id: 3, ts: "2026-04-30T01:00:02Z", tags: ["task-1", "sub-1"], payload: { type: "subtask_output", subtaskId: "sub-1", agentId: "a1", chunk: "compiling package main..." } },
    ],
  });
  expect(lines[0]).toContain("subtask_output");
  expect(lines[0]).toContain("compiling package main");
});

test("snippet filter shows subtask_failed reason", () => {
  const lines = runJq(SNIPPET_FILTER, {
    events: [
      { journal_id: 4, ts: "2026-04-30T01:00:03Z", tags: ["task-1"], payload: { type: "subtask_failed", subtaskId: "sub-1", reason: "test command exited with status 2" } },
    ],
  });
  expect(lines[0]).toContain("subtask_failed");
  expect(lines[0]).toContain("test command exited with status 2");
});

test("snippet filter caps long bodies at 120 chars and strips newlines", () => {
  const big = "x".repeat(500);
  const lines = runJq(SNIPPET_FILTER, {
    events: [
      { journal_id: 5, ts: "2026-04-30T01:00:04Z", tags: ["task-1"], payload: { type: "activity", message: `line1\nline2\t${big}` } },
    ],
  });
  // Trailing snippet (everything after the tag column) is bounded to 120 chars
  // and must not contain raw newline/tab characters.
  const trailing = lines[0].split(" task-1 ")[1] ?? "";
  expect(trailing.length).toBeLessThanOrEqual(120);
  expect(trailing).not.toContain("\n");
  expect(trailing).not.toContain("\t");
});

test("snippet filter handles events without any body field", () => {
  const lines = runJq(SNIPPET_FILTER, {
    events: [
      { journal_id: 6, ts: "2026-04-30T01:00:05Z", tags: ["task-1"], payload: { type: "task_ready", taskId: "task-1" } },
    ],
  });
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain("task_ready");
});
