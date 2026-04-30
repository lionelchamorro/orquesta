import type { AgentPool } from "../agents/pool";
import { detectRateLimit, quotaMessage, type RateLimitInfo } from "../agents/rate-limit";
import type { Bus } from "../bus/bus";
import { existsSync, statSync } from "node:fs";
import { createIsolatedWorkspace, createTaskWorktree, ensureRepoReady, hasUncommittedChanges, safeGitOutput } from "../core/git";
import { nextSubtaskId } from "../core/ids";
import type { PlanStore } from "../core/plan-store";
import type { Config, Role, Subtask, SubtaskType, Task } from "../core/types";
import { closeTask } from "./task-closure";
import path from "node:path";

const DIFF_BODY_MAX_CHARS = 30_000;
const FILE_SCOPE_MAX = 200;

const scopedWorkspaceFiles = (workspacePath?: string) => {
  if (!workspacePath || !existsSync(workspacePath)) return [];
  return Array.from(new Bun.Glob("**/*").scanSync({ cwd: workspacePath }))
    .filter((file) =>
      !file.startsWith(".git/")
      && !file.startsWith(".orq/")
      && !file.startsWith(".orquesta/")
      && statSync(path.join(workspacePath, file), { throwIfNoEntry: false })?.isFile(),
    )
    .sort()
    .slice(0, FILE_SCOPE_MAX);
};

const buildScopedPrompt = (task: Task, role: Role, action: string): string => {
  const lines: string[] = [
    `Task ${task.id}: ${task.title}`,
    "",
    "Task description:",
    task.description ?? task.title,
    "",
  ];
  if (task.worktree_path) {
    lines.push(`${task.base_branch ? "Worktree" : "Workspace"} root (where source files live): ${task.worktree_path}`);
    lines.push(
      "Your shell cwd is a subdirectory of that root (.orq/<sub-id>) used for MCP wiring; it is NOT the place to put source files. Always create or edit files at paths relative to the root above, or use absolute paths anchored there.",
    );
    lines.push("");
  }
  if ((role === "tester" || role === "critic") && task.worktree_path && task.base_branch) {
    const stat = safeGitOutput(task.worktree_path, ["diff", "--stat", `${task.base_branch}..HEAD`]).trim();
    const body = safeGitOutput(task.worktree_path, ["diff", `${task.base_branch}..HEAD`]);
    lines.push(`Diff vs ${task.base_branch} (this is the SOLE scope of your ${role === "tester" ? "testing" : "review"}):`);
    lines.push("```");
    lines.push(stat || "(no changes yet)");
    lines.push("```");
    if (body) {
      const truncated = body.length > DIFF_BODY_MAX_CHARS ? `${body.slice(0, DIFF_BODY_MAX_CHARS)}\n... (truncated)` : body;
      lines.push("```diff");
      lines.push(truncated);
      lines.push("```");
    }
    lines.push("");
  } else if ((role === "tester" || role === "critic") && task.worktree_path) {
    const files = scopedWorkspaceFiles(task.worktree_path);
    lines.push(`Non-git workspace scope (files currently present for this task):`);
    lines.push("```");
    lines.push(files.length > 0 ? files.join("\n") : "(no source files found)");
    lines.push("```");
    lines.push("");
  }
  lines.push(action);
  return lines.join("\n");
};

const SUBTASK_TIMEOUT_MS = Number(Bun.env.ORQ_SUBTASK_TIMEOUT_MS ?? 300_000);

class QuotaFailure extends Error {
  constructor(readonly info: RateLimitInfo) {
    super(quotaMessage(info));
  }
}

const waitForSubtask = (bus: Bus, pool: AgentPool, agentId: string, subtaskId: string) =>
  new Promise<{ outcome: "completed" | "failed" | "failed_quota"; rateLimit?: RateLimitInfo }>((resolve) => {
    let settled = false;
    const finish = (outcome: "completed" | "failed" | "failed_quota", rateLimit?: RateLimitInfo) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      unsubscribe();
      resolve({ outcome, rateLimit });
    };
    const unsubscribe = bus.subscribe(subtaskId, (event) => {
      if (event.payload.type === "subtask_completed" && event.payload.subtaskId === subtaskId) {
        finish("completed");
      }
      if (event.payload.type === "subtask_failed" && event.payload.subtaskId === subtaskId) {
        const rateLimit = detectRateLimit(event.payload.reason);
        finish(rateLimit ? "failed_quota" : "failed", rateLimit ?? undefined);
      }
    });
    const timeout = setTimeout(() => {
      if (settled) return;
      console.warn(`[task-pipeline] subtask ${subtaskId} timed out, marking failed`);
      finish("failed");
    }, SUBTASK_TIMEOUT_MS);
    void pool.waitForExit(agentId).then(() => {
      if (settled) return;
      const rateLimit = pool.getRateLimit(agentId);
      if (rateLimit) {
        finish("failed_quota", rateLimit);
        return;
      }
      console.warn(`[task-pipeline] agent ${agentId} exited before reporting ${subtaskId}, marking failed`);
      finish("failed");
    });
  });

