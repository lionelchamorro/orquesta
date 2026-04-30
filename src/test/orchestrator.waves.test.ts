import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Bus } from "../bus/bus";
import { PlanStore } from "../core/plan-store";
import { IterationManager } from "../daemon/iteration-manager";
import { Orchestrator } from "../daemon/orchestrator";

test("orchestrator does not stop from idle ticks alone", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "orq-waves-"));
  mkdirSync(path.join(root, ".orquesta", "crew"), { recursive: true });
  await Bun.write(path.join(root, ".orquesta", "crew", "plan.json"), JSON.stringify({
    runId: "run-1", prd: "(prompt)", prompt: "x", status: "approved", created_at: "a", updated_at: "a", task_count: 0, completed_count: 0, current_iteration: 1, max_iterations: 1,
  }));
  const store = new PlanStore(root);
  const config = {
    dependencies: "strict" as const,
    concurrency: { workers: 1, max: 1 },
    review: { enabled: true, maxIterations: 1 },
    work: { maxAttemptsPerTask: 1, maxWaves: 1, maxIterations: 1 },
    team: [{ role: "coder", cli: "claude" as const, model: "m" }],
  };
  const orchestrator = new Orchestrator(
    store,
    { run: async () => {} } as never,
    new IterationManager(store, { get() { return undefined; }, spawn: async () => null } as never, new Bus(), config as never),
    config as never,
  );
  await orchestrator.tick();
  expect((orchestrator as unknown as { stopped: boolean }).stopped).toBeFalse();
  rmSync(root, { recursive: true, force: true });
});
