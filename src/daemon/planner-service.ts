import { mkdirSync, rmSync } from "node:fs";
import type { AgentPool } from "../agents/pool";
import type { Bus } from "../bus/bus";
import { newRunId } from "../core/ids";
import type { PlanStore } from "../core/plan-store";
import type { Config, Plan } from "../core/types";

const PLANNER_PROMPT_PREFIX = "Initial user prompt:";

const clearPreviousTasks = (store: PlanStore) => {
  for (const relative of ["tasks", "subtasks", "iterations", "agents", "sessions", "worktrees", "asks"]) {
    rmSync(store.crewPath(relative), { recursive: true, force: true });
    mkdirSync(store.crewPath(relative), { recursive: true });
  }
};

const makePlan = (prompt: string): Plan => {
  const now = new Date().toISOString();
  return {
    runId: newRunId(),
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
  private draftTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly store: PlanStore,
    private readonly pool: AgentPool,
    private readonly options: { mcpPort: number; bus?: Bus; autonomous?: boolean; draftTimeoutMs?: number },
  ) {
    this.options.bus?.subscribe((tags) => Boolean(this.currentAgentId && tags.includes(this.currentAgentId)), (event) => {
      if (event.payload.type !== "tasks_emitted" || !this.currentAgentId) return;
      void this.finalizeDraft("tasks_emitted").catch((error) => {
        this.options.bus?.publish({
          tags: [this.currentAgentId ?? "planner"],
          payload: {
            type: "activity",
            fromAgent: this.currentAgentId ?? "planner",
            message: `planner finalize failed: ${error instanceof Error ? error.message : "unknown error"}`,
          },
        });
      });
    });
  }

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
    this.clearDraftTimeout();
  }

  async startPlanner(prompt: string): Promise<{ agentId: string; runId: string }> {
    if (await this.isCurrentAlive()) {
      const plan = await this.store.loadPlan();
      return { agentId: this.currentAgentId!, runId: plan.runId };
    }

    const plan = makePlan(prompt);
    clearPreviousTasks(this.store);
    await this.store.savePlan(plan);
    await Bun.write(this.store.crewPath("run.source"), "planner\n");
    const config = await this.store.loadConfig();
    const member = plannerMember(config);
    const spawnPrompt = `${PLANNER_PROMPT_PREFIX}\n\n${prompt}`;
    const agent = await this.pool.spawn("planner", member.cli, member.model, spawnPrompt, {
      command: member.command,
      port: this.options.mcpPort,
    });
    this.currentAgentId = agent.id;
    this.armDraftTimeout(agent.id, plan.runId);
    this.options.bus?.publish({
      tags: [plan.runId, agent.id, "planner"],
      payload: { type: "activity", fromAgent: agent.id, message: "planner started drafting" },
    });

    void this.pool.waitForExit(agent.id).then(async () => {
      if (this.currentAgentId !== agent.id) return;
      this.currentAgentId = null;
      this.clearDraftTimeout();
      const current = await this.store.loadPlan();
      if (current.status === "drafting") {
        const finalized = await this.finalizeDraft("planner_exit");
        if (!finalized) {
          const updatedAt = new Date().toISOString();
          await this.store.savePlan({ ...current, status: "failed", updated_at: updatedAt });
          this.options.bus?.publish({
            tags: [current.runId, agent.id, "planner"],
            payload: { type: "agent_failed", agentId: agent.id, reason: "planner exited before emitting tasks" },
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
    this.clearDraftTimeout();
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

  private clearDraftTimeout() {
    if (!this.draftTimeout) return;
    clearTimeout(this.draftTimeout);
    this.draftTimeout = null;
  }

  private armDraftTimeout(agentId: string, runId: string) {
    this.clearDraftTimeout();
    const timeoutMs = this.options.draftTimeoutMs ?? Number(Bun.env.ORQ_PLANNER_DRAFT_TIMEOUT_MS ?? 300_000);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return;
    this.draftTimeout = setTimeout(() => {
      void (async () => {
        const plan = await this.store.loadPlan();
        if (this.currentAgentId !== agentId || plan.runId !== runId || plan.status !== "drafting") return;
        const tasks = await this.store.loadTasks();
        if (tasks.length > 0 && await this.finalizeDraft("draft_timeout_with_tasks")) return;
        const updatedAt = new Date().toISOString();
        await this.store.savePlan({ ...plan, status: "failed", updated_at: updatedAt });
        this.pool.kill(agentId);
        this.currentAgentId = null;
        this.options.bus?.publish({
          tags: [runId, agentId, "planner"],
          payload: { type: "agent_failed", agentId, reason: `planner did not emit tasks within ${timeoutMs}ms` },
        });
      })().catch((error) => {
        this.options.bus?.publish({
          tags: [runId, agentId, "planner"],
          payload: {
            type: "agent_failed",
            agentId,
            reason: `planner timeout handler failed: ${error instanceof Error ? error.message : "unknown error"}`,
          },
        });
      });
    }, timeoutMs);
  }

  private async finalizeDraft(reason: string): Promise<boolean> {
    const current = await this.store.loadPlan();
    if (current.status !== "drafting") return false;
    const tasks = await this.store.loadTasks();
    if (tasks.length === 0) return false;
    const updatedAt = new Date().toISOString();
    const autoApprove = this.options.autonomous ?? false;
    const next: Plan = {
      ...current,
      task_count: tasks.length,
      status: autoApprove ? "approved" : "awaiting_approval",
      updated_at: updatedAt,
    };
    await this.store.savePlan(next);
    this.clearDraftTimeout();
    this.options.bus?.publish({
      tags: [next.runId, this.currentAgentId ?? "planner", "planner"],
      payload: { type: "activity", fromAgent: this.currentAgentId ?? "planner", message: `planner finalized draft: ${reason}` },
    });
    if (autoApprove) {
      this.options.bus?.publish({
        tags: [next.runId],
        payload: { type: "plan_approved", runId: next.runId, at: updatedAt },
      });
    }
    return true;
  }
}
