import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { AgentPool } from "../agents/pool";
import { Bus } from "../bus/bus";
import { PlanStore } from "../core/plan-store";
import { IterationManager } from "../daemon/iteration-manager";
import { Orchestrator } from "../daemon/orchestrator";
import { TaskPipeline } from "../daemon/task-pipeline";

test("orchestrator tick processes running plan", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "orq-orch-"));
  mkdirSync(path.join(root, ".orquesta", "crew"), { recursive: true });
  await Bun.write(path.join(root, ".orquesta", "crew", "plan.json"), JSON.stringify({
    runId: "run-1", prd: "(prompt)", prompt: "x", status: "running", created_at: "a", updated_at: "a", task_count: 0, completed_count: 0, current_iteration: 1, max_iterations: 1,
  }));
  const store = new PlanStore(root);
  const bus = new Bus();
  const pool = new AgentPool(root, store, bus);
  const config = {
    dependencies: "strict" as const,
    concurrency: { workers: 1, max: 1 },
    review: { enabled: true, maxIterations: 1 },
    work: { maxAttemptsPerTask: 1, maxWaves: 1, maxIterations: 1, maxQuotaWaitMs: 7200000 },
    team: [{ role: "coder", cli: "claude" as const, model: "m" }, { role: "tester", cli: "claude" as const, model: "m" }, { role: "critic", cli: "claude" as const, model: "m" }],
  };
  const pipeline = new TaskPipeline(store, bus, pool, config as never);
  const iterations = new IterationManager(store, pool, bus, config as never);
  const orchestrator = new Orchestrator(store, pipeline, iterations, config as never);
  await orchestrator.tick();
  expect((await store.loadPlan()).status).toBe("running");
  rmSync(root, { recursive: true, force: true });
});
