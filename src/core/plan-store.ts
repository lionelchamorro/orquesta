import { mkdirSync } from "node:fs";
import { open, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { detectCycle } from "./dag";
import {
  AgentSchema,
  ConfigSchema,
  IterationSchema,
  PendingAskSchema,
  PlanSchema,
  SubtaskSchema,
  TaskSchema,
} from "./schemas";
import type { Agent, Config, Iteration, PendingAsk, Plan, Subtask, Task, TaskStatus, TeamMember } from "./types";

const readJson = async <T>(filePath: string, fallback: T): Promise<T> => {
  const file = Bun.file(filePath);
  if (!(await file.exists())) return fallback;
  return (await file.json()) as T;
};

const ensureDir = (dirPath: string) => mkdirSync(dirPath, { recursive: true });
let atomicWriteCounter = 0;

const writeJsonAtomic = async (filePath: string, value: unknown) => {
  ensureDir(path.dirname(filePath));
  atomicWriteCounter = (atomicWriteCounter + 1) % Number.MAX_SAFE_INTEGER;
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${atomicWriteCounter}.tmp`);
  const data = `${JSON.stringify(value, null, 2)}\n`;
  const handle = await open(tempPath, "w");
  try {
    await handle.writeFile(data, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
};

const planDefaults = (plan: Partial<Plan>): Plan => ({
  runId: plan.runId ?? "run-1",
  prd: plan.prd ?? "(prompt)",
  prompt: plan.prompt ?? "",
  status: plan.status ?? "done",
  created_at: plan.created_at ?? new Date().toISOString(),
  updated_at: plan.updated_at ?? new Date().toISOString(),
  task_count: plan.task_count ?? 0,
  completed_count: plan.completed_count ?? 0,
  current_iteration: plan.current_iteration ?? 1,
  max_iterations: plan.max_iterations ?? 1,
  quota_reset_at: plan.quota_reset_at,
});

const configDefaults = (config: Record<string, unknown>): Config => {
  const models = (config.models_legacy ?? config.models ?? {}) as Record<string, string>;
  const defaultTeam: TeamMember[] = [
    { role: "coder", cli: "codex", model: models.worker ?? "gpt-5.5" },
    { role: "tester", cli: "claude", model: models.worker ?? "claude-opus-4-7" },
    { role: "critic", cli: "claude", model: models.reviewer ?? "claude-opus-4-7" },
    { role: "architect", cli: "claude", model: models.reviewer ?? "claude-opus-4-7" },
    { role: "pm", cli: "claude", model: models.reviewer ?? "claude-opus-4-7" },
    { role: "qa", cli: "claude", model: models.reviewer ?? "claude-opus-4-7" },
  ];
  const userTeam = Array.isArray(config.team) ? (config.team as Config["team"]) : [];
  const userByRole = new Map(userTeam.map((member) => [member.role, member]));
  const mergedDefaults = defaultTeam.map((member) => userByRole.get(member.role) ?? member);
  const mergedRoles = new Set(mergedDefaults.map((member) => member.role));
  const extras = userTeam.filter((member) => !mergedRoles.has(member.role));
  const team = [...mergedDefaults, ...extras];
  return {
    dependencies: (config.dependencies as Config["dependencies"]) ?? "strict",
    concurrency: (config.concurrency as Config["concurrency"]) ?? { workers: 2, max: 4 },
    review: (config.review as Config["review"]) ?? { enabled: true, maxIterations: 2 },
    work: {
      maxAttemptsPerTask: Number((config.work as Record<string, unknown> | undefined)?.maxAttemptsPerTask ?? 3),
      maxWaves: Number((config.work as Record<string, unknown> | undefined)?.maxWaves ?? 50),
      maxIterations: Number(
        (config.work as Record<string, unknown> | undefined)?.maxIterations ??
          (config.review as Record<string, unknown> | undefined)?.maxIterations ??
          2,
      ),
      maxQuotaWaitMs: Number((config.work as Record<string, unknown> | undefined)?.maxQuotaWaitMs ?? 7_200_000),
    },
    git: {
      enabled: Boolean((config.git as Record<string, unknown> | undefined)?.enabled ?? true),
      baseBranch: String((config.git as Record<string, unknown> | undefined)?.baseBranch ?? "main"),
      autoCommit: Boolean((config.git as Record<string, unknown> | undefined)?.autoCommit ?? true),
      removeWorktreeOnArchive: Boolean((config.git as Record<string, unknown> | undefined)?.removeWorktreeOnArchive ?? true),
    },
    team,
    models_legacy:
      Object.keys(models).length > 0
        ? {
            worker: models.worker ?? "claude-opus-4-7",
            reviewer: models.reviewer ?? "claude-opus-4-7",
          }
        : undefined,
  };
};

const taskDefaults = (task: Partial<Task>): Task => ({
  id: task.id ?? "task-1",
  title: task.title ?? "",
  description: task.description,
  status: task.status ?? "pending",
  depends_on: task.depends_on ?? [],
  iteration: task.iteration ?? 1,
  parent_task_id: task.parent_task_id,
  worktree_path: task.worktree_path,
  branch: task.branch,
  base_branch: task.base_branch,
  merge_commit: task.merge_commit,
  merge_error: task.merge_error,
  merged_at: task.merged_at,
  archive_path: task.archive_path,
  closure_reason: task.closure_reason,
  created_at: task.created_at ?? new Date().toISOString(),
  updated_at: task.updated_at ?? new Date().toISOString(),
  attempt_count: task.attempt_count ?? 0,
  started_at: task.started_at,
  completed_at: task.completed_at,
  quota_reset_at: task.quota_reset_at,
  summary: task.summary,
  evidence: task.evidence,
  subtasks: task.subtasks ?? [],
});

const subtaskDefaults = (subtask: Partial<Subtask>): Subtask => ({
  id: subtask.id ?? "sub-1",
  taskId: subtask.taskId ?? "task-1",
  type: subtask.type ?? "custom",
  role: subtask.role ?? "coder",
  status: subtask.status ?? "pending",
  agentId: subtask.agentId,
  prompt: subtask.prompt ?? "",
  depends_on: subtask.depends_on ?? [],
  created_at: subtask.created_at ?? new Date().toISOString(),
  started_at: subtask.started_at,
  completed_at: subtask.completed_at,
  quota_reset_at: subtask.quota_reset_at,
  summary: subtask.summary,
  output: subtask.output,
  artifacts: subtask.artifacts,
  findings: subtask.findings,
  fallback_attempts: subtask.fallback_attempts ?? [],
});

const iterationDefaults = (iteration: Partial<Iteration>): Iteration => ({
  id: iteration.id ?? "iter-1",
  number: iteration.number ?? 1,
  runId: iteration.runId ?? "run-1",
  trigger: iteration.trigger ?? "initial",
  phase: iteration.phase ?? "executing",
  started_at: iteration.started_at ?? new Date().toISOString(),
  ended_at: iteration.ended_at,
  task_ids: iteration.task_ids ?? [],
  summary: iteration.summary,
});

const taskTransitions: Record<TaskStatus, TaskStatus[]> = {
  pending: ["ready", "running", "blocked", "cancelled", "failed", "failed_quota"],
  ready: ["pending", "running", "blocked", "cancelled", "failed", "failed_quota"],
  running: ["pending", "done", "failed", "failed_quota", "cancelled", "blocked"],
  blocked: [],
  done: [],
  failed: [],
  failed_quota: ["pending", "ready"],
  cancelled: [],
};

const assertTransition = (from: TaskStatus, to: TaskStatus) => {
  if (from === to) return;
  if (!taskTransitions[from].includes(to)) {
    throw new Error(`Invalid status transition ${from} -> ${to}`);
  }
};

export class PlanStore {
  constructor(public readonly root: string) {}

  crewPath(...parts: string[]) {
    return path.join(this.root, ".orquesta", "crew", ...parts);
  }

  async loadPlan(): Promise<Plan> {
    return PlanSchema.parse(planDefaults(await readJson<Partial<Plan>>(this.crewPath("plan.json"), {})));
  }

  async savePlan(plan: Plan) {
    await writeJsonAtomic(this.crewPath("plan.json"), PlanSchema.parse(plan));
  }

  async loadConfig(): Promise<Config> {
    return ConfigSchema.parse(configDefaults(await readJson<Record<string, unknown>>(this.crewPath("config.json"), {})));
  }

  async saveConfig(config: Config) {
    await writeJsonAtomic(this.crewPath("config.json"), ConfigSchema.parse(config));
  }

  async loadTasks(): Promise<Task[]> {
    ensureDir(this.crewPath("tasks"));
    const files = Array.from(new Bun.Glob("*.json").scanSync({ cwd: this.crewPath("tasks"), absolute: true }));
    const tasks = await Promise.all(files.map((filePath) => readJson<Partial<Task>>(filePath, {})));
    return tasks.map((task) => TaskSchema.parse(taskDefaults(task))).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  }

  async loadTask(id: string): Promise<Task> {
    return TaskSchema.parse(taskDefaults(await readJson<Partial<Task>>(this.crewPath("tasks", `${id}.json`), { id })));
  }

  async taskExists(id: string): Promise<boolean> {
    return Bun.file(this.crewPath("tasks", `${id}.json`)).exists();
  }

  async saveTask(task: Task) {
    await writeJsonAtomic(this.crewPath("tasks", `${task.id}.json`), TaskSchema.parse(task));
    await this.recalculatePlanCounters();
  }

  async loadSubtasks(taskId: string): Promise<Subtask[]> {
    const dir = this.crewPath("subtasks", taskId);
    ensureDir(dir);
    const files = Array.from(new Bun.Glob("*.json").scanSync({ cwd: dir, absolute: true }));
    const subtasks = await Promise.all(files.map((filePath) => readJson<Partial<Subtask>>(filePath, {})));
    return subtasks.map((subtask) => SubtaskSchema.parse(subtaskDefaults(subtask))).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  }

  async loadSubtask(taskId: string, id: string): Promise<Subtask> {
    return SubtaskSchema.parse(subtaskDefaults(await readJson<Partial<Subtask>>(this.crewPath("subtasks", taskId, `${id}.json`), { id, taskId })));
  }

  async saveSubtask(subtask: Subtask) {
    await writeJsonAtomic(this.crewPath("subtasks", subtask.taskId, `${subtask.id}.json`), SubtaskSchema.parse(subtask));
  }

  async loadIterations(): Promise<Iteration[]> {
    ensureDir(this.crewPath("iterations"));
    const files = Array.from(new Bun.Glob("*.json").scanSync({ cwd: this.crewPath("iterations"), absolute: true }));
    const iterations = await Promise.all(files.map((filePath) => readJson<Partial<Iteration> | null>(filePath, null)));
    return iterations
      .filter((iteration): iteration is Partial<Iteration> => Boolean(iteration))
      .map((iteration) => IterationSchema.parse(iterationDefaults(iteration)))
      .sort((a, b) => a.number - b.number);
  }

  async saveIteration(iteration: Iteration) {
    await writeJsonAtomic(this.crewPath("iterations", `${iteration.id}.json`), IterationSchema.parse(iteration));
  }

  async loadAgents(): Promise<Agent[]> {
    ensureDir(this.crewPath("agents"));
    const files = Array.from(new Bun.Glob("*.json").scanSync({ cwd: this.crewPath("agents"), absolute: true }));
    const agents = await Promise.all(files.map((filePath) => readJson<Agent | null>(filePath, null)));
    return agents.filter(Boolean).map((agent) => AgentSchema.parse(agent));
  }

  async loadAgent(id: string): Promise<Agent | null> {
    const agent = await readJson<Agent | null>(this.crewPath("agents", `${id}.json`), null);
    return agent ? AgentSchema.parse(agent) : null;
  }

  async saveAgent(agent: Agent) {
    await writeJsonAtomic(this.crewPath("agents", `${agent.id}.json`), AgentSchema.parse(agent));
  }

  async transitionTask(id: string, status: TaskStatus, patch: Partial<Task> = {}): Promise<Task> {
    const task = await this.loadTask(id);
    assertTransition(task.status, status);
    const next = { ...task, ...patch, status, updated_at: new Date().toISOString() };
    if (["done", "failed", "blocked", "cancelled"].includes(status)) next.completed_at = next.completed_at ?? new Date().toISOString();
    await this.saveTask(next);
    if (task.status !== status) await this.recalculatePlanCounters();
    return next;
  }

  async transitionSubtask(taskId: string, id: string, status: TaskStatus, patch: Partial<Subtask> = {}): Promise<Subtask> {
    const subtask = await this.loadSubtask(taskId, id);
    assertTransition(subtask.status, status);
    const next = { ...subtask, ...patch, status };
    if (["done", "failed", "blocked", "cancelled"].includes(status)) next.completed_at = next.completed_at ?? new Date().toISOString();
    await this.saveSubtask(next);
    return next;
  }

  async incrementTaskAttempt(id: string): Promise<Task> {
    const task = await this.loadTask(id);
    const next = { ...task, attempt_count: task.attempt_count + 1, updated_at: new Date().toISOString() };
    await this.saveTask(next);
    return next;
  }

  async validateTaskGraph(tasks?: Task[]): Promise<void> {
    tasks = tasks ?? await this.loadTasks();
    const ids = new Set(tasks.map((task) => task.id));
    for (const task of tasks) {
      for (const dep of task.depends_on) {
        if (!ids.has(dep)) throw new Error(`Task ${task.id} depends on missing task ${dep}`);
      }
    }
    const cycle = detectCycle(tasks);
    if (cycle && cycle.length > 0) throw new Error(`Task dependency cycle detected: ${cycle.join(" -> ")}`);
  }

  async recalculatePlanCounters(): Promise<void> {
    const planPath = this.crewPath("plan.json");
    if (!(await Bun.file(planPath).exists())) return;
    const plan = await this.loadPlan();
    const tasks = await this.loadTasks();
    const next = {
      ...plan,
      task_count: tasks.length,
      completed_count: tasks.filter((task) => task.status === "done").length,
    };
    if (next.task_count !== plan.task_count || next.completed_count !== plan.completed_count) {
      await writeJsonAtomic(planPath, PlanSchema.parse(next));
    }
  }

  async recoverInterruptedRun(): Promise<{ tasks: string[]; subtasks: string[]; agents: string[] }> {
    const now = new Date().toISOString();
    const recovered = { tasks: [] as string[], subtasks: [] as string[], agents: [] as string[] };
    for (const agent of await this.loadAgents()) {
      if (agent.status !== "dead") {
        await this.saveAgent({
          ...agent,
          status: "dead",
          finished_at: agent.finished_at ?? now,
          last_activity_at: now,
          last_event_at: agent.last_event_at ?? now,
          stop_reason: agent.stop_reason ?? "daemon_restart",
        });
        recovered.agents.push(agent.id);
      }
    }
    const LEGACY_RESTART_MARKER = "Marked failed during daemon restart recovery.";
    for (const task of await this.loadTasks()) {
      let cancelledHere = false;
      for (const subtask of await this.loadSubtasks(task.id)) {
        if (subtask.status === "running") {
          await this.transitionSubtask(task.id, subtask.id, "cancelled", {
            summary: "Cancelled during daemon restart; will be re-queued.",
          });
          recovered.subtasks.push(subtask.id);
          cancelledHere = true;
        } else if (subtask.status === "failed" && subtask.summary === LEGACY_RESTART_MARKER) {
          await this.saveSubtask({
            ...subtask,
            status: "cancelled",
            summary: "Cancelled during daemon restart; will be re-queued.",
          });
          recovered.subtasks.push(subtask.id);
          cancelledHere = true;
        }
      }
      const wasInterrupted = task.status === "running" || task.status === "ready";
      const failedDueToInterruption =
        cancelledHere && task.status === "failed" && task.closure_reason === "failed_subtask";
      if (wasInterrupted || failedDueToInterruption) {
        await this.saveTask({
          ...task,
          status: "pending",
          closure_reason: undefined,
          completed_at: undefined,
          summary: "Reset to pending during daemon restart recovery.",
          updated_at: now,
        });
        recovered.tasks.push(task.id);
      }
    }
    let changed = true;
    while (changed) {
      changed = false;
      const tasks = await this.loadTasks();
      const byId = new Map(tasks.map((t) => [t.id, t]));
      const blockingStatuses = new Set(["failed", "blocked", "cancelled"]);
      for (const task of tasks) {
        if (task.status !== "blocked" || task.closure_reason !== "blocked_by_dep") continue;
        const stillBlocked = task.depends_on.some((depId) => {
          const dep = byId.get(depId);
          return dep && blockingStatuses.has(dep.status);
        });
        if (!stillBlocked) {
          await this.saveTask({
            ...task,
            status: "pending",
            closure_reason: undefined,
            completed_at: undefined,
            summary: "Reset to pending during daemon restart recovery (upstream resolved).",
            updated_at: now,
          });
          recovered.tasks.push(task.id);
          changed = true;
        }
      }
    }
    if (recovered.tasks.length > 0) {
      const plan = await this.loadPlan();
      const updates: Partial<Plan> = {};
      if (plan.status === "failed") updates.status = "running";
      if (plan.current_iteration >= plan.max_iterations) {
        updates.max_iterations = plan.current_iteration + 1;
      }
      if (Object.keys(updates).length > 0) {
        await this.savePlan({ ...plan, ...updates, updated_at: now });
      }
    }
    await this.recalculatePlanCounters();
    return recovered;
  }

  async archiveRun(reason: "cancelled" | "migrated" = "cancelled", now = new Date()): Promise<string> {
    const plan = await this.loadPlan();
    const stamp = now.toISOString().replace(/[:.]/g, "-");
    const destination = this.crewPath("archive", `${plan.runId}-${reason}-${stamp}`);
    ensureDir(destination);
    const entries = await readdir(this.crewPath());
    for (const entry of entries) {
      if (entry === "archive") continue;
      await rename(this.crewPath(entry), path.join(destination, entry));
    }
    return destination;
  }

  async loadArchive(): Promise<Array<{ runId: string; status: string; prompt: string; archived_at: string; archive_path: string; task_count: number }>> {
    const archiveDir = this.crewPath("archive");
    ensureDir(archiveDir);
    const dirs = (await readdir(archiveDir)).map((name) => path.join(archiveDir, name));
    const rows = await Promise.all(dirs.map(async (dir) => {
      const planFile = path.join(dir, "plan.json");
      if (!(await Bun.file(planFile).exists())) return null;
      const plan = PlanSchema.parse(planDefaults(await readJson<Partial<Plan>>(planFile, {})));
      const archived_at = path.basename(dir).split("-").slice(-5).join("-") || plan.updated_at;
      return {
        runId: plan.runId,
        status: plan.status,
        prompt: plan.prompt,
        archived_at,
        archive_path: dir,
        task_count: plan.task_count,
      };
    }));
    return rows.filter((row): row is NonNullable<typeof row> => Boolean(row)).sort((a, b) => b.archive_path.localeCompare(a.archive_path));
  }

  async loadPendingAsks(): Promise<PendingAsk[]> {
    ensureDir(this.crewPath("asks"));
    const files = Array.from(new Bun.Glob("*.json").scanSync({ cwd: this.crewPath("asks"), absolute: true }));
    const asks = await Promise.all(files.map((filePath) => readJson<PendingAsk | null>(filePath, null)));
    return asks.filter(Boolean).map((ask) => PendingAskSchema.parse(ask)).sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  async loadPendingAsk(id: string): Promise<PendingAsk | null> {
    const ask = await readJson<PendingAsk | null>(this.crewPath("asks", `${id}.json`), null);
    return ask ? PendingAskSchema.parse(ask) : null;
  }

  async savePendingAsk(ask: PendingAsk): Promise<void> {
    await writeJsonAtomic(this.crewPath("asks", `${ask.id}.json`), PendingAskSchema.parse(ask));
  }

  async deletePendingAsk(id: string): Promise<void> {
    await rm(this.crewPath("asks", `${id}.json`), { force: true });
  }
}
