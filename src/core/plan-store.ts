import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Agent, Config, Iteration, Plan, Subtask, Task } from "./types";

const readJson = async <T>(filePath: string, fallback: T): Promise<T> => {
  const file = Bun.file(filePath);
  if (!(await file.exists())) return fallback;
  return (await file.json()) as T;
};

const ensureDir = (dirPath: string) => mkdirSync(dirPath, { recursive: true });

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
  const team = Array.isArray(config.team)
    ? (config.team as Config["team"])
    : [
        { role: "planner", cli: "claude", model: models.planner ?? "claude-opus-4-7" },
        { role: "coder", cli: "claude", model: models.worker ?? "claude-opus-4-7" },
        { role: "tester", cli: "claude", model: models.worker ?? "claude-opus-4-7" },
        { role: "critic", cli: "claude", model: models.reviewer ?? "claude-opus-4-7" },
        { role: "architect", cli: "claude", model: models.reviewer ?? "claude-opus-4-7" },
        { role: "pm", cli: "claude", model: models.reviewer ?? "claude-opus-4-7" },
        { role: "qa", cli: "claude", model: models.reviewer ?? "claude-opus-4-7" },
      ];
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
});

export class PlanStore {
  constructor(public readonly root: string) {}

  crewPath(...parts: string[]) {
    return path.join(this.root, ".orquesta", "crew", ...parts);
  }

  async loadPlan(): Promise<Plan> {
    return planDefaults(await readJson<Partial<Plan>>(this.crewPath("plan.json"), {}));
  }

  async savePlan(plan: Plan) {
    ensureDir(path.dirname(this.crewPath("plan.json")));
    await Bun.write(this.crewPath("plan.json"), JSON.stringify(plan, null, 2));
  }

  async loadConfig(): Promise<Config> {
    return configDefaults(await readJson<Record<string, unknown>>(this.crewPath("config.json"), {}));
  }

  async saveConfig(config: Config) {
    ensureDir(path.dirname(this.crewPath("config.json")));
    await Bun.write(this.crewPath("config.json"), JSON.stringify(config, null, 2));
  }

  async loadTasks(): Promise<Task[]> {
    ensureDir(this.crewPath("tasks"));
    const files = Array.from(new Bun.Glob("*.json").scanSync({ cwd: this.crewPath("tasks"), absolute: true }));
    const tasks = await Promise.all(files.map((filePath) => readJson<Partial<Task>>(filePath, {})));
    return tasks.map(taskDefaults).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  }

  async loadTask(id: string) {
    return taskDefaults(await readJson<Partial<Task>>(this.crewPath("tasks", `${id}.json`), { id }));
  }

  async saveTask(task: Task) {
    ensureDir(this.crewPath("tasks"));
    await Bun.write(this.crewPath("tasks", `${task.id}.json`), JSON.stringify(task, null, 2));
  }

  async loadSubtasks(taskId: string): Promise<Subtask[]> {
    const dir = this.crewPath("subtasks", taskId);
    ensureDir(dir);
    const files = Array.from(new Bun.Glob("*.json").scanSync({ cwd: dir, absolute: true }));
    const subtasks = await Promise.all(files.map((filePath) => readJson<Partial<Subtask>>(filePath, {})));
    return subtasks.map(subtaskDefaults).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  }

  async loadSubtask(taskId: string, id: string) {
    return subtaskDefaults(await readJson<Partial<Subtask>>(this.crewPath("subtasks", taskId, `${id}.json`), { id, taskId }));
  }

  async saveSubtask(subtask: Subtask) {
    ensureDir(this.crewPath("subtasks", subtask.taskId));
    await Bun.write(this.crewPath("subtasks", subtask.taskId, `${subtask.id}.json`), JSON.stringify(subtask, null, 2));
  }

  async loadIterations(): Promise<Iteration[]> {
    ensureDir(this.crewPath("iterations"));
    const files = Array.from(new Bun.Glob("*.json").scanSync({ cwd: this.crewPath("iterations"), absolute: true }));
    const iterations = await Promise.all(files.map((filePath) => readJson<Iteration | null>(filePath, null)));
    return iterations.filter(Boolean).sort((a, b) => a!.number - b!.number) as Iteration[];
  }

  async saveIteration(iteration: Iteration) {
    ensureDir(this.crewPath("iterations"));
    await Bun.write(this.crewPath("iterations", `${iteration.id}.json`), JSON.stringify(iteration, null, 2));
  }

  async loadAgents(): Promise<Agent[]> {
    ensureDir(this.crewPath("agents"));
    const files = Array.from(new Bun.Glob("*.json").scanSync({ cwd: this.crewPath("agents"), absolute: true }));
    const agents = await Promise.all(files.map((filePath) => readJson<Agent | null>(filePath, null)));
    return agents.filter(Boolean) as Agent[];
  }

  async loadAgent(id: string): Promise<Agent | null> {
    return readJson<Agent | null>(this.crewPath("agents", `${id}.json`), null);
  }

  async saveAgent(agent: Agent) {
    ensureDir(this.crewPath("agents"));
    await Bun.write(this.crewPath("agents", `${agent.id}.json`), JSON.stringify(agent, null, 2));
  }
}
