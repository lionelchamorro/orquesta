import type { FlowDefinition, Project, RunEvent, TeamDefinition } from "./types"

function ago(min: number) {
  return new Date(Date.now() - min * 60_000).toISOString()
}

export const projects: Project[] = [
  {
    id: "orquestalite",
    name: "orquestalite",
    repo_url: "github.com/lionelchamorro/orquestalite",
    workspace_path: "~/code/orquestalite",
    base_branch: "main",
    watch: { prs: true, issues: true },
    state: "running",
    description: "Minimalist Go orchestrator for the Ralph technique.",
    language: "Go",
    cost_usd: 4.82,
    last_run: ago(2),
    features: [
      {
        id: "f-204",
        status: "in_progress",
        branch: "feat/registry-dispatch",
        tasks_done: 3,
        tasks_failed: 0,
        cost_usd: 2.14,
        title: "File-based project registry and per-project dispatch",
      },
      {
        id: "f-198",
        status: "done",
        branch: "feat/watch-flags",
        tasks_done: 5,
        tasks_failed: 1,
        cost_usd: 1.92,
        title: "Per-project PR and issue watcher toggles",
        pr_url: "https://github.com/lionelchamorro/orquestalite/pull/41",
      },
    ],
    tasks: [
      {
        id: "t-2041",
        status: "done",
        verify_state: "commit_ok",
        attempts: 1,
        last_agent: "reviewer",
        title: "Add registry accessor in internal/registry",
      },
      {
        id: "t-2042",
        status: "in_progress",
        verify_state: "tests_pass",
        attempts: 2,
        last_agent: "coder",
        title: "Implement dispatch: resolve workspace and append feature.md",
      },
      {
        id: "t-2043",
        status: "pending",
        verify_state: "pending",
        attempts: 0,
        last_agent: "",
        title: "project add rejects duplicate names",
      },
      {
        id: "t-2044",
        status: "needs_human",
        verify_state: "commit_rejected",
        attempts: 3,
        last_agent: "critic",
        title: "Wire factory trigger into dispatch path",
        failure_reason: "critic flagged unsafe shell invocation",
      },
    ],
    events: [
      { ts: ago(2), event: "agent_run", role: "coder", agent: "claude", status: "tests_pass", task_id: "t-2042", duration_s: 47 },
      { ts: ago(3), event: "cycle_start", cycle: 2 },
      { ts: ago(5), event: "task_done", task_id: "t-2041", commit_sha: "a91b3c4d" },
      { ts: ago(6), event: "agent_run", role: "reviewer", agent: "claude", status: "pass", task_id: "t-2041", duration_s: 22 },
      { ts: ago(8), event: "task_failed", task_id: "t-2044", reason: "critic flagged unsafe shell invocation" },
    ],
  },
  {
    id: "atlas-api",
    name: "atlas-api",
    repo_url: "github.com/lionelchamorro/atlas-api",
    workspace_path: "~/code/atlas-api",
    base_branch: "develop",
    watch: { prs: true, issues: false },
    state: "idle",
    description: "GraphQL gateway and auth service for the Atlas platform.",
    language: "TypeScript",
    cost_usd: 12.4,
    last_run: ago(95),
    features: [
      {
        id: "f-77",
        status: "done",
        branch: "feat/rate-limit",
        tasks_done: 4,
        tasks_failed: 0,
        cost_usd: 3.1,
        title: "Token-bucket rate limiting middleware",
        pr_url: "https://github.com/lionelchamorro/atlas-api/pull/120",
      },
    ],
    tasks: [
      {
        id: "t-7701",
        status: "done",
        verify_state: "commit_ok",
        attempts: 1,
        last_agent: "reviewer",
        title: "Add token-bucket limiter with Redis backend",
      },
      {
        id: "t-7702",
        status: "done",
        verify_state: "tests_pass",
        attempts: 2,
        last_agent: "tester",
        title: "Integration tests for burst windows",
      },
    ],
    events: [
      { ts: ago(95), event: "cycle_end", cycle: 1, new_tasks_proposed: 0 },
      { ts: ago(97), event: "task_done", task_id: "t-7702", commit_sha: "b220ff19" },
    ],
  },
  {
    id: "lumen-ui",
    name: "lumen-ui",
    repo_url: "github.com/lionelchamorro/lumen-ui",
    workspace_path: "~/code/lumen-ui",
    base_branch: "main",
    watch: { prs: false, issues: true },
    state: "needs_human",
    description: "Design system and component library for internal tools.",
    language: "TypeScript",
    cost_usd: 6.05,
    last_run: ago(31),
    features: [
      {
        id: "f-12",
        status: "needs_human",
        branch: "feat/theming-tokens",
        tasks_done: 2,
        tasks_failed: 2,
        cost_usd: 2.7,
        title: "Runtime theming tokens with CSS variables",
      },
    ],
    tasks: [
      {
        id: "t-1201",
        status: "needs_human",
        verify_state: "tests_fail",
        attempts: 3,
        last_agent: "critic",
        title: "Migrate legacy SCSS vars to CSS custom properties",
        failure_reason: "visual regression in 4 snapshots",
      },
      {
        id: "t-1202",
        status: "decomposed",
        verify_state: "pending",
        attempts: 0,
        last_agent: "parser",
        title: "Split token migration into per-package tasks",
      },
    ],
    events: [
      { ts: ago(31), event: "tester_verification_failed", task_id: "t-1201", command: "pnpm test:visual" },
      { ts: ago(33), event: "cycle_start", cycle: 3 },
    ],
  },
  {
    id: "ledger-core",
    name: "ledger-core",
    repo_url: "github.com/lionelchamorro/ledger-core",
    workspace_path: "~/code/ledger-core",
    base_branch: "main",
    watch: { prs: false, issues: false },
    state: "paused",
    description: "Double-entry accounting engine with audit trails.",
    language: "Rust",
    cost_usd: 0,
    last_run: ago(1440),
    features: [],
    tasks: [],
    events: [],
  },
]

