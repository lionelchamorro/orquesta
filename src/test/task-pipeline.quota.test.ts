import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Bus } from "../bus/bus";
import type { Agent, Config, Role } from "../core/types";
import { PlanStore } from "../core/plan-store";
import { TaskPipeline } from "../daemon/task-pipeline";
import type { RateLimitInfo } from "../agents/rate-limit";

class QuotaPool {
  readonly info: RateLimitInfo = {
    reset_at: "2026-01-01T00:01:00.000Z",
    message: "HTTP 429 Too Many Requests",
  };

  async spawn(role: Role, cli: Agent["cli"], model: string, _prompt: string, options: { taskId?: string; subtaskId?: string } = {}): Promise<Agent> {
    return {
      id: "agent-1",
      role,
      cli,
      model,
      status: "live",
      session_cwd: ".",
      bound_task: options.taskId,
      bound_subtask: options.subtaskId,
    };
  }

  waitForExit() {
    return Promise.resolve(1);
  }

  getRateLimit() {
    return this.info;
  }

  kill() {}
}

test("task pipeline records fallback attempt and requeues without consuming an attempt", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "orq-quota-"));
  mkdirSync(path.join(root, ".orquesta", "crew"), { recursive: true });
  const store = new PlanStore(root);
  const bus = new Bus();
  const config: Config = {
    dependencies: "strict",
    concurrency: { workers: 1, max: 1 },
    review: { enabled: true, maxIterations: 1 },
    work: { maxAttemptsPerTask: 3, maxWaves: 1, maxIterations: 1, maxQuotaWaitMs: 7200000 },
    git: { enabled: false, baseBranch: "main", autoCommit: false, removeWorktreeOnArchive: false },
    team: [
      { role: "coder", cli: "claude", model: "m" },
      { role: "tester", cli: "claude", model: "m" },
      { role: "critic", cli: "claude", model: "m" },
    ],
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
    subtasks: [],
  });

  const pipeline = new TaskPipeline(store, bus, new QuotaPool() as never, config);
  await pipeline.run(await store.loadTask("task-1"));

  const plan = await store.loadPlan();
  const task = await store.loadTask("task-1");
  const [subtask] = await store.loadSubtasks("task-1");
  expect(plan.status).toBe("running");
  expect(plan.quota_reset_at).toBe("2026-01-01T00:01:00.000Z");
  expect(task.status).toBe("pending");
  expect(task.attempt_count).toBe(0);
  expect(task.quota_reset_at).toBe("2026-01-01T00:01:00.000Z");
  expect(subtask.status).toBe("pending");
  expect(subtask.fallback_attempts).toEqual([{
    cli: "claude",
    model: "m",
    error_at: expect.any(String),
    error_type: "rate_limit",
    reset_at: "2026-01-01T00:01:00.000Z",
  }]);
  expect(task.closure_reason).toBeUndefined();
  rmSync(root, { recursive: true, force: true });
});
