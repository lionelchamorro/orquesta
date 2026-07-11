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

export type RunState =
  | "queued"
  | "starting"
  | "running"
  | "stopping"
  | "succeeded"
  | "failed"
  | "cancelled"

export interface Run {
  id: string
  project_id: string
  kind: RunKind
  state: RunState
  executor: string
  flow?: string | null
  inputs: Record<string, string>
  plan_path?: string | null
  args: string[]
  container_id?: string | null
  pid?: number | null
  api_port?: number | null
  started_at?: string | null
  finished_at?: string | null
  exit_code?: number | null
  base_sha?: string | null
  head_sha?: string | null
  error?: string | null
  orq_run_id?: string | null
}

export type ProjectState = "running" | "idle" | "needs_human" | "paused"

export type AttentionKind = "run_failed" | "task_needs_human" | "task_needs_clarification"

export interface AttentionItem {
  kind: AttentionKind
  project_id: string
  project_name: string
  ref: string
  title: string
  detail: string
  ts: string
}

export interface AttentionResponse {
  items: AttentionItem[]
}

export interface ReviewRun {
  run_id: string
  pr_number: number | null
  pr_url: string | null
  state: RunState
  started_at: string | null
  finished_at: string | null
  duration_s: number | null
  cost_usd: number | null
}

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
  skills?: string[]
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

export interface SkillSummary {
  id: string
  name: string
  description: string
  suggested_roles: string[]
}

export interface SkillsResponse {
  skills: SkillSummary[]
}

export type FlowStepType = "agent" | "command" | "action" | "loop" | "retry_until" | "eval"

// Mirrors orquesta_api.meta.models.FlowStep, which is field-for-field the
// engine's Step struct (orquesta-lite/internal/engine/engine.go) and nothing
// else — flows.json is a user-owned file the engine parses, so no UI-only
// fields may exist here (they'd be written back into the file on save).
// Recursive: loop/retry_until steps nest their body.
export interface FlowStep {
  type: FlowStepType
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
}

export interface FlowInputSpec {
  type?: string
  default?: unknown
}

// The engine's Flow struct is exactly {description?, inputs?, steps}; only
// those keys are ever written to flows.json. id (the flows-map key), name,
// entrypoint, and source are read-side conveniences.
export interface FlowDefinition {
  id: string
  name: string
  description: string
  entrypoint: string
  inputs?: Record<string, FlowInputSpec>
  steps: FlowStep[]
  source?: "mock" | "orq-lite" | "orquesta-api"
}

// ---------------------------------------------------------------------------
// orq-lite query API mirrors (docs/orq-lite-query-api.md). Field-for-field
// with orquesta_api/meta/query_models.py — enforced by test_contract_types.py.
// ---------------------------------------------------------------------------

export interface OrqRunSummary {
  run_id: string
  command: string
  args: string[]
  status: string // running|ok|error|interrupted
  started_at: string
  finished_at?: string | null
  duration_s?: number | null
  orq_version: string
  cost_usd: number
  input_tokens: number
  output_tokens: number
  agent_runs: number
  tasks_done: number
  tasks_failed: number
}

export interface OrqRunsPage {
  runs: OrqRunSummary[]
  total: number
}

export interface OrqRunEventsPage {
  events: RunEvent[]
  total: number
}

export interface AgentRunRecord {
  ts: string
  run_id: string
  role: string
  agent: string
  task_id: string
  cycle: number
  attempt: number
  provider: string
  model: string
  duration_s: number
  exit_code: number
  timed_out: boolean
  rate_limited: boolean
  input_tokens: number
  output_tokens: number
  cached_input_tokens: number
  reasoning_tokens: number
  cost_usd: number
  artifacts_dir: string
}

export interface AgentRunsPage {
  agent_runs: AgentRunRecord[]
  total: number
}

export interface CostRow {
  key: string
  cost_usd: number
  input_tokens: number
  output_tokens: number
  agent_runs: number
}

export interface CostStats {
  by: string
  rows: CostRow[]
}

export interface FlowCatalogInput {
  type: string
  default?: unknown
  required: boolean
}

export interface FlowCatalogEntry {
  name: string
  description: string
  inputs: Record<string, FlowCatalogInput>
  roles: string[]
  preflight: Record<string, string> // role -> ok|missing_role|missing_prompt
}

export interface FlowCatalog {
  flows: FlowCatalogEntry[]
}

export interface DoctorCheck {
  name: string
  status: string // ok|warn|error
  detail: string
}

export interface DoctorReport {
  ok: boolean
  checks: DoctorCheck[]
}
