export type PlanStatus = "drafting" | "awaiting_approval" | "approved" | "running" | "done" | "failed";
export type CliName = "claude" | "codex" | "gemini";
export type Role = "planner" | "coder" | "tester" | "critic" | "architect" | "pm" | "qa";
export type TaskStatus = "pending" | "ready" | "running" | "blocked" | "done" | "failed" | "cancelled";
export type SubtaskType = "code" | "test" | "critic" | "fix" | "custom";
export type IterationTrigger = "initial" | "architect_replan" | "qa_regression";
export type AgentStatus = "idle" | "working" | "live" | "dead";

export interface Plan {
  runId: string;
  prd: string;
  prompt: string;
  status: PlanStatus;
  created_at: string;
  updated_at: string;
  task_count: number;
  completed_count: number;
  current_iteration: number;
  max_iterations: number;
}

export interface TeamMember {
  role: Role;
  cli: CliName;
  model: string;
  command?: string[];
}

export interface Config {
  dependencies: "strict" | "loose";
  concurrency: { workers: number; max: number };
  review: { enabled: boolean; maxIterations: number };
  work: { maxAttemptsPerTask: number; maxWaves: number; maxIterations: number };
  git?: {
    enabled: boolean;
    baseBranch: string;
    autoCommit: boolean;
    removeWorktreeOnArchive: boolean;
  };
  team: TeamMember[];
  models_legacy?: { planner: string; worker: string; reviewer: string };
}

export interface TaskEvidence {
  commits?: string[];
  tests?: string[];
  artifacts?: string[];
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  depends_on: string[];
  iteration: number;
  parent_task_id?: string;
  worktree_path?: string;
  branch?: string;
  base_branch?: string;
  merge_commit?: string;
  merged_at?: string;
  archive_path?: string;
  closure_reason?: "critic_ok" | "max_attempts" | "merge_conflict" | "failed_subtask" | "blocked_by_dep";
  created_at: string;
  updated_at: string;
  attempt_count: number;
  started_at?: string;
  completed_at?: string;
  summary?: string;
  evidence?: TaskEvidence;
  subtasks: string[];
}

export interface CriticFinding {
  severity: "low" | "medium" | "high";
  description: string;
  file?: string;
  suggestion?: string;
}

export interface Subtask {
  id: string;
  taskId: string;
  type: SubtaskType;
  role: Role;
  status: TaskStatus;
  agentId?: string;
  prompt: string;
  depends_on: string[];
  created_at: string;
  started_at?: string;
  completed_at?: string;
  summary?: string;
  output?: string;
  artifacts?: string[];
  findings?: CriticFinding[];
}

export interface Iteration {
  id: string;
  number: number;
  runId: string;
  trigger: IterationTrigger;
  started_at: string;
  ended_at?: string;
  task_ids: string[];
  summary?: string;
}

export interface Agent {
  id: string;
  role: Role;
  cli: CliName;
  model: string;
  status: AgentStatus;
  session_cwd: string;
  bound_subtask?: string;
  bound_task?: string;
  started_at?: string;
  last_activity_at?: string;
  cli_session_id?: string;
  exit_code?: number;
  stop_reason?: string;
  total_cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
  final_text?: string;
  is_error?: boolean;
}

export type BusEvent =
  | { type: "plan_approved"; runId: string; at: string }
  | { type: "iteration_started"; iterationId: string; number: number; trigger: IterationTrigger }
  | { type: "task_ready"; taskId: string }
  | { type: "task_started"; taskId: string }
  | { type: "tasks_emitted"; runId: string; iteration: number; taskIds: string[] }
  | { type: "subtask_started"; taskId: string; subtaskId: string; agentId: string }
  | { type: "subtask_output"; subtaskId: string; chunk: string }
  | { type: "subtask_completed"; subtaskId: string; summary: string }
  | { type: "subtask_failed"; subtaskId: string; reason: string }
  | { type: "critic_findings"; subtaskId: string; findings: CriticFinding[] }
  | { type: "task_completed"; taskId: string }
  | { type: "task_cancelled"; taskId: string }
  | { type: "task_merged"; taskId: string; mergeCommit: string; branch: string }
  | { type: "task_archived"; taskId: string; agents: string[] }
  | { type: "ask_user"; askId: string; fromAgent: string; question: string; options?: string[]; fallback?: boolean }
  | { type: "ask_user_answered"; askId: string; answer: string; fromAgent: string }
  | { type: "activity"; fromAgent: string; toAgent?: string; message: string }
  | { type: "agent_completed"; agentId: string; summary: string }
  | { type: "agent_failed"; agentId: string; reason: string }
  | { type: "iteration_completed"; iterationId: string }
  | { type: "run_completed"; runId: string }
  | { type: "broadcast"; fromRole: Role; toAgent: string; message: string };

export interface TaggedBusEvent {
  id: string;
  ts: string;
  tags: string[];
  payload: BusEvent;
}
