import { nextIterationId } from "../core/ids";
import type { AgentPool } from "../agents/pool";
import type { Bus } from "../bus/bus";
import type { PlanStore } from "../core/plan-store";
import type { Config, Iteration, Role, Task } from "../core/types";

const finalRunStatus = (tasks: Task[]): "done" | "failed" =>
  tasks.every((task) => task.status === "done") ? "done" : "failed";

const ROLE_TIMEOUT_MS = Number(Bun.env.ORQ_ROLE_TIMEOUT_MS ?? 300_000);

export class IterationManager {
  private inFlight = false;

  constructor(
    private readonly store: PlanStore,
    private readonly pool: AgentPool,
    private readonly bus: Bus,
    private readonly config: Config,
  ) {}

  isRunning() {
    return this.inFlight;
  }

  private waitForRoleCompletion(agentId: string) {
    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        unsubscribe();
        resolve();
      };
      const unsubscribe = this.bus.subscribe(agentId, (event) => {
        if (event.payload.type === "agent_completed" && event.payload.agentId === agentId) {
          finish();
        }
      });
      const timeout = setTimeout(() => {
        if (settled) return;
        console.warn(`[iteration-manager] validator ${agentId} timed out, treating as no-op`);
        finish();
      }, ROLE_TIMEOUT_MS);
      void this.pool.waitForExit(agentId).then(() => {
        if (settled) return;
        finish();
      });
    });
  }

  private async spawnValidationRole(role: Role, summary: string, originalGoal: string, iterationNumber: number, maxIterations: number) {
    const member = this.config.team.find((item) => item.role === role);
    if (!member) return null;
    const prompt = [
      `You are validating run progress at iteration boundary ${iterationNumber} of ${maxIterations} (max).`,
      "",
      "Original user goal (the run's PRD — your north star):",
      originalGoal,
      "",
      "Current state — what each task delivered so far:",
      summary,
      "",
      "Your job:",
      "1. Compare the deliverables above to the original user goal.",
      "2. Identify gaps, missing edge cases, robustness concerns, missing tests, missing documentation, or anything that does not yet match the original intent.",
      "3. If you find any, call `emit_tasks` with refinement tasks. Each task must have a clear `title`, a precise `description`, and `depends_on` (use [] if independent of other refinements).",
      "4. After emitting tasks (or determining genuinely none are needed), call `report_complete` with a short summary of your assessment.",
      "",
      `Iterations remaining after this boundary: ${Math.max(0, maxIterations - iterationNumber)}. The user has explicitly requested all iterations be used to refine the deliverable; lean toward emitting refinement tasks if you can identify ANY gap. Only complete without emitting if the deliverable already perfectly matches the original goal in code, tests, and documentation.`,
    ].join("\n");
    return this.pool.spawn(role, member.cli, member.model, prompt, { command: member.command });
  }

  async onWaveEmpty() {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const plan = await this.store.loadPlan();
      if (plan.current_iteration >= plan.max_iterations) {
        const tasksAtCap = await this.store.loadTasks();
        const status = finalRunStatus(tasksAtCap);
        await this.store.savePlan({ ...plan, status, updated_at: new Date().toISOString() });
        this.bus.publish({ tags: [plan.runId], payload: { type: "run_completed", runId: plan.runId } });
        return;
      }
      const tasks = await this.store.loadTasks();
      const previous = await this.store.loadIterations();
      const nextNumber = plan.current_iteration + 1;
      const iteration: Iteration = {
        id: nextIterationId(previous.map((item) => item.id)),
        number: nextNumber,
        runId: plan.runId,
        trigger: "architect_replan",
        started_at: new Date().toISOString(),
        task_ids: [],
        summary: tasks.map((task) => `${task.id}: ${task.summary ?? task.title}`).join("\n"),
      };
      await this.store.saveIteration(iteration);
      await this.store.savePlan({ ...plan, current_iteration: nextNumber, updated_at: new Date().toISOString() });
      this.bus.publish({ tags: [plan.runId, iteration.id], payload: { type: "iteration_started", iterationId: iteration.id, number: nextNumber, trigger: iteration.trigger } });
      const summary = iteration.summary ?? "No summary";
      const agents = await Promise.all([
        this.spawnValidationRole("architect", summary, plan.prompt, nextNumber, plan.max_iterations),
        this.spawnValidationRole("pm", summary, plan.prompt, nextNumber, plan.max_iterations),
        this.spawnValidationRole("qa", summary, plan.prompt, nextNumber, plan.max_iterations),
      ]);
      try {
        await Promise.all(agents.filter(Boolean).map((agent) => this.waitForRoleCompletion(agent!.id)));
      } catch (error) {
        for (const agent of agents.filter(Boolean)) {
          this.pool.kill(agent!.id);
        }
        throw error;
      }
      const refreshed = await this.store.loadIterations();
      const updatedIteration = refreshed.find((item) => item.id === iteration.id);
      const tasksAfter = await this.store.loadTasks();
      const hasNewTasks = tasksAfter.some((task) => task.iteration === nextNumber);
      await this.store.saveIteration({
        ...(updatedIteration ?? iteration),
        task_ids: tasksAfter.filter((task) => task.iteration === nextNumber).map((task) => task.id),
        ended_at: new Date().toISOString(),
      });
      if (!hasNewTasks) {
        const refreshedPlan = await this.store.loadPlan();
        const status = finalRunStatus(tasksAfter);
        await this.store.savePlan({ ...refreshedPlan, status, updated_at: new Date().toISOString() });
        this.bus.publish({ tags: [plan.runId, iteration.id], payload: { type: "iteration_completed", iterationId: iteration.id } });
        this.bus.publish({ tags: [plan.runId], payload: { type: "run_completed", runId: plan.runId } });
      }
    } finally {
      this.inFlight = false;
    }
  }
}
