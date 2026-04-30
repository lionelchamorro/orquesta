# ADR 0002 — TUI information architecture: cursor-driven activity, modal agent detail

Date: 2026-04-30
Status: Accepted

## Context

The Go TUI (`tui/internal/ui/*.go`) currently shows two surfaces: a
combined Tasks+Agents list on the left, and a single PTY view on the
right that activates only when the user presses `enter` on an agent. It
is missing every other surface the React Web UI has: the iteration
navigator, the activity feed, the chat composer, the resume action, the
ask toast, the structured agent-detail view, the empty/planner overlays,
and a working scroll model. The current rendering also clips silently:
`renderList` slices `rows[:height]` without a viewport.

The Web UI is dense (3 columns + iteration nav + ephemeral live row +
modal drawer), which works in a browser but does not transplant well to
a TUI. We need a TUI shape that delivers Web-UI feature parity *without*
mirroring the multi-pane density.

## Decision

The TUI uses a **two-column persistent layout with a mode-switched right
pane and ephemeral overlays**:

```
┌─────────────────────────────────────────────────────────────┐
│ Run … · Iter [N]/M · status     [<,>] iter   [?] help [q]uit│
├──────────────────────┬──────────────────────────────────────┤
│ Tasks (iter N)       │ Activity  ← default                  │
│   …                  │   …                                  │
│ ─ Agents ──          │                                      │
│   …                  │                                      │
├──────────────────────┴──────────────────────────────────────┤
│ context-sensitive footer keymap                             │
└─────────────────────────────────────────────────────────────┘
```

- **Left column**: persistent. Tasks list (filtered to the currently
  selected iteration) and Agents list, with one cursor that moves between
  groups.
- **Right column**: defaults to a **cursor-filtered Activity feed**
  (cursor on a task ⇒ that task's events; cursor on an agent ⇒ that
  agent's events; nothing selected ⇒ all events for current iteration).
- **`enter` on an agent** flips the right column to **Agent Detail**: a
  structured (c) info card on top, PTY (replay if dead, live if alive)
  below. Header shows `[R] resume` if `cli_session_id` is captured.
  `esc` returns to the Activity default.
- **`R`** on a resumable dead agent posts to
  `/api/agents/:id/resume` and re-attaches to the resumed PTY.
- **`[` / `]`** moves between iterations globally (filters tasks and
  activity).
- **`/`** opens an ephemeral chat overlay at the bottom of the screen,
  targeting the currently-selected agent (or the planner agent if any
  exists; otherwise disabled).
- **`p`** pins/unpins the selected agent.
- **Toasts** (asks needing answers) appear top-right ephemerally.
- **Empty mode** (no Run): full-screen static message instructing the
  user to run `orq import <file>`. There is no in-TUI prompt entry;
  Day-mode happens outside (see ADR-0001).

The list pane uses a **proper scroll viewport** that keeps the cursor
visible; the silent `rows[:height]` slice is removed.

## Consequences

### Positive

- All ten Web-UI surfaces map to TUI placements (Shell, IterationNav,
  Tasks, Agents, Activity, LiveStream, TerminalDrawer, ChatComposer,
  PlanPrompt-equivalent, Toast).
- One persistent layout. No tab-switching cognitive load. Footer keymap
  is always visible and changes with mode.
- Cursor-driven filtering of Activity is a *single* mechanism that
  collapses what the Web UI does with three different selection states
  (task, agent, neither).
- The `enter`-flips-right-pane idiom mirrors Web's modal drawer
  semantically — different chrome, same mental model.

### Negative

- You cannot see Activity *and* an agent's PTY at the same time inside
  the TUI. The Web UI can. For users who want both, the answer is "open
  the Web UI in another window" — acceptable given the TUI's job is
  fast keyboard inspection, not split-pane monitoring.
- Reflowing the layout at narrow widths (<80 columns) requires a
  fallback. The current code already has a vertical-stack fallback at
  width<80; the new design must too. Modal sub-panes (Agent Detail,
  Chat overlay) need their own narrow-mode rules.

## Alternatives considered

- **Full multi-pane mirror.** Three or four side-by-side columns at all
  times. Rejected: degrades badly below ~140 columns, fights Bubble
  Tea's reflow model, doubles the rendering complexity.
- **Tabbed full-screen views** (`1` Tasks, `2` Activity, `3` Agents,
  `4` Chat). Rejected: hides the cross-pane relationships (e.g., "this
  task is being worked by these agents") that the persistent left
  column makes free.
- **Top/bottom split inside the right column** (Activity always above,
  PTY always below). Rejected: at typical TUI heights neither half is
  big enough to be useful, and PTY scrollback fights with activity
  scroll.
