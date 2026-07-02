import { flows as mockFlows, teams as mockTeams } from "./mock-data"
import type { AgentDefinition, Feature, FlowDefinition, FlowStep, Project, Task, TeamDefinition, TeamRoleDefinition } from "./types"

type RawTask = Partial<Task> & { description?: string }
type RawTasks = { tasks?: RawTask[] }
type RawFeature = Partial<Feature> & { started_at?: string; finished_at?: string }
type RawFactory = { base_branch?: string; features?: RawFeature[] } | null
type RawCost = { available?: boolean; total_usd?: number }
type RawAgent = Omit<Partial<AgentDefinition>, "id"> & { provider?: string; cmd?: string[] }
type RawTeamRole = Partial<TeamRoleDefinition>
type RawTeam = Partial<TeamDefinition> & {
  agents?: Record<string, RawAgent> | AgentDefinition[]
  roles?: Record<string, RawTeamRole> | TeamRoleDefinition[]
}
type RawFlowStep = Partial<FlowStep>
type RawFlow = Partial<Omit<FlowDefinition, "steps">> & {
  team?: string
  command?: string
  args?: string[]
  steps?: RawFlowStep[]
}

const defaultProjectId = process.env.ORQ_LITE_PROJECT_ID ?? "orquestalite"
const defaultProjectName = process.env.ORQ_LITE_PROJECT_NAME ?? "orquestalite"
const defaultProjectRepo = process.env.ORQ_LITE_REPO_URL ?? "github.com/lionelchamorro/orquestalite"
const defaultWorkspace = process.env.ORQ_LITE_WORKSPACE_PATH ?? "."

export function orqLiteBaseURL() {
  return (process.env.ORQ_LITE_API_URL ?? process.env.NEXT_PUBLIC_ORQ_LITE_API_URL ?? "").replace(/\/$/, "")
}

export function orquestaApiBaseURL() {
  return (process.env.ORQUESTA_API_URL ?? process.env.NEXT_PUBLIC_ORQUESTA_API_URL ?? "").replace(/\/$/, "")
}

export async function getProjects(): Promise<Project[]> {
  const controlPlaneProjects = await getControlPlaneProjects()
  if (controlPlaneProjects.length > 0) return controlPlaneProjects

  const live = await getLiveProject()
  return live ? [live] : []
}

export async function getProject(id: string): Promise<Project | undefined> {
  const baseURL = orquestaApiBaseURL()
  if (baseURL) {
    const project = await fetchJSON<Project | undefined>(`${baseURL}/projects/${id}`, undefined)
    if (project) return { ...project, source: project.source ?? "orq-lite" }
  }

  const live = await getLiveProject()
  if (live) return live.id === id ? live : undefined
  return undefined
}

export async function getFlows(projectId?: string): Promise<FlowDefinition[]> {
  const baseURL = orquestaApiBaseURL()
  if (!baseURL) return mockFlows
  if (!projectId) return []

  const raw = await fetchJSON<unknown>(`${baseURL}/projects/${projectId}/flows`, undefined)
  // Backend is the source of truth once configured (flows.json is seeded with
  // real defaults); reflect an empty list as empty instead of masking it with
  // mock flows.
  return normalizeFlows(raw)
}

export async function getTeams(projectId?: string): Promise<TeamDefinition[]> {
  const baseURL = orquestaApiBaseURL()
  if (!baseURL) return mockTeams
  if (!projectId) return mockTeams

  // GET /projects/{projectId}/team returns a single TeamDefinition, not an array.
  const raw = await fetchJSON<unknown>(`${baseURL}/projects/${projectId}/team`, undefined)
  if (!raw) return mockTeams
  // Wrap in array for backward-compatibility with callers that expect TeamDefinition[].
  const teams = normalizeTeams(Array.isArray(raw) ? raw : [raw])
  return teams.length > 0 ? teams : mockTeams
}

