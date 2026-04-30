package ui

import (
	"fmt"
	"strings"

	"github.com/lionelchamorro/orquesta/tui/internal/client"
)

// SelectionKind identifies what the cursor is currently parked on, which
// drives both the right-pane mode and the activity-feed filter.
type SelectionKind int

const (
	SelectionNone SelectionKind = iota
	SelectionTask
	SelectionAgent
)

// Selection is a pure value derived from cursor position. The Iteration
// field is only used when Kind is SelectionNone.
type Selection struct {
	Kind SelectionKind
	ID   string
}

// selectionFilter returns a predicate that decides whether a given event
// belongs in the activity feed for the current selection. SelectionNone
// falls back to "events for the currently displayed iteration", or any
// untagged top-level event (e.g. run_completed).
func selectionFilter(sel Selection, iterationNumber int) func(client.TaggedEvent) bool {
	switch sel.Kind {
	case SelectionTask:
		return func(e client.TaggedEvent) bool { return hasTag(e.Tags, sel.ID) }
	case SelectionAgent:
		return func(e client.TaggedEvent) bool { return hasTag(e.Tags, sel.ID) }
	default:
		iterTag := fmt.Sprintf("iter-%d", iterationNumber)
		return func(e client.TaggedEvent) bool {
			if len(e.Tags) == 0 {
				return true
			}
			if hasTag(e.Tags, iterTag) {
				return true
			}
			for _, tag := range e.Tags {
				if strings.HasPrefix(tag, "iter-") {
					return false
				}
			}
			return true
		}
	}
}

func hasTag(tags []string, want string) bool {
	for _, tag := range tags {
		if tag == want {
			return true
		}
	}
	return false
}

// renderActivity renders the activity feed for the given events, applying
// the selection-driven filter. A small format and the viewport from #013
// keep the cursor pinned to the live tail.
func renderActivity(events []client.TaggedEvent, sel Selection, iter, offset, width, height int) (string, int) {
	predicate := selectionFilter(sel, iter)
	rows := make([]string, 0, len(events))
	for _, ev := range events {
		if !predicate(ev) {
			continue
		}
		rows = append(rows, formatEvent(ev))
	}
	if len(rows) == 0 {
		body := muted.Render("(no events for current selection)")
		return border.Width(width).Height(height).Render(title.Render("Activity") + "\n" + body), offset
	}
	v := Viewport{Cursor: len(rows) - 1, Offset: offset}.Move(0, len(rows), height-1)
	visible, _ := v.Slice(rows, height-1)
	body := strings.Join(visible, "\n")
	return border.Width(width).Height(height).Render(title.Render("Activity") + "\n" + body), v.Offset
}

func formatEvent(e client.TaggedEvent) string {
	ts := e.TS
	if len(ts) > 19 {
		ts = ts[:19]
	}
	tags := strings.Join(e.Tags, ",")
	return fmt.Sprintf("%s %s %s", ts, e.Type(), muted.Render(tags))
}
