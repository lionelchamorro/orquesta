package ui

import (
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/lionelchamorro/orquesta/tui/internal/client"
)

func toLocalAgent(a client.Agent, worktreePath string) agent {
	return agent{
		ID:           a.ID,
		Role:         a.Role,
		CLI:          a.CLI,
		Model:        a.Model,
		Status:       a.Status,
		BoundTask:    a.BoundTask,
		BoundSubtask: a.BoundSubtask,
		SessionCWD:   a.SessionCWD,
		CLISessionID: a.CLISessionID,
		StartedAt:    a.StartedAt,
		FinishedAt:   a.FinishedAt,
		LastActivity: a.LastActivity,
		ExitCode:     a.ExitCode,
		StopReason:   a.StopReason,
		DurationMS:   a.DurationMS,
		TotalCostUSD: a.TotalCostUSD,
		NumTurns:     a.NumTurns,
		WorktreePath: worktreePath,
	}
}

func dash(s string) string {
	if strings.TrimSpace(s) == "" {
		return "—"
	}
	return s
}

func dashInt(p *int) string {
	if p == nil {
		return "—"
	}
	return fmt.Sprintf("%d", *p)
}

func dashDuration(p *int64) string {
	if p == nil {
		return "—"
	}
	d := time.Duration(*p) * time.Millisecond
	return d.Truncate(time.Millisecond).String()
}

func dashCost(p *float64) string {
	if p == nil {
		return "—"
	}
	return fmt.Sprintf("$%.4f", *p)
}

func diskExists(path string) bool {
	if path == "" {
		return false
	}
	_, err := os.Stat(path)
	return err == nil
}

func renderAgentDetail(a client.Agent, worktreePath string, width, height int) string {
	la := toLocalAgent(a, worktreePath)
	resumeOK, resumeReason := resumable(la, diskExists)
	resumeLine := "yes"
	if !resumeOK {
		resumeLine = fmt.Sprintf("no (%s)", resumeReason)
	}
	worktreeLine := "—"
	if worktreePath != "" {
		if diskExists(worktreePath) {
			worktreeLine = fmt.Sprintf("%s (exists)", worktreePath)
		} else {
			worktreeLine = fmt.Sprintf("%s (missing)", worktreePath)
		}
	}

	rows := []string{
		title.Render(fmt.Sprintf("Agent %s", a.ID)),
		fmt.Sprintf("role:        %s", dash(a.Role)),
		fmt.Sprintf("cli:         %s", dash(a.CLI)),
		fmt.Sprintf("model:       %s", dash(a.Model)),
		fmt.Sprintf("status:      %s", dash(a.Status)),
		fmt.Sprintf("bound task:  %s", dash(a.BoundTask)),
		fmt.Sprintf("bound sub:   %s", dash(a.BoundSubtask)),
		fmt.Sprintf("started at:  %s", dash(a.StartedAt)),
		fmt.Sprintf("finished at: %s", dash(a.FinishedAt)),
		fmt.Sprintf("last event:  %s", dash(a.LastEventAt)),
		fmt.Sprintf("duration:    %s", dashDuration(a.DurationMS)),
		fmt.Sprintf("turns:       %s", dashInt(a.NumTurns)),
		fmt.Sprintf("cost:        %s", dashCost(a.TotalCostUSD)),
		fmt.Sprintf("exit code:   %s", dashInt(a.ExitCode)),
		fmt.Sprintf("stop:        %s", dash(a.StopReason)),
		fmt.Sprintf("session id:  %s", dash(a.CLISessionID)),
		fmt.Sprintf("session cwd: %s", dash(a.SessionCWD)),
		fmt.Sprintf("worktree:    %s", worktreeLine),
		fmt.Sprintf("resumable:   %s", resumeLine),
	}
	if len(rows) > height {
		rows = rows[:height]
	}
	return border.Width(width).Height(height).Render(strings.Join(rows, "\n"))
}
