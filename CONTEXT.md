# Context

The shared language for working on this repo. Updated as terms get resolved.

## Run

One execution of a Task DAG by the orq daemon, from start to a terminal
status (`done` | `failed` | `failed_quota`). Stored under
`.orquesta/crew/`. Identified by `runId`. A Run lives across multiple
iterations; the iteration counter resets on a new Run.

## Task DAG

The directed acyclic graph of Tasks for a given iteration. Edges are
dependencies (`depends_on`). Tasks whose dependencies are satisfied run in
parallel. The DAG is the input the daemon executes — historically produced
by the planner agent, going forward produced **externally** during day
mode (see *Day mode* / *Night mode*).

## Iteration

One full pass of a Run over the current Task DAG.

1. The orchestrator runs all dependency-resolved Tasks in parallel.
2. Each Task internally runs its **task pipeline** (coder → tester →
   critic → fix) for up to N **sub-iterations**.
3. When every Task in the DAG has reached a terminal state, the iteration
   boundary fires.
4. **Validators** (architect / pm / qa) examine the deliverables and may
   emit a fresh DAG to be addressed in iteration N+1.

The Run terminates when (a) all validators agree there is nothing left to
do (none emit new tasks), or (b) `max_iterations` is reached.

## Sub-iteration (per-task iteration)

The coder → tester → critic → fix loop inside a single Task. Bounded by
`maxAttemptsPerTask`. Independent of the Run's iteration counter. A Task
may complete in one sub-iteration; one full Run iteration may contain many
Tasks each running many sub-iterations.

## Validators

The `architect`, `pm`, and `qa` roles. Run **sequentially** at each
iteration boundary in that order. Each receives the original goal, the
current deliverable summary, and the list of refinement Tasks already
proposed by earlier validators in the same boundary. Each can:

- `emit_tasks` to add work to iteration N+1, **or**
- `report_complete` to signal no new gaps from their lens.

**Agreement to stop**: if architect, pm, and qa all `report_complete`
without emitting tasks, the Run terminates with status derived from the
final task states. This is the "auto-improvement loop" terminating
condition.

## Day mode

The human-driven, interactive workflow that produces the initial Task
DAG. Lives **outside** the orq daemon. The human iterates with
claude / codex / gemini using grilling, PRD, and decomposition skills
(`/grill-with-docs`, `/to-prd`, `/to-issues`) until the DAG is ready to
hand off.

The handoff artifact is a JSON payload accepted by
`POST /api/runs { prompt, max_iterations?, tasks: [...] }`; the daemon
validates it and starts the Run directly in `running`.

The `build-dag` skill lives in `templates/build-dag-skill/` (`SKILL.md`
and generated `dag-schema.json`). It is exposed unauthenticated via
`GET /api/skill/build-dag` and `GET /api/skill/build-dag/schema`. The
`orq skill install [--target claude|codex|gemini|all]` command installs
it project-locally with per-CLI adapters (Claude=`SKILL.md` file,
Codex=block in `AGENTS.md`, Gemini=block in `GEMINI.md`).

## Night mode

The orq daemon executing a pre-built Task DAG over N iterations,
AFK. Validators auto-correct between iterations. No human grilling is
expected during night mode — questions are routed to fallback / timeout.

## Resume

Re-attaching to an underlying CLI's own conversation by its captured
`cli_session_id`, inside the original `session_cwd`. Implemented via the
CLI's native flag (`claude --resume <id>`, `codex resume <id>`). Distinct
from:

- **Live attach** — watching a still-running agent's PTY.
- **Replay** — reading a dead agent's cached PTY scrollback (the daemon
  keeps the last 200 KB).

Resume requires both `cli_session_id` (captured from claude/codex stdout)
and the worktree at `session_cwd` to still exist. Gemini does not support
resume by stable id.

## Worktree

A git worktree provisioned per Task by orq under `.orquesta/crew/...`.
Owned for the duration of the Task. Whether it survives Task completion
depends on cleanup policy; resume needs it intact.

## Consultant

A `pm` or `architect` agent spawned at the **start** of an iteration
wave and kept alive for the duration of that wave. Two responsibilities:

1. **Consult** — answer questions routed by the ask-router from workers
   (coder/tester/critic) via the `answer_ask` MCP tool.
2. **Validate** — at the wave's iteration boundary the same agent
   transitions to validator mode (re-prompted via `pool.write`) and may
   `emit_tasks` for iteration N+1 or `report_complete` to signal no gaps.

Lifecycle is **per-iteration**: spawned at wave start, killed at wave
close. The same conversation carries through both modes, preserving
context. If a consultant dies mid-wave (crash, 429), recovery respawns
it via the next orchestrator tick (see *Iteration.phase*).

Consultants are subject to the same fallback chain as workers (V2): if
the primary CLI/model is rate-limited, the chain promotes to the next
candidate. The wave does not begin dispatching workers until both
consultants are `live`.

## Fallback chain

Per-role ordered list of `(cli, model)` candidates declared on
`config.team[role].fallbacks`. The first candidate is the primary; the
rest are fallbacks. The pool tracks `unavailableUntil: Map<"cli:model",
ISO>` in memory. When a subtask hits 429, the orchestrator resets it to
`pending`, conserves the worktree, stores the event in
`Subtask.fallback_attempts`, and the next dispatch selects the first
available candidate. The new agent receives the worktree state, the
chain of previous attempts, and the prior agent's last `final_text` as
retry context.

Cross-CLI fallback is supported (claude → codex → gemini). Cross-account
is not (yet) modeled.

## Iteration.phase

State persisted on each Iteration to make recovery deterministic:

- `executing` — workers + consultants running in the wave.
- `validating` — wave's tasks all reached terminal status; consultants
  are running their validator pass at the boundary.

If `phase === "validating"` and `ended_at` is absent, recovery re-spawns
any missing validators and blocks worker dispatch until the boundary
closes. If `phase === "executing"` and no consultants are live, the
next tick respawns them.

## target_role

Field on `PendingAsk` indicating which consultant the question is meant
for: `"pm"` (default — scope/priority/intent) or `"architect"`
(technical/design). The worker passes `target_role` in `ask_user`. The
ask-router routes to the corresponding live consultant. The
`answer_ask` MCP tool requires the responder's role to match
`target_role`.

## Run lifecycle

The daemon is single-tenant: one Run at a time. `POST /api/runs`
returns 409 if a Run is active. To replace, call `POST
/api/runs/:id/cancel` first; the cancelled Run is moved to
`crew/archive/`. Status `awaiting_approval` is removed; new Runs start
in `running` directly.
