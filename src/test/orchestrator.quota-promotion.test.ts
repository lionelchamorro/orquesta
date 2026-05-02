import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Bus } from "../bus/bus";
import { PlanStore } from "../core/plan-store";
import { IterationManager } from "../daemon/iteration-manager";
import { Orchestrator } from "../daemon/orchestrator";

test("orchestrator promotes quota-waiting task to failed after maxQuotaWaitMs", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "orq-quota-promotion-"));
  mkdirSync(path.join(root, ".orquesta", "crew"), { recursive: true });
  const store = new PlanStore(root);
  const bus = new Bus();
  const config = {
    dependencies: "strict" as const,
    concurrency: { workers: 1, max: 1 },
    review: { enabled: false, maxIterations: 1 },
    work: { maxAttemptsPerTask: 1, maxWaves: 1, maxIterations: 1, maxQuotaWaitMs: 1 },
    git: { enabled: false, baseBranch: "main", autoCommit: false, removeWorktreeOnArchive: false },
    team: [{ role: "coder" as const, cli: "codex" as const, model: "m" }],
  };
  await store.savePlan({
    runId: "run-1",
    prd: "(prompt)",
    prompt: "x",
    status: "running",
    created_at: "a",
    updated_at: "a",
    task_count: 1,
    completed_count: 0,
    current_iteration: 1,
    max_iterations: 1,
  });
  await store.saveTask({
    id: "task-1",
    title: "Task",
    status: "pending",
    depends_on: [],
    iteration: 1,
    created_at: "a",
    updated_at: "a",
    attempt_count: 0,
    subtasks: ["sub-1"],
  });
  await store.saveSubtask({
    id: "sub-1",
    taskId: "task-1",
    type: "code",
    role: "coder",
    status: "pending",
    prompt: "x",
    depends_on: [],
    created_at: "a",
    fallback_attempts: [{ cli: "codex", model: "m", error_at: "2026-05-01T00:00:00.000Z", error_type: "rate_limit" }],
  });
  const pipeline = { run: async () => { throw new Error("should not dispatch"); } };
  const iterations = new IterationManager(store, { spawn: async () => { throw new Error("no"); }, kill() {}, write() {} } as never, bus, config);
  const orchestrator = new Orchestrator(store, pipeline as never, iterations, config);

  await orchestrator.tick();

  const task = await store.loadTask("task-1");
  expect(task.status).toBe("failed");
  expect(task.closure_reason).toBe("quota_wait_exceeded");
  rmSync(root, { recursive: true, force: true });
});