async function getControlPlaneProjects(): Promise<Project[]> {
  const baseURL = orquestaApiBaseURL()
  if (!baseURL) return []
  const projects = await fetchJSON<Project[]>(`${baseURL}/projects`, [])
  return projects.map((project) => ({
    ...project,
    tasks: project.tasks ?? [],
    features: project.features ?? [],
    events: project.events ?? [],
    source: project.source ?? "orq-lite",
  }))
}

async function getLiveProject(): Promise<Project | undefined> {
  const baseURL = orqLiteBaseURL()
  if (!baseURL) return undefined

  try {
    const [tasksRaw, factoryRaw, costRaw] = await Promise.all([
      fetchJSON<RawTasks>(`${baseURL}/api/tasks`, { tasks: [] }),
      fetchJSON<RawFactory>(`${baseURL}/api/factory`, null),
      fetchJSON<RawCost>(`${baseURL}/api/cost`, { available: false }),
    ])

    const tasks = normalizeTasks(tasksRaw)
    const features = normalizeFeatures(factoryRaw)
    const running =
      tasks.some((t) => t.status === "in_progress") ||
      features.some((f) => f.status === "in_progress")
    const needsHuman =
      tasks.some((t) => t.status === "needs_human" || t.status === "failed") ||
      features.some((f) => f.status === "failed")
    const lastRun = latestTimestamp(factoryRaw?.features ?? []) ?? new Date(0).toISOString()

    return {
      id: defaultProjectId,
      name: defaultProjectName,
      repo_url: defaultProjectRepo,
      workspace_path: defaultWorkspace,
      base_branch: factoryRaw?.base_branch ?? process.env.ORQ_LITE_BASE_BRANCH ?? "main",
      watch: { prs: false, issues: false },
      state: running ? "running" : needsHuman ? "needs_human" : "idle",
      description: "Live state from orq-lite serve.",
      language: process.env.ORQ_LITE_LANGUAGE ?? "Go",
      tasks,
      features,
      events: [],
      cost_usd: costRaw.available ? (costRaw.total_usd ?? 0) : features.reduce((sum, f) => sum + f.cost_usd, 0),
      last_run: lastRun,
      source: "orq-lite",
    }
  } catch {
    return undefined
  }
}

async function fetchJSON<T>(url: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(url, { cache: "no-store" })
    if (!res.ok) return fallback
    return (await res.json()) as T
  } catch {
    return fallback
  }
}

function normalizeTasks(raw: RawTasks): Task[] {
  return (raw.tasks ?? []).map((task, index) => ({
    id: task.id ?? `T${String(index + 1).padStart(3, "0")}`,
    status: task.status ?? "pending",
    verify_state: task.verify_state || "pending",
    attempts: task.attempts ?? 0,
    last_agent: task.last_agent ?? "",
    title: task.title ?? task.description ?? "Untitled task",
    failure_reason: task.failure_reason,
  }))
}

function normalizeFeatures(raw: RawFactory): Feature[] {
  return (raw?.features ?? []).map((feature, index) => ({
    id: feature.id ?? `F${String(index + 1).padStart(3, "0")}`,
    status: feature.status ?? "pending",
    branch: feature.branch ?? "",
    tasks_done: feature.tasks_done ?? 0,
    tasks_failed: feature.tasks_failed ?? 0,
    cost_usd: feature.cost_usd ?? 0,
    title: feature.title ?? "Untitled feature",
    pr_url: feature.pr_url,
  }))
}

