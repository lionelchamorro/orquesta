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
