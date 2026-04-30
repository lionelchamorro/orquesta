import { expect, test } from "bun:test";
import { Bus } from "../bus/bus";

test("bus filters by tag and unsubscribe works", () => {
  const bus = new Bus();
  const seen: string[] = [];
  const unsub = bus.subscribe("task-3", (event) => seen.push(event.payload.type));
  bus.publish({ tags: ["task-3"], payload: { type: "task_ready", taskId: "task-3" } });
  bus.publish({ tags: ["task-2"], payload: { type: "task_ready", taskId: "task-2" } });
  unsub();
  bus.publish({ tags: ["task-3"], payload: { type: "task_ready", taskId: "task-3" } });
  expect(seen).toEqual(["task_ready"]);
});

test("bus dedups duplicate subtask_completed within the dedup window", () => {
  const bus = new Bus();
  const seen: string[] = [];
  bus.subscribe("sub-1", (event) => seen.push(event.payload.type));
  bus.publish({ tags: ["sub-1"], payload: { type: "subtask_completed", subtaskId: "sub-1", summary: "ok" } });
  bus.publish({ tags: ["sub-1"], payload: { type: "subtask_completed", subtaskId: "sub-1", summary: "ok" } });
  // Different subtask must still be delivered.
  bus.publish({ tags: ["sub-1"], payload: { type: "subtask_completed", subtaskId: "sub-2", summary: "ok" } });
  expect(seen).toEqual(["subtask_completed", "subtask_completed"]);
});

test("bus dedups duplicate agent_completed", () => {
  const bus = new Bus();
  const seen: string[] = [];
  bus.subscribe("agent-1", (event) => seen.push(event.payload.type));
  bus.publish({ tags: ["agent-1"], payload: { type: "agent_completed", agentId: "agent-1", summary: "x" } });
  bus.publish({ tags: ["agent-1"], payload: { type: "agent_completed", agentId: "agent-1", summary: "x" } });
  expect(seen).toEqual(["agent_completed"]);
});

test("bus drops subtask_output with empty subtaskId", () => {
  const bus = new Bus();
  const seen: string[] = [];
  bus.subscribe(() => true, (event) => seen.push(event.payload.type));
  bus.publish({ tags: ["agent-1", "planner"], payload: { type: "subtask_output", subtaskId: "", chunk: "hello" } });
  bus.publish({ tags: ["agent-1", "coder"], payload: { type: "subtask_output", subtaskId: "sub-1", chunk: "hello" } });
  expect(seen).toEqual(["subtask_output"]);
});
