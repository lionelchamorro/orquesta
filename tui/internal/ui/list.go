package ui

import (
	"fmt"
	"strings"

	"github.com/lionelchamorro/orquesta/tui/internal/client"
)

func renderList(state client.RunState, cursor int, width, height int) string {
	var rows []string
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
	for i, agent := range state.Agents {
		prefix := "  "
		if cursor == i {
			prefix = "> "
		}
		rows = append(rows, fmt.Sprintf("%s%s %s %s %s", prefix, statusGlyph(agent.Status), agent.ID, agent.Role, muted.Render(agent.Status)))
	}
	if len(rows) > height {
		rows = rows[:height]
	}
	return border.Width(width).Height(height).Render(strings.Join(rows, "\n"))
}

func findSubtask(subtasks []client.Subtask, id string) client.Subtask {
	for _, subtask := range subtasks {
		if subtask.ID == id {
			return subtask
		}
	}
	return client.Subtask{}
}
