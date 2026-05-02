import { blockedByFailedDeps, isTerminal, readySet } from "../core/dag";
import type { PlanStore } from "../core/plan-store";
import type { Config } from "../core/types";
import { TaskPipeline } from "./task-pipeline";
import { IterationManager } from "./iteration-manager";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class Orchestrator {
  private stopped = false;
  private running = new Set<string>();
  private waves = 0;

  constructor(
    private readonly store: PlanStore,
    private readonly pipeline: TaskPipeline,
    private readonly iterations: IterationManager,
    private readonly config: Config,
  ) {}

  async tick() {
    const plan = await this.store.loadPlan();
    if (plan.status !== "running") return;
    if (this.iterations.isRunning()) return;
    let tasks = await this.store.loadTasks();
    if (this.running.size === 0 && tasks.length > 0 && tasks.every((task) => isTerminal(task.status))) {
      await this.iterations.onWaveEmpty();
      return;
    }
    if (!(await this.iterations.ensureConsultantsLive())) return;
    const nowMs = Date.now();
    for (const task of tasks) {
      if (task.status !== "pending") continue;
      const attempts = (await this.store.loadSubtasks(task.id)).flatMap((subtask) => subtask.fallback_attempts ?? []);
      const firstErrorAt = attempts[0]?.error_at;
      if (!firstErrorAt) continue;
      if (nowMs - Date.parse(firstErrorAt) >= this.config.work.maxQuotaWaitMs) {
        await this.store.transitionTask(task.id, "failed", {
          closure_reason: "quota_wait_exceeded",
          summary: `Quota wait exceeded after ${this.config.work.maxQuotaWaitMs}ms.`,
        });
      }
    }
    tasks = await this.store.loadTasks();
    const blocked = blockedByFailedDeps(tasks).filter((task) => !this.running.has(task.id));
    if (blocked.length > 0) {
      const now = new Date().toISOString();
      for (const task of blocked) {
        const failedDeps = task.depends_on.filter((depId) => {
          const dep = tasks.find((t) => t.id === depId);
          return dep && (dep.status === "failed" || dep.status === "blocked" || dep.status === "cancelled");
        });
        await this.store.saveTask({
          ...task,
          status: "blocked",
          closure_reason: "blocked_by_dep",
          updated_at: now,
          summary: `Blocked because dependency ${failedDeps.join(", ")} did not complete successfully.`,
        });
      }
      tasks = await this.store.loadTasks();
    }
    const ready = readySet(tasks).filter((task) => !this.running.has(task.id));
    let dispatched = 0;
    while (ready.length > 0 && this.running.size < this.config.concurrency.workers) {
      const next = ready.shift();
      if (!next) break;
      this.running.add(next.id);
      dispatched += 1;
      void this.pipeline.run(next).finally(() => this.running.delete(next.id));
    }
    if (this.running.size === 0 && tasks.length > 0 && tasks.every((task) => isTerminal(task.status))) {
      await this.iterations.onWaveEmpty();
    }
    if (dispatched > 0) {
      this.waves += 1;
    }
    if (this.waves >= this.config.work.maxWaves) {
      this.stopped = true;
    }
  }

  async run() {
    while (!this.stopped) {
      try {
        await this.tick();
      } catch (error) {
        console.error("[orchestrator] tick failed:", error instanceof Error ? error.message : error);
      }
      await sleep(500);
    }
  }

  stop() {
    this.stopped = true;
  }
}
