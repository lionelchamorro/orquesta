import { mkdirSync } from "node:fs";
import { open, rename, rm } from "node:fs/promises";
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

const writeJsonAtomic = async (filePath: string, value: unknown) => {
  ensureDir(path.dirname(filePath));
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
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
});

const configDefaults = (config: Record<string, unknown>): Config => {
  const models = (config.models_legacy ?? config.models ?? {}) as Record<string, string>;
  const defaultTeam: TeamMember[] = [
    { role: "planner", cli: "claude", model: models.planner ?? "claude-opus-4-7" },
    { role: "coder", cli: "claude", model: models.worker ?? "claude-opus-4-7" },
    { role: "tester", cli: "claude", model: models.worker ?? "claude-opus-4-7" },
    { role: "critic", cli: "claude", model: models.reviewer ?? "claude-opus-4-7" },
    { role: "architect", cli: "claude", model: models.reviewer ?? "claude-opus-4-7" },
    { role: "pm", cli: "claude", model: models.reviewer ?? "claude-opus-4-7" },
    { role: "qa", cli: "claude", model: models.reviewer ?? "claude-opus-4-7" },
  ];
  const team = Array.isArray(config.team)
    ? (config.team as Config["team"])
    : defaultTeam;
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
            planner: models.planner ?? "claude-opus-4-7",
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
  summary: subtask.summary,
  output: subtask.output,
  artifacts: subtask.artifacts,
  findings: subtask.findings,
});

const taskTransitions: Record<TaskStatus, TaskStatus[]> = {
  pending: ["ready", "running", "blocked", "cancelled", "failed"],
  ready: ["pending", "running", "blocked", "cancelled", "failed"],
  running: ["pending", "done", "failed", "cancelled", "blocked"],
  blocked: [],
  done: [],
  failed: [],
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
    const iterations = await Promise.all(files.map((filePath) => readJson<Iteration | null>(filePath, null)));
    return iterations.filter(Boolean).map((iteration) => IterationSchema.parse(iteration)).sort((a, b) => a.number - b.number);
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
        await this.saveAgent({ ...agent, status: "dead", last_activity_at: now, stop_reason: agent.stop_reason ?? "daemon_restart" });
        recovered.agents.push(agent.id);
      }
    }
    for (const task of await this.loadTasks()) {
      for (const subtask of await this.loadSubtasks(task.id)) {
        if (subtask.status === "running") {
          await this.transitionSubtask(task.id, subtask.id, "failed", {
            summary: subtask.summary ?? "Marked failed during daemon restart recovery.",
          });
          recovered.subtasks.push(subtask.id);
        }
      }
      if (task.status === "running" || task.status === "ready") {
        await this.transitionTask(task.id, "pending", {
          summary: task.summary ?? "Reset to pending during daemon restart recovery.",
        });
        recovered.tasks.push(task.id);
      }
    }
    return recovered;
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
