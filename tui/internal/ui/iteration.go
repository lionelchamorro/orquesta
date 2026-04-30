package ui

import (
	"fmt"
	"strings"

	"github.com/lionelchamorro/orquesta/tui/internal/client"
)

// FilterTasksByIteration returns tasks whose Iteration matches n. Pure.
func FilterTasksByIteration(tasks []client.Task, n int) []client.Task {
	out := make([]client.Task, 0, len(tasks))
	for _, t := range tasks {
		if t.Iteration == n {
			out = append(out, t)
		}
	}
	return out
}

// FilterEventsByIteration returns events tagged "iter-N" or untagged
// run-level events. Pure.
func FilterEventsByIteration(events []client.TaggedEvent, n int) []client.TaggedEvent {
	predicate := selectionFilter(Selection{Kind: SelectionNone}, n)
	out := make([]client.TaggedEvent, 0, len(events))
	for _, e := range events {
		if predicate(e) {
			out = append(out, e)
		}
	}
	return out
}

// ClampIteration keeps the displayed iteration in [1, max].
func ClampIteration(n, max int) int {
	if max < 1 {
		max = 1
	}
	if n < 1 {
		return 1
	}
	if n > max {
		return max
	}
	return n
}

// FilterAgentsForIteration drops agents bound to other iterations' tasks
// unless they are pinned. Pure: takes a "task is in iteration" predicate.
func FilterAgentsForIteration(agents []client.Agent, taskInIteration func(string) bool, pinned map[string]bool) []client.Agent {
	out := make([]client.Agent, 0, len(agents))
	for _, a := range agents {
		if pinned[a.ID] {
			out = append(out, a)
			continue
		}
		if a.BoundTask == "" || taskInIteration(a.BoundTask) {
			out = append(out, a)
		}
	}
	return out
}

func renderHeader(state client.RunState, displayedIter int, width int) string {
	plan := state.Plan
	runID := plan.RunID
	if runID == "" {
		runID = "(no run)"
	}
	iter := fmt.Sprintf("Iter [%d]/%d", displayedIter, planMax(plan))
	hints := muted.Render("[<,>] iter  [?] help  [q] quit")
	left := fmt.Sprintf("%s · %s · %s", runID, iter, plan.Status)
	bar := left
	gap := width - len(left) - len(stripAnsi(hints)) - 2
	if gap > 0 {
		bar = bar + strings.Repeat(" ", gap) + hints
	} else {
		bar = bar + " " + hints
	}
	return title.Render(bar)
}

func planMax(plan client.Plan) int {
	if plan.MaxIterations < 1 {
		return 1
	}
	return plan.MaxIterations
}

// stripAnsi removes lipgloss styling sequences for length math. Best-effort.
func stripAnsi(s string) string {
	out := make([]byte, 0, len(s))
	skip := false
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c == 0x1b {
			skip = true
			continue
		}
		if skip {
			if c == 'm' {
				skip = false
			}
			continue
		}
		out = append(out, c)
	}
	return string(out)
}