export class TaskPipeline {
  constructor(
    private readonly store: PlanStore,
    private readonly bus: Bus,
    private readonly pool: AgentPool,
    private readonly config: Config,
  ) {}

  private async createSubtask(task: Task, type: SubtaskType, role: Role, prompt: string, depends_on: string[]) {
    const existing = await this.store.loadSubtasks(task.id);
    const id = nextSubtaskId(existing.map((item) => item.id));
    const subtask: Subtask = {
      id,
      taskId: task.id,
      type,
      role,
      status: "pending",
      prompt,
      depends_on,
      created_at: new Date().toISOString(),
    };
    task.subtasks.push(id);
    task.updated_at = new Date().toISOString();
    await this.store.saveSubtask(subtask);
    await this.store.saveTask(task);
    return subtask;
  }

  private teamMember(role: Role) {
    return this.config.team.find((member) => member.role === role) ?? this.config.team[0];
  }

  private async runSingle(task: Task, type: SubtaskType, role: Role, prompt: string, depends_on: string[] = []) {
    const subtask = await this.createSubtask(task, type, role, prompt, depends_on);
    const member = this.teamMember(role);
    const sessionDir = task.worktree_path ? path.join(task.worktree_path, ".orq", subtask.id) : undefined;
    const agent = await this.pool.spawn(role, member.cli, member.model, prompt, {
      taskId: task.id,
      subtaskId: subtask.id,
      command: member.command,
      sessionDir,
    });
    await this.store.transitionSubtask(task.id, subtask.id, "running", {
      started_at: new Date().toISOString(),
      agentId: agent.id,
    });
    await this.store.saveTask({ ...task, status: "running", started_at: task.started_at ?? new Date().toISOString() });
    const { outcome, rateLimit: eventRateLimit } = await waitForSubtask(this.bus, this.pool, agent.id, subtask.id);
    const rateLimit = eventRateLimit ?? this.pool.getRateLimit(agent.id) ?? (outcome === "failed_quota" ? detectRateLimit(`${agent.final_text ?? ""}\n${agent.stop_reason ?? ""}`) : null);
    if (outcome === "failed_quota" || rateLimit) {
      const info = rateLimit ?? { message: "API rate limit exceeded" };
      const message = quotaMessage(info);
      const now = new Date().toISOString();
      const currentPlan = await this.store.loadPlan();
      await this.store.saveSubtask({
        ...(await this.store.loadSubtask(task.id, subtask.id)),
        status: "failed_quota",
        completed_at: now,
        quota_reset_at: info.reset_at,
        summary: message,
      });
      await this.store.saveTask({
        ...(await this.store.loadTask(task.id)),
        status: "failed_quota",
        updated_at: now,
        quota_reset_at: info.reset_at,
        summary: message,
      });
      await this.store.savePlan({
        ...currentPlan,
        status: "failed_quota",
        updated_at: now,
        quota_reset_at: info.reset_at,
      });
      this.bus.publish({
        tags: [task.id, `iter-${task.iteration}`],
        payload: { type: "activity", fromAgent: "system", message },
      });
      throw new QuotaFailure(info);
    }
    const attempted = await this.store.loadTask(task.id);
    await this.store.saveTask({
      ...attempted,
      attempt_count: attempted.attempt_count + 1,
      updated_at: new Date().toISOString(),
    });
    const result = await this.store.loadSubtask(task.id, subtask.id);
    if (outcome === "failed" || result.status === "failed") {
      const failed = await this.store.loadTask(task.id);
      await this.store.saveTask({ ...failed, status: "failed", updated_at: new Date().toISOString() });
      throw new Error(`Subtask ${subtask.id} failed`);
    }
    return result;
  }

