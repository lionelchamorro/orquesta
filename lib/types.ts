// Domain types modeled on the orquestalite file contracts.

export type TaskStatus =
  | "pending"
  | "in_progress"
  | "done"
  | "failed"
  | "needs_human"
  | "decomposed"
  | "needs_clarification"

export type VerifyState =
  | ""
  | "pending"
  | "tests_pass"
  | "tests_fail"
  | "tests_skipped"
  | "pass"
  | "error"
  | "commit_ok"
  | "commit_rejected"
  | "commit_skipped"
  | "commit_empty"

export type AgentRole =
  | "planner"
  | "parser"
  | "compactor"
  | "coder"
  | "tester"
  | "critic"
  | "verifier"
  | "reviewer"
  | "generalist"
  | "intake"

export interface Task {
  id: string
  status: TaskStatus
  verify_state: VerifyState
  attempts: number
  last_agent: string
  title: string
  failure_reason?: string
}

export type FeatureStatus =
  | "pending"
  | "in_progress"
  | "done"
  | "failed"
  | "needs_human"

export interface Feature {
  id: string
  status: FeatureStatus
  branch: string
  tasks_done: number
  tasks_failed: number
  cost_usd: number
  title: string
  pr_url?: string
}

// Mirrors orquesta_api.meta.models.EventKind. run_start/run_end are
// orq-lite's own internal lifecycle (its run.log); run_started/run_finished
// are orquesta's control-plane process-launch lifecycle — both exist and
// are distinct.
export type EventKind =
  | "agent_run"
  | "agent_diff"
  | "task_start"
  | "task_done"
  | "task_done_no_commit"
  | "task_failed"
  | "cycle_start"
  | "cycle_end"
  | "cycle_verification"
  | "cycle_verification_error"
  | "tester_verification_failed"
  | "full_suite_failed"
  | "run_start"
  | "run_end"
  | "plan_written"
  | "rate_limit_wait"
  | "handoff_written"
  | "task_routed"
  | "run_started"
  | "run_finished"

export interface RunEvent {
  ts: string
  event: EventKind
  // Real orq-lite roles are opaque strings (planner|verifier|generalist|...),
  // not the closed AgentRole enum — mirrors orquesta_api.meta.models.RunEvent.role.
  role?: string
  agent?: string
  status?: string
  task_id?: string
  duration_s?: number
  reason?: string
  cycle?: number
  new_tasks_proposed?: number
  command?: string
  commit_sha?: string
  project?: string
  run_id?: string
  [key: string]: unknown
}

export interface ProjectWatch {
  prs: boolean
  issues: boolean
}

export type RunKind = "run" | "factory" | "plan" | "flow" | "watch"

export type ProjectState = "running" | "idle" | "needs_human" | "paused"

// projects.json entry plus derived in-memory state for the UI.
export interface Project {
  id: string
  name: string
  repo_url: string
  workspace_path: string
  base_branch: string
  watch: ProjectWatch
  state: ProjectState
  description: string
  language: string
  tasks: Task[]
  features: Feature[]
  events: RunEvent[]
  cost_usd: number
  last_run: string
  source?: "mock" | "orq-lite"
}

export interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  project?: string
  action?: string
}


export type AgentProvider = "claude" | "codex" | "gemini" | "opencode" | "cmd"

export interface AgentDefinition {
  id: string
  provider: AgentProvider
  model?: string
  effort?: string
  cmd?: string[]
  dangerously_skip_permissions?: boolean
  rate_limit_pattern?: string
}

export interface TeamRoleDefinition {
  role: AgentRole | string
  agents: string[]
  prompt: string
  result_path: string
  timeout_seconds: number
  escalation_ladder?: string[]
  decompose_prompt?: string
  mode?: "per_task" | "per_cycle" | "both" | ""
  cycle_prompt?: string
}

export interface TeamLimits {
  max_review_cycles?: number
  max_fix_iterations?: number
  verify_tester_command?: boolean
  factory_budget_usd?: number
  max_visual_rounds?: number
  resume_sessions?: boolean
  memory_compact_chars?: number
  max_feature_retries?: number
}

export interface TeamDefinition {
  id: string
  name: string
  description: string
  agents: AgentDefinition[]
  roles: TeamRoleDefinition[]
  limits: TeamLimits
  full_test_command: string
  lint_command?: string
  conventions_file?: string
  source?: "mock" | "orq-lite" | "orquesta-api"
}

export type FlowStepType = "agent" | "command" | "action" | "loop" | "retry_until" | "eval"

// Mirrors orquesta_api.meta.models.FlowStep, which mirrors the engine schema
// at orquesta-lite/internal/engine/engine.go:37-79. Recursive: loop/retry_until
// steps nest their body.
export interface FlowStep {
  id: string
  type: FlowStepType
  label?: string
  agent?: string
  command?: string
  args?: string[]
  action?: string
  inputs?: Record<string, unknown>
  outputs?: Record<string, unknown>
  iterator?: string
  as?: string
  body?: FlowStep[]
  condition?: string
  max_retries?: number
  expression?: string
  on_failure?: "" | "continue"
  depends_on: string[]
  description?: string
}

export interface FlowInputSpec {
  type?: string
  default?: unknown
}

export interface FlowDefinition {
  id: string
  name: string
  description: string
  team_id: string
  entrypoint: string
  variables: Record<string, string>
  inputs?: Record<string, FlowInputSpec>
  steps: FlowStep[]
  tags: string[]
  source?: "mock" | "orq-lite" | "orquesta-api"
}
