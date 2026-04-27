import { z } from "zod";

const PlanStatusSchema = z.enum(["drafting", "awaiting_approval", "approved", "running", "done", "failed"]);
const CliNameSchema = z.enum(["claude", "codex", "gemini"]);
const RoleSchema = z.enum(["planner", "coder", "tester", "critic", "architect", "pm", "qa"]);
const TaskStatusSchema = z.enum(["pending", "ready", "running", "blocked", "done", "failed", "cancelled"]);
const SubtaskTypeSchema = z.enum(["code", "test", "critic", "fix", "custom"]);
const IterationTriggerSchema = z.enum(["initial", "architect_replan", "qa_regression"]);
const AgentStatusSchema = z.enum(["idle", "working", "live", "dead"]);

export const TeamMemberSchema = z.object({
  role: RoleSchema,
  cli: CliNameSchema,
  model: z.string().min(1),
  command: z.array(z.string()).optional(),
});

export const PlanSchema = z.object({
  runId: z.string().min(1),
  prd: z.string(),
  prompt: z.string(),
  status: PlanStatusSchema,
  created_at: z.string(),
  updated_at: z.string(),
  task_count: z.number().int().nonnegative(),
  completed_count: z.number().int().nonnegative(),
  current_iteration: z.number().int().positive(),
  max_iterations: z.number().int().positive(),
});

export const ConfigSchema = z.object({
  dependencies: z.enum(["strict", "loose"]),
  concurrency: z.object({
    workers: z.number().int().positive(),
    max: z.number().int().positive(),
  }),
  review: z.object({
    enabled: z.boolean(),
    maxIterations: z.number().int().nonnegative(),
  }),
  work: z.object({
    maxAttemptsPerTask: z.number().int().positive(),
    maxWaves: z.number().int().positive(),
    maxIterations: z.number().int().positive(),
  }),
  git: z.object({
    enabled: z.boolean(),
    baseBranch: z.string().min(1),
    autoCommit: z.boolean(),
    removeWorktreeOnArchive: z.boolean(),
  }).optional(),
  team: z.array(TeamMemberSchema).min(1),
  models_legacy: z.object({
    planner: z.string(),
    worker: z.string(),
    reviewer: z.string(),
  }).optional(),
});

export const CriticFindingSchema = z.object({
  severity: z.enum(["low", "medium", "high"]),
  description: z.string().min(1),
  file: z.string().optional(),
  suggestion: z.string().optional(),
});

export const TaskEvidenceSchema = z.object({
  commits: z.array(z.string()).optional(),
  tests: z.array(z.string()).optional(),
  artifacts: z.array(z.string()).optional(),
}).optional();

export const TaskSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  description: z.string().optional(),
  status: TaskStatusSchema,
  depends_on: z.array(z.string()),
  iteration: z.number().int().positive(),
  parent_task_id: z.string().optional(),
  worktree_path: z.string().optional(),
  branch: z.string().optional(),
  base_branch: z.string().optional(),
  merge_commit: z.string().optional(),
  merge_error: z.string().optional(),
  merged_at: z.string().optional(),
  archive_path: z.string().optional(),
  closure_reason: z.enum(["critic_ok", "max_attempts", "merge_conflict", "failed_subtask", "blocked_by_dep", "no_changes"]).optional(),
  created_at: z.string(),
  updated_at: z.string(),
  attempt_count: z.number().int().nonnegative(),
  started_at: z.string().optional(),
  completed_at: z.string().optional(),
  summary: z.string().optional(),
  evidence: TaskEvidenceSchema,
  subtasks: z.array(z.string()),
});

export const SubtaskSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  type: SubtaskTypeSchema,
  role: RoleSchema,
  status: TaskStatusSchema,
  agentId: z.string().optional(),
  prompt: z.string(),
  depends_on: z.array(z.string()),
  created_at: z.string(),
  started_at: z.string().optional(),
  completed_at: z.string().optional(),
  summary: z.string().optional(),
  output: z.string().optional(),
  artifacts: z.array(z.string()).optional(),
  findings: z.array(CriticFindingSchema).optional(),
});

export const IterationSchema = z.object({
  id: z.string().min(1),
  number: z.number().int().positive(),
  runId: z.string().min(1),
  trigger: IterationTriggerSchema,
  started_at: z.string(),
  ended_at: z.string().optional(),
  task_ids: z.array(z.string()),
  summary: z.string().optional(),
});

export const AgentSchema = z.object({
  id: z.string().min(1),
  role: RoleSchema,
  cli: CliNameSchema,
  model: z.string(),
  status: AgentStatusSchema,
  session_cwd: z.string(),
  bound_subtask: z.string().optional(),
  bound_task: z.string().optional(),
  started_at: z.string().optional(),
  last_activity_at: z.string().optional(),
  cli_session_id: z.string().optional(),
  exit_code: z.number().optional(),
  stop_reason: z.string().optional(),
  total_cost_usd: z.number().optional(),
  duration_ms: z.number().optional(),
  num_turns: z.number().optional(),
  final_text: z.string().optional(),
  is_error: z.boolean().optional(),
});

export const PendingAskSchema = z.object({
  id: z.string().min(1),
  fromAgent: z.string().min(1),
  question: z.string().min(1),
  options: z.array(z.string()).optional(),
  status: z.enum(["pending", "fallback", "answered", "timed_out"]),
  created_at: z.string(),
  updated_at: z.string(),
  answer: z.string().optional(),
  answered_by: z.string().optional(),
});