export function getProject(id: string): Project | undefined {
  return projects.find((p) => p.id === id)
}

export const teamRoles: {
  role: string
  label: string
  blurb: string
}[] = [
  { role: "parser", label: "Parser", blurb: "Turns the plan into structured tasks." },
  { role: "coder", label: "Coder", blurb: "Implements each task in the workspace." },
  { role: "tester", label: "Tester", blurb: "Runs the suite and verifies claims." },
  { role: "critic", label: "Critic", blurb: "Reviews diffs for risk and quality." },
  { role: "reviewer", label: "Reviewer", blurb: "Approves and commits successful tasks." },
]

// A canned conversation used as the seed of the global chat.
export const seedChat = [
  {
    id: "m1",
    role: "assistant" as const,
    content:
      "Hola. Soy el agente de administración de Orquesta. Puedo registrar proyectos, alternar watchers, lanzar runs y definir features para cualquier proyecto del registro. ¿Qué querés hacer?",
  },
]

export function liveEventFor(projectId: string): RunEvent {
  const roles: RunEvent["role"][] = ["parser", "coder", "tester", "critic", "reviewer"]
  const role = roles[Math.floor(Math.random() * roles.length)]
  const kinds: RunEvent["event"][] = ["agent_run", "task_start", "task_done", "cycle_start"]
  const event = kinds[Math.floor(Math.random() * kinds.length)]
  return {
    ts: new Date().toISOString(),
    event,
    role,
    agent: "claude",
    status: "pass",
    task_id: "t-" + Math.floor(1000 + Math.random() * 9000),
    duration_s: Math.floor(10 + Math.random() * 80),
    project: projectId,
  }
}


