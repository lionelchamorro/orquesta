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

  private currentConsultantPrompt(role: "pm" | "architect", iteration: Iteration, goal: string) {
    return [
      `You are the ${role} consultant for iteration ${iteration.number}.`,
      "",
      "Goal:",
      goal,
      "",
      "During this wave, workers may ask routed questions formatted:",
      "`[ORQ] question from <agentId>: <question> [askId=<id>]`",
      "",
      "Answer with `answer_ask({ askId, answer })`. At wave close you will be asked to validate this same iteration.",
    ].join("\n");
  }

  async ensureConsultantsLive() {
    const plan = await this.store.loadPlan();
    const iterations = await this.store.loadIterations();
    const iteration = iterations.find((item) => item.number === plan.current_iteration);
    if (!iteration || iteration.ended_at) return true;
    if (iteration.phase !== "executing" && iteration.phase !== "validating") return true;
    const roles: Array<"pm" | "architect"> = ["pm", "architect"];
    const pool = this.pool as AgentPool & {
      getConsultant?: (role: "pm" | "architect", iterationId: string) => Promise<unknown>;
      spawnConsultant?: (role: "pm" | "architect", member: Config["team"][number], context: { iterationId: string; prompt: string }) => Promise<unknown>;
    };
    for (const role of roles) {
      const member = this.config.team.find((item) => item.role === role);
      if (!member) continue;
      const live = await pool.getConsultant?.(role, iteration.id);
      if (live) continue;
      const spawned = await pool.spawnConsultant?.(role, member, {
        iterationId: iteration.id,
        prompt: this.currentConsultantPrompt(role, iteration, plan.prompt),
      });
      if (!spawned) return false;
    }
    return iteration.phase === "executing";
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

  private async spawnValidationRole(
    role: Role,
    summary: string,
    originalGoal: string,
    iterationNumber: number,
    maxIterations: number,
    alreadyProposed: Task[],
  ) {
    const member = this.config.team.find((item) => item.role === role);
    if (!member) return null;
    const proposedSection = alreadyProposed.length === 0
      ? "(none yet — you are the first validator to run)"
      : alreadyProposed.map((task) => `- ${task.id}: ${task.title}`).join("\n");
    const prompt = [
      `You are validating run progress at iteration boundary ${iterationNumber} of ${maxIterations} (max).`,
      "",
      "Original user goal (the run's PRD — your north star):",
      originalGoal,
      "",
      "Current state — what each task delivered so far:",
      summary,
      "",
      "Refinement tasks ALREADY proposed by other validators in this iteration boundary (do NOT duplicate them — only add what is genuinely missing from a different lens):",
      proposedSection,
      "",
      "Your job:",
      "1. Compare the deliverables above to the original user goal, through your role's specific lens.",
      "2. Identify gaps that are NOT already covered by the refinement tasks listed above.",
      "3. If you find new gaps, call `emit_tasks` with refinement tasks. Each task must have a clear `title`, a precise `description`, and `depends_on` (use [] if independent).",
      "4. If everything you would have flagged is already covered above, simply call `report_complete` saying so — do not re-propose.",
      "5. After emitting (or deciding not to), call `report_complete` with a short summary of your assessment.",
      "",
      `Iterations remaining after this boundary: ${Math.max(0, maxIterations - iterationNumber)}. Lean toward emitting refinement tasks if you find genuine gaps not already covered. Avoid manufacturing duplicates of the proposed list.`,
    ].join("\n");
    return this.pool.spawn(role, member.cli, member.model, prompt, { command: member.command });
  }

  private validationPrompt(role: Role, summary: string, originalGoal: string, iterationNumber: number, maxIterations: number, alreadyProposed: Task[]) {
    const proposedSection = alreadyProposed.length === 0
      ? "(none yet — you are the first validator to run)"
      : alreadyProposed.map((task) => `- ${task.id}: ${task.title}`).join("\n");
    return [
      `[ORQ] iteration boundary validation for ${role}.`,
      `Iteration ${iterationNumber} of ${maxIterations}.`,
      "",
      "Original user goal:",
      originalGoal,
      "",
      "Current state:",
      summary,
      "",
      "Refinement tasks already proposed:",
      proposedSection,
      "",
      "If you find gaps, call `emit_tasks`. Then call `report_complete`.",
    ].join("\n");
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
      const pendingValidation = previous.find((item) => item.number === plan.current_iteration && item.phase === "validating" && !item.ended_at);
      const nextNumber = pendingValidation?.number ?? plan.current_iteration + 1;
      const iteration: Iteration = pendingValidation ?? {
        id: nextIterationId(previous.map((item) => item.id)),
        number: nextNumber,
        runId: plan.runId,
        trigger: "architect_replan",
        phase: "validating",
        started_at: new Date().toISOString(),
        task_ids: [],
        summary: tasks.map((task) => `${task.id}: ${task.summary ?? task.title}`).join("\n"),
      };
      await this.store.saveIteration(iteration);
      if (!pendingValidation) {
        await this.store.savePlan({ ...plan, current_iteration: nextNumber, updated_at: new Date().toISOString() });
        this.bus.publish({ tags: [plan.runId, iteration.id], payload: { type: "iteration_started", iterationId: iteration.id, number: nextNumber, trigger: iteration.trigger } });
      }
      const summary = iteration.summary ?? "No summary";
      const validatorRoles: Role[] = ["architect", "pm", "qa"];
      try {
        for (const role of validatorRoles) {
          const proposedSoFar = (await this.store.loadTasks()).filter((task) => task.iteration === nextNumber);
          if (role === "architect" || role === "pm") {
            const existing = (await this.store.loadAgents()).find((agent) => agent.role === role && agent.status !== "dead");
            if (existing) {
              this.pool.write(existing.id, `${this.validationPrompt(role, summary, plan.prompt, nextNumber, plan.max_iterations, proposedSoFar)}\n`);
              await this.waitForRoleCompletion(existing.id);
              continue;
            }
          }
          const agent = await this.spawnValidationRole(role, summary, plan.prompt, nextNumber, plan.max_iterations, proposedSoFar);
          if (!agent) continue;
          await this.waitForRoleCompletion(agent.id);
        }
      } catch (error) {
        const liveAgents = await this.store.loadAgents();
        for (const agent of liveAgents.filter((a) => a.status !== "dead")) {
          this.pool.kill(agent.id);
        }
        throw error;
      }
      const refreshed = await this.store.loadIterations();
      const updatedIteration = refreshed.find((item) => item.id === iteration.id);
      const tasksAfter = await this.store.loadTasks();
      const hasNewTasks = tasksAfter.some((task) => task.iteration === nextNumber);
      await this.store.saveIteration({
        ...(updatedIteration ?? iteration),
        phase: "executing",
        task_ids: tasksAfter.filter((task) => task.iteration === nextNumber).map((task) => task.id),
        ended_at: new Date().toISOString(),
      });
      for (const agent of (await this.store.loadAgents()).filter((item) =>
        (item.role === "pm" || item.role === "architect") &&
        item.status !== "dead" &&
        item.bound_iteration === iteration.id
      )) {
        this.pool.kill(agent.id);
      }
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
