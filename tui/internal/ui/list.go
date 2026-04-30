package ui

import (
	"fmt"
	"strings"

	"github.com/lionelchamorro/orquesta/tui/internal/client"
)

// buildListRows produces the full list of rendered rows plus the row index of
// each agent in state.Agents (agentRows[i] is the absolute row index of the
// i-th agent). The cursor parameter is used only to render the ">" prefix on
// the selected agent row.
func buildListRows(state client.RunState, cursor int) (rows []string, agentRows []int) {
	rows = append(rows, title.Render(fmt.Sprintf("Run %s", state.Plan.Status)))
	for _, task := range state.Tasks {
		rows = append(rows, fmt.Sprintf("  %s %s %s", statusGlyph(task.Status), strings.ToUpper(task.ID), task.Title))
		for _, subID := range task.Subtasks {
			sub := findSubtask(state.Subtasks, subID)
			if sub.ID == "" {
				continue
			}
			rows = append(rows, fmt.Sprintf("    %s %s %s", statusGlyph(sub.Status), sub.ID, sub.Role))
		}
	}
	rows = append(rows, "")
	rows = append(rows, title.Render("Agents"))
	agentRows = make([]int, 0, len(state.Agents))
	for i, agent := range state.Agents {
		prefix := "  "
		if cursor == i {
			prefix = "> "
		}
		agentRows = append(agentRows, len(rows))
		rows = append(rows, fmt.Sprintf("%s%s %s %s %s", prefix, statusGlyph(agent.Status), agent.ID, agent.Role, muted.Render(agent.Status)))
	}
	return rows, agentRows
}

func renderList(state client.RunState, cursor int, listOffset, width, height int) string {
	rows, agentRows := buildListRows(state, cursor)
	selectedRow := 0
	if cursor >= 0 && cursor < len(agentRows) {
		selectedRow = agentRows[cursor]
	}
	v := Viewport{Cursor: selectedRow, Offset: listOffset}.Move(0, len(rows), height)
	visible, _ := v.Slice(rows, height)
	return border.Width(width).Height(height).Render(strings.Join(visible, "\n"))
}

// settleListOffset returns the new list offset after a cursor change, given
// the previous offset, the current state, the new cursor (agent index), and
// the visible pane height.
func settleListOffset(state client.RunState, cursor, prevOffset, height int) int {
	rows, agentRows := buildListRows(state, cursor)
	if cursor < 0 || cursor >= len(agentRows) {
		return 0
	}
	v := Viewport{Cursor: agentRows[cursor], Offset: prevOffset}.Move(0, len(rows), height)
	return v.Offset
}

func findSubtask(subtasks []client.Subtask, id string) client.Subtask {
	for _, subtask := range subtasks {
		if subtask.ID == id {
			return subtask
		}
	}
	return client.Subtask{}
}
