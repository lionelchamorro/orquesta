import { expect, test } from "bun:test";
import { waitForAgentCompletion, waitForPlannerCompletionOrTasks } from "../cli/orq";
import { Bus } from "../bus/bus";

test("waitForAgentCompletion rejects if agent exits early", async () => {
  const bus = new Bus();
  const pool = {
    waitForExit() {
      return Promise.resolve(0);
    },
  } as never;
  await expect(waitForAgentCompletion(bus, pool, "agent-1")).rejects.toThrow("exited before completion");
});

test("waitForPlannerCompletionOrTasks recovers if planner already emitted tasks before exit", async () => {
  const bus = new Bus();
  const pool = {
    waitForExit() {
      return Promise.resolve(0);
    },
  } as never;

  await expect(waitForPlannerCompletionOrTasks(bus, pool, "agent-1", async () => [{}])).resolves.toBe("");
});
