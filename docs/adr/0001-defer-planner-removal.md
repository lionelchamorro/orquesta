# ADR 0001 — Defer planner removal; strip UI surfaces only

Date: 2026-04-30
Status: Accepted

## Context

orq today has three "planning" mechanisms: a human-prompted **planner
agent** that drafts the initial DAG, **validators** (architect/pm/qa)
that emit refinement DAGs at iteration boundaries, and within-task
**critic-driven fix loops**.

We are moving to a Day-mode / Night-mode split (see `CONTEXT.md`):

- **Day mode** (human + interactive LLMs, external to orq) produces the
  initial Task DAG. Plan #2 will design the seam (issue tracker / files /
  CLI ingest).
- **Night mode** (orq daemon) executes the DAG and runs validator-driven
  iterations until agreement-to-stop or max iterations.

This makes the planner agent vestigial: nothing in the new flow types a
prompt at orq and asks for a draft DAG.

We have to decide *when* to remove the planner.

## Decision

In plan #1 (TUI fix + planner UI strip):

- Remove planner-mode **UI surfaces** from both the React Web UI and the
  Go TUI: `PlanPrompt`, the planner-mode 3-column layout, the "Approve &
  Start" banner, and the empty-mode prompt input. The empty state becomes
  a static "no run yet — import tasks" placeholder.
- **Leave `PlannerService`, `/api/plan`, `/api/approve`, `awaiting_approval`,
  the `planner` role, and planner adapter argv intact** in the daemon.
- Add a minimal task-ingestion shim (`POST /api/tasks/import` and an
  `orq import <file>` CLI subcommand) so a Run can be started without the
  planner — enough to test plan #1 end-to-end.

Defer full planner removal to plan #2, where the day-mode ingestion
contract is designed.

## Consequences

### Positive

- Plan #1 stays small and shippable: the TUI work is the headline; the UI
  strip is mechanical; the import shim is a few hundred lines.
- The daemon does not enter a half-finished state where the only path to
  start a Run is broken.
- Plan #2 can revisit ingestion holistically (file watch? GitHub poll?
  Linear webhook? `orq import`?) without being constrained by a stub
  shipped under time pressure.
- `awaiting_approval` and the planner agent remain available as an
  emergency fallback during the transition (e.g. via `curl
  /api/plan` if someone needs the old flow).

### Negative

- The daemon temporarily carries dead code (planner role, planner argv,
  planner-service). `bun test` will keep covering it.
- Anyone wiring up plan #2 has to remember to remove the planner code
  paths; risk of leaving them as a permanent legacy. Mitigation: this
  ADR is referenced from plan #2's PRD as a hard prerequisite.
- The empty-state UI loses a "natural way to start" — users *must* know
  to run `orq import` from a terminal until plan #2 lands. Acceptable
  given the audience is the maintainers themselves at this stage.

## Alternatives considered

- **(B) Strip UI + gut the daemon planner now.** Cleaner end-state but
  leaves the daemon with no input mechanism for the duration between plan
  #1 and plan #2. Rejected: violates "daemon is always usable".
- **(C) (B) plus design the full ingestion mechanism in plan #1.** Pulls
  most of plan #2 forward. Rejected: defeats the split agreed in Q1; the
  ingestion design deserves its own grilling session.
- **(D) Keep the planner UI for now.** No new feature, but blocks the
  Day-mode/Night-mode mental model from landing. Rejected: the UI shape
  shapes user habits.

## Follow-up

- Plan #2 must remove `PlannerService`, the `planner` role, `/api/plan`,
  `/api/approve`, `awaiting_approval`, and the planner-related code in
  the seed flow.
- The `Plan` domain term should be retired in favor of `Run` once the
  planner is gone — `CONTEXT.md` already uses `Run`.
