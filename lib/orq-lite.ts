import { flows as mockFlows, teams as mockTeams } from "./mock-data"
import type { AgentDefinition, FlowDefinition, FlowStep, Project, TeamDefinition, TeamRoleDefinition } from "./types"

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

export function orquestaApiBaseURL() {
  return (process.env.ORQUESTA_API_URL ?? process.env.NEXT_PUBLIC_ORQUESTA_API_URL ?? "").replace(/\/$/, "")
}

// Mock/demo data must be opt-in. Without ORQUESTA_DEMO=1, an unconfigured or
// unreachable control plane renders as empty/error, never silently as demo
// data masquerading as real state.
function demoModeEnabled(): boolean {
  return process.env.ORQUESTA_DEMO === "1"
}

export async function getProjects(): Promise<Project[]> {
  return getControlPlaneProjects()
}

export async function getProject(id: string): Promise<Project | undefined> {
  const baseURL = orquestaApiBaseURL()
  if (!baseURL) return undefined
  const project = await fetchJSON<Project | undefined>(`${baseURL}/projects/${id}`, undefined)
  return project ? { ...project, source: project.source ?? "orq-lite" } : undefined
}

export async function getFlows(projectId?: string): Promise<FlowDefinition[]> {
  const baseURL = orquestaApiBaseURL()
  if (!baseURL) return demoModeEnabled() ? mockFlows : []
  if (!projectId) return []

  const raw = await fetchJSON<unknown>(`${baseURL}/projects/${projectId}/flows`, undefined)
  // Backend is the source of truth once configured (flows.json is seeded with
  // real defaults); reflect an empty list as empty instead of masking it with
  // mock flows.
  return normalizeFlows(raw)
}

export async function getTeams(projectId?: string): Promise<TeamDefinition[]> {
  const baseURL = orquestaApiBaseURL()
  if (!baseURL) return demoModeEnabled() ? mockTeams : []
  if (!projectId) return demoModeEnabled() ? mockTeams : []

  // GET /projects/{projectId}/team returns a single TeamDefinition, not an array.
  const raw = await fetchJSON<unknown>(`${baseURL}/projects/${projectId}/team`, undefined)
  if (!raw) return demoModeEnabled() ? mockTeams : []
  // Wrap in array for backward-compatibility with callers that expect TeamDefinition[].
  return normalizeTeams(Array.isArray(raw) ? raw : [raw])
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

async function fetchJSON<T>(url: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(url, { cache: "no-store" })
    if (!res.ok) return fallback
    return (await res.json()) as T
  } catch {
    return fallback
  }
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

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
}
