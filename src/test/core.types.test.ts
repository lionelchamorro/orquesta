import { expect, test } from "bun:test";
import { nextIterationId, nextSubtaskId, nextTaskId } from "../core/ids";

test("id helpers compute max suffix", () => {
  expect(nextTaskId(["task-1", "task-3"])).toBe("task-4");
  expect(nextSubtaskId([])).toBe("sub-1");
  expect(nextIterationId(["iter-2", "iter-7"])).toBe("iter-8");
});
