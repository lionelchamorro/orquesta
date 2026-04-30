# [023] TUI narrow-width fallback + help overlay (`?`)

**Labels:** `tui`, `enhancement`, `needs-triage`

## Parent

[`tasks/prd/0001-tui-fix-and-planner-ui-strip.md`](../prd/0001-tui-fix-and-planner-ui-strip.md)

## What to build

Polish pass: at narrow terminal widths the TUI must degrade gracefully, and the user must be able to discover keys they don't use often. End-to-end: resizing the terminal below ~80 columns reflows from two-column to vertically-stacked panes with sensible default heights; pressing `?` from any mode opens a full keymap help overlay summarising every keybinding the TUI exposes.

## Acceptance criteria

- [ ] At width ≥ 80: persistent two-column layout (left: list, right: mode-switched).
- [ ] At width < 80: vertical stack — list on top, right-pane content below, footer at the bottom. Both Activity feed and Agent Detail still render correctly in the narrower pane.
- [ ] `?` opens a full keymap help overlay listing all keys (navigation, right-pane modes, iteration nav, chat, pin, resume, quit). `esc` or `?` again closes it.
- [ ] Help overlay is mode-aware: keys irrelevant to the current state are visually de-emphasised (still listed, just dimmed).
- [ ] Modal overlays (`AgentDetail`-derived modes, chat, help) all behave correctly at narrow widths.

## Blocked by

- [#015](015-tui-agent-detail-on-cursor.md)
- [#016](016-tui-activity-feed-cursor-filtered.md)
- [#019](019-tui-chat-overlay.md)
- [#020](020-tui-ask-toast.md)
- [#021](021-tui-iteration-nav.md)