export const teams: TeamDefinition[] = [
  {
    id: "default",
    name: "Default delivery team",
    description: "The team.json roster used by orq-lite for planning, implementation, verification, and review.",
    source: "mock",
    agents: [
      {
        id: "codex_gpt5",
        provider: "codex",
        model: "gpt-5.5",
        effort: "medium",
        rate_limit_pattern: "(?i)(429|usage limit reached|rate_?limit_exceeded|quota.*exceeded|usage limit)",
      },
      {
        id: "claude_sonnet",
        provider: "claude",
        model: "claude-sonnet-4-6",
        dangerously_skip_permissions: true,
      },
      {
        id: "claude_opus",
        provider: "claude",
        model: "claude-opus-4-8",
        dangerously_skip_permissions: true,
      },
    ],
    roles: [
      {
        role: "planner",
        agents: ["claude_sonnet", "claude_opus"],
        prompt: "prompts/factory-planner.md",
        result_path: ".orquestalite/results/planner.json",
        timeout_seconds: 900,
      },
      {
        role: "parser",
        agents: ["claude_opus"],
        prompt: "prompts/parser.md",
        result_path: ".orquestalite/results/parser.json",
        timeout_seconds: 600,
        decompose_prompt: "prompts/parser-decompose.md",
      },
      {
        role: "coder",
        agents: ["codex_gpt5", "claude_sonnet"],
        prompt: "prompts/coder.md",
        result_path: ".orquestalite/results/coder.json",
        timeout_seconds: 1800,
      },
      {
        role: "tester",
        agents: ["claude_sonnet", "codex_gpt5"],
        prompt: "prompts/tester.md",
        result_path: ".orquestalite/results/tester.json",
        timeout_seconds: 900,
      },
      {
        role: "critic",
        agents: ["claude_opus", "codex_gpt5"],
        prompt: "prompts/critic.md",
        result_path: ".orquestalite/results/critic.json",
        timeout_seconds: 600,
      },
      {
        role: "verifier",
        agents: ["claude_sonnet", "codex_gpt5"],
        prompt: "prompts/verifier.md",
        result_path: ".orquestalite/results/verifier.json",
        timeout_seconds: 600,
        mode: "per_cycle",
        cycle_prompt: "prompts/verifier-cycle.md",
      },
      {
        role: "reviewer",
        agents: ["claude_opus", "codex_gpt5"],
        prompt: "prompts/reviewer.md",
        result_path: ".orquestalite/results/reviewer.json",
        timeout_seconds: 900,
      },
    ],
    limits: {
      max_review_cycles: 3,
      max_fix_iterations: 5,
      verify_tester_command: true,
    },
    full_test_command: "go test ./...",
    lint_command: "",
  },
]

// Engine-valid demo flows: condensed from the real orq-lite bundled flows.json
// and examples/pr-review — same step vocabulary the engine actually parses
// (no invented fields, exactly one of command/args per command step).
export const flows: FlowDefinition[] = [
  {
    id: "factory",
    name: "factory",
    description:
      "Develop features in parallel on their own branches and create PRs (per-task coder/tester/critic retry loop).",
    entrypoint: "orq-lite flow run factory features_path=features.md",
    inputs: {
      features_path: { type: "string", default: "features.md" },
      base_branch: { type: "string", default: "main" },
    },
    source: "mock",
    steps: [
      {
        type: "action",
        action: "factory_extract_features",
        inputs: { path: "{inputs.features_path}" },
        outputs: { features_queue: "." },
      },
      {
        type: "loop",
        iterator: "{features_queue}",
        as: "feature",
        body: [
          {
            type: "command",
            args: ["git", "checkout", "-b", "{feature.branch_name}", "{inputs.base_branch}"],
          },
          {
            type: "agent",
            agent: "parser",
            inputs: { PLAN: "{feature.plan}" },
            outputs: { tasks: "tasks" },
          },
          {
            type: "retry_until",
            condition: "{task_verified} == true",
            max_retries: 5,
            body: [
              {
                type: "agent",
                agent: "coder",
                inputs: { TASKS: "{tasks}" },
                outputs: { coder_res: "." },
              },
              {
                type: "command",
                command: "go test ./...",
                on_failure: "continue",
                outputs: { test_res: "." },
              },
              {
                type: "eval",
                expression: "{test_res.pass}",
                outputs: { task_verified: "." },
              },
            ],
          },
          {
            type: "command",
            args: ["git", "push", "-u", "origin", "{feature.branch_name}"],
            on_failure: "continue",
          },
        ],
      },
    ],
  },
  {
    id: "pr_review",
    name: "pr_review",
    description:
      "Review an existing GitHub pull request with independent lenses plus test + lint gates, then post the verdict as a PR comment.",
    entrypoint: "orq-lite flow run pr_review pr_number=42",
    inputs: {
      pr_number: { type: "string" },
      test_command: { type: "string", default: "go test ./..." },
    },
    source: "mock",
    steps: [
      {
        type: "command",
        args: ["gh", "pr", "checkout", "{inputs.pr_number}"],
      },
      {
        type: "command",
        args: ["gh", "pr", "diff", "{inputs.pr_number}"],
        outputs: { pr_diff: "." },
      },
      {
        type: "command",
        command: "{inputs.test_command}",
        on_failure: "continue",
        outputs: { test_res: "." },
      },
      {
        type: "agent",
        agent: "critic",
        inputs: { FILES_CHANGED: "{pr_diff.stdout}" },
        outputs: { critic_res: "." },
      },
      {
        type: "command",
        args: ["gh", "pr", "comment", "{inputs.pr_number}", "--body", "{critic_res.review_body}"],
        on_failure: "continue",
      },
    ],
  },
]
