# Context

The shared language for working on this repo. Updated as terms get resolved.

## Run

One execution of a Task DAG by the orq daemon, from start to a terminal
status (`done` | `failed`). Stored under `.orquesta/crew/`. Identified by
`runId`. A Run lives across multiple iterations; the iteration counter
resets on a new Run.

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
