import { mkdirSync, rmSync } from "node:fs";
import type { AgentPool } from "../agents/pool";
import type { PlanStore } from "../core/plan-store";
import type { Config, Plan } from "../core/types";

const PLANNER_PROMPT_PREFIX = "Initial user prompt:";

const clearPreviousTasks = (store: PlanStore) => {
  for (const relative of ["tasks", "subtasks", "iterations", "agents", "sessions"]) {
    rmSync(store.crewPath(relative), { recursive: true, force: true });
    mkdirSync(store.crewPath(relative), { recursive: true });
  }
};

const makePlan = (prompt: string): Plan => {
  const now = new Date().toISOString();
  return {
    runId: "run-1",
    prd: "(prompt)",
    prompt,
    status: "drafting",
    created_at: now,
    updated_at: now,
    task_count: 0,
    completed_count: 0,
    current_iteration: 1,
    max_iterations: 2,
  };
};

const plannerMember = (config: Config) =>
  config.team.find((member) => member.role === "planner") ?? config.team[0];

export class PlannerService {
  private currentAgentId: string | null = null;

  constructor(
    private readonly store: PlanStore,
    private readonly pool: AgentPool,
    private readonly options: { mcpPort: number },
  ) {}

  getCurrentAgentId(): string | null {
    return this.currentAgentId;
  }

  async isCurrentAlive(): Promise<boolean> {
    if (!this.currentAgentId) return false;
    const agent = await this.store.loadAgent(this.currentAgentId);
    return Boolean(agent && agent.status !== "dead");
  }

  killCurrent(): void {
    if (!this.currentAgentId) return;
    this.pool.kill(this.currentAgentId);
    this.currentAgentId = null;
  }

  async startPlanner(prompt: string): Promise<{ agentId: string; runId: string }> {
    if (await this.isCurrentAlive()) {
      const plan = await this.store.loadPlan();
      return { agentId: this.currentAgentId!, runId: plan.runId };
    }

    const plan = makePlan(prompt);
    clearPreviousTasks(this.store);
    await this.store.savePlan(plan);
    const config = await this.store.loadConfig();
    const member = plannerMember(config);
    const spawnPrompt = `${PLANNER_PROMPT_PREFIX}\n\n${prompt}`;
    const agent = await this.pool.spawn("planner", member.cli, member.model, spawnPrompt, {
      command: member.command,
      port: this.options.mcpPort,
    });
    this.currentAgentId = agent.id;

    void this.pool.waitForExit(agent.id).then(async () => {
      if (this.currentAgentId === agent.id) this.currentAgentId = null;
      const current = await this.store.loadPlan();
      if (current.status === "drafting") {
        const tasks = await this.store.loadTasks();
        if (tasks.length > 0) {
          await this.store.savePlan({
            ...current,
            task_count: tasks.length,
            status: "awaiting_approval",
            updated_at: new Date().toISOString(),
          });
        }
      }
    });

    return { agentId: agent.id, runId: plan.runId };
  }

  async reset(): Promise<void> {
    if (this.currentAgentId) {
      this.pool.kill(this.currentAgentId);
      this.currentAgentId = null;
    }
    clearPreviousTasks(this.store);
    const now = new Date().toISOString();
    await this.store.savePlan({
      runId: "run-1",
      prd: "(prompt)",
      prompt: "",
      status: "done",
      created_at: now,
      updated_at: now,
      task_count: 0,
      completed_count: 0,
      current_iteration: 1,
      max_iterations: 1,
    });
  }
}