function normalizeFlows(raw: unknown): FlowDefinition[] {
  const payload = raw as { flows?: unknown } | RawFlow[] | undefined
  const flowsRaw = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.flows)
      ? payload.flows
      : payload?.flows && typeof payload.flows === "object"
        ? Object.entries(payload.flows).map(([id, value]) => ({ id, ...(value as object) }))
        : []

  return flowsRaw.map((flow, index) => {
    const rawFlow = flow as RawFlow
    const id = rawFlow.id ?? slug(rawFlow.name ?? `flow-${index + 1}`)
    return {
      id,
      name: rawFlow.name ?? id,
      description: rawFlow.description ?? "Configured orq-lite flow.",
      team_id: rawFlow.team_id ?? rawFlow.team ?? "default",
      entrypoint: rawFlow.entrypoint ?? `orq-lite flow run ${id}`,
      variables: rawFlow.variables ?? {},
      inputs: rawFlow.inputs ?? {},
      steps: (rawFlow.steps ?? []).map((step, stepIndex) => normalizeFlowStep(step, stepIndex)),
      tags: rawFlow.tags ?? [],
      source: rawFlow.source ?? "orquesta-api",
    }
  })
}

function normalizeFlowStep(step: RawFlowStep, index: number): FlowStep {
  return {
    id: step.id ?? `step-${index + 1}`,
    type: step.type ?? "command",
    label: step.label,
    agent: step.agent,
    command: step.command,
    args: step.args,
    action: step.action,
    inputs: step.inputs,
    outputs: step.outputs,
    iterator: step.iterator,
    as: step.as,
    body: step.body?.map((child, childIndex) => normalizeFlowStep(child, childIndex)),
    condition: step.condition,
    max_retries: step.max_retries,
    expression: step.expression,
    on_failure: step.on_failure,
    depends_on: step.depends_on ?? [],
    description: step.description,
  }
}

function normalizeTeams(raw: unknown): TeamDefinition[] {
  const payload = raw as { teams?: unknown } | RawTeam[] | undefined
  const teamsRaw = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.teams)
      ? payload.teams
      : payload?.teams && typeof payload.teams === "object"
        ? Object.entries(payload.teams).map(([id, value]) => ({ id, ...(value as object) }))
        : []

  return teamsRaw.map((team, index) => {
    const rawTeam = team as RawTeam
    const id = rawTeam.id ?? slug(rawTeam.name ?? `team-${index + 1}`)
    return {
      id,
      name: rawTeam.name ?? id,
      description: rawTeam.description ?? "orq-lite team.json roster.",
      agents: normalizeAgents(rawTeam.agents),
      roles: normalizeRoles(rawTeam.roles),
      limits: rawTeam.limits ?? {},
      full_test_command: rawTeam.full_test_command ?? "",
      lint_command: rawTeam.lint_command ?? "",
      conventions_file: rawTeam.conventions_file,
      source: rawTeam.source ?? "orquesta-api",
    }
  })
}

function normalizeAgents(raw: RawTeam["agents"]): AgentDefinition[] {
  if (Array.isArray(raw)) return raw
  if (!raw || typeof raw !== "object") return []
  return Object.entries(raw as Record<string, RawAgent>).map(([id, agent]) => ({
    id,
    provider: agent.provider === "cmd" || !agent.provider ? "cmd" : (agent.provider as AgentDefinition["provider"]),
    model: agent.model,
    effort: agent.effort,
    cmd: agent.cmd,
    dangerously_skip_permissions: agent.dangerously_skip_permissions,
    rate_limit_pattern: agent.rate_limit_pattern,
  }))
}

function normalizeRoles(raw: RawTeam["roles"]): TeamRoleDefinition[] {
  if (Array.isArray(raw)) return raw
  if (!raw || typeof raw !== "object") return []
  return Object.entries(raw as Record<string, RawTeamRole>).map(([role, value]) => ({
    role,
    agents: value.agents ?? [],
    prompt: value.prompt ?? "",
    result_path: value.result_path ?? `.orquestalite/results/${role}.json`,
    timeout_seconds: value.timeout_seconds ?? 600,
    escalation_ladder: value.escalation_ladder,
    decompose_prompt: value.decompose_prompt,
    mode: value.mode,
    cycle_prompt: value.cycle_prompt,
  }))
}

function latestTimestamp(features: RawFeature[]) {
  const times = features
    .flatMap((f) => [f.finished_at, f.started_at])
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite)

  if (times.length === 0) return undefined
  return new Date(Math.max(...times)).toISOString()
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
}