  async run(task: Task) {
    let current = await this.store.loadTask(task.id);
    let closureReason: NonNullable<Task["closure_reason"]> = "critic_ok";
    let failedQuota = false;
    try {
      current = await this.store.incrementTaskAttempt(current.id);
      if (current.status !== "running") {
        current = await this.store.transitionTask(current.id, "running", {
          started_at: current.started_at ?? new Date().toISOString(),
        });
      }
      const plan = await this.store.loadPlan();
      if (this.config.git?.enabled) {
        if (!ensureRepoReady(this.store.root, this.config.git.baseBranch)) {
          throw new Error(
            `daemon root is not a git repository with base branch ${this.config.git.baseBranch}; run git init and create ${this.config.git.baseBranch}, or set git.enabled=false in .orquesta/crew/config.json`,
          );
        }
        const workspace = createTaskWorktree(this.store.root, task.id, this.config.git.baseBranch, plan.runId);
        current = {
          ...current,
          worktree_path: workspace.worktreePath,
          branch: workspace.branch,
          base_branch: workspace.baseBranch,
          updated_at: new Date().toISOString(),
        };
        await this.store.saveTask(current);
      } else if (!current.worktree_path) {
        const workspace = createIsolatedWorkspace(this.store.root, task.id, plan.runId);
        current = {
          ...current,
          worktree_path: workspace.worktreePath,
          updated_at: new Date().toISOString(),
        };
        await this.store.saveTask(current);
      }
      const coderPrompt = buildScopedPrompt(current, "coder", "Implement the task as described above. Stay strictly within the task's stated scope.");
      const code = await this.runSingle(current, "code", "coder", coderPrompt);
      current = await this.store.loadTask(task.id);
      const coderProducedChanges = current.worktree_path && current.base_branch
        ? safeGitOutput(current.worktree_path, ["diff", "--name-only", `${current.base_branch}..HEAD`]).trim().length > 0
          || hasUncommittedChanges(current.worktree_path)
        : scopedWorkspaceFiles(current.worktree_path).length > 0;
      if (!coderProducedChanges) {
        closureReason = "no_changes";
        this.bus.publish({
          tags: [task.id, `iter-${task.iteration}`],
          payload: { type: "activity", fromAgent: "system", message: current.base_branch ? `Coder produced no diff vs ${current.base_branch}; skipping tester/critic.` : "Coder produced no files in the isolated workspace; skipping tester/critic." },
        });
        return;
      }
      const testerPrompt = buildScopedPrompt(current, "tester", "Run any existing tests that exercise the files in the diff above. Do NOT create new test files in this subtask — writing new tests is the job of a dedicated test task in this run. If no tests exist for the changed files, report that fact in `report_complete` (do not invent tests).");
      let test = await this.runSingle(current, "test", "tester", testerPrompt, [code.id]);
      current = await this.store.loadTask(task.id);
      const criticPrompt = buildScopedPrompt(current, "critic", "Review the diff above against the task description. Flag any mismatch between the diff and the stated intent as a finding. Do NOT manufacture findings about things outside the task's scope.");
      let critic = await this.runSingle(current, "critic", "critic", criticPrompt, [test.id]);

      for (let attempt = 1; attempt < this.config.work.maxAttemptsPerTask; attempt += 1) {
        const member = this.teamMember("coder");
        let lastFixId = critic.id;
        let drainedAny = false;
        while (true) {
          const subtasks = await this.store.loadSubtasks(task.id);
          const fix = subtasks.find((subtask) => subtask.type === "fix" && subtask.status === "pending");
          if (!fix) break;
          drainedAny = true;
          const sessionDir = current.worktree_path ? path.join(current.worktree_path, ".orq", fix.id) : undefined;
          const agent = await this.pool.spawn("coder", member.cli, member.model, fix.prompt, {
            taskId: task.id,
            subtaskId: fix.id,
            command: member.command,
            sessionDir,
          });
          await this.store.saveSubtask({
            ...fix,
            status: "running",
            started_at: new Date().toISOString(),
            agentId: agent.id,
          });
          const outcome = await waitForSubtask(this.bus, this.pool, agent.id, fix.id);
          if (outcome === "failed") {
            closureReason = "failed_subtask";
            throw new Error(`Fix subtask ${fix.id} failed`);
          }
          lastFixId = fix.id;
        }
        if (!drainedAny) break;
        current = await this.store.loadTask(task.id);
        const retestPrompt = buildScopedPrompt(current, "tester", "Re-run any existing tests that exercise the files in the (now-updated) diff above. Do NOT create new test files. If no tests exist, report that fact.");
        test = await this.runSingle(current, "test", "tester", retestPrompt, [lastFixId]);
        current = await this.store.loadTask(task.id);
        const rereviewPrompt = buildScopedPrompt(current, "critic", "Re-review the diff above (post-fix) against the task description. Confirm the prior findings were addressed without introducing new scope creep.");
        critic = await this.runSingle(current, "critic", "critic", rereviewPrompt, [test.id]);
        if (!critic.findings?.length) break;
        if (attempt === this.config.work.maxAttemptsPerTask - 1) {
          closureReason = "max_attempts";
        }
      }
    } catch (error) {
      if (error instanceof QuotaFailure) {
        failedQuota = true;
        return;
      }
      if (closureReason !== "max_attempts") {
        closureReason = "failed_subtask";
      }
      this.bus.publish({
        tags: [task.id, `iter-${task.iteration}`],
        payload: { type: "activity", fromAgent: "system", message: error instanceof Error ? error.message : "Task pipeline failed" },
      });
    } finally {
      if (failedQuota) return;
      const closed = await closeTask({
        root: this.store.root,
        store: this.store,
        pool: this.pool,
        bus: this.bus,
        config: this.config,
        taskId: task.id,
        closureReason,
      });
      if (closed.status === "done") {
        this.bus.publish({ tags: [task.id, `iter-${task.iteration}`], payload: { type: "task_completed", taskId: task.id } });
      }
    }
  }
}
