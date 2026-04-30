# [013] TUI scrolling viewport (fix list clipping)

**Labels:** `tui`, `bug`, `enhancement`, `needs-triage`

## Parent

[`tasks/prd/0001-tui-fix-and-planner-ui-strip.md`](../prd/0001-tui-fix-and-planner-ui-strip.md)

## What to build

Replace the silent `rows[:height]` slice in the Go TUI's list renderer with a proper scrolling viewport that keeps the cursor visible as the user moves through Tasks and Agents. The viewport is a pure module reused later by the Activity feed.

End-to-end: opening the TUI against any Run with more Tasks+Agents than fit on screen lets the user scroll through the entire list with `j/k` and page keys; nothing is silently dropped.

## Acceptance criteria

- [ ] A pure `viewport` module owns `(content, cursorIdx, height) → (visibleSlice, cursorRow)` with no I/O.
- [ ] `j` / `k` / `down` / `up` move the cursor; the viewport scrolls to keep the cursor visible.
- [ ] `pgdn` / `pgup` page through; `g` / `G` jump to top/bottom.
- [ ] Cursor never lands on an out-of-range index; viewport never scrolls past content.
- [ ] When content is shorter than the pane height, no scrolling occurs and the full content is shown.
- [ ] The combined Tasks + Agents list uses the viewport. No content is silently truncated regardless of terminal height.
- [ ] Unit tests in `tui/internal/ui/viewport_test.go` cover cursor clamping, scroll-to-keep-visible, paging, top/bottom keys, and the short-content case.

## Blocked by

None — can start immediately.
