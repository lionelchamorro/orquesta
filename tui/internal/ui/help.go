package ui

import (
	"strings"

	"github.com/charmbracelet/lipgloss"
)

type helpEntry struct {
	keys    string
	desc    string
	relevant func(mode RightPaneMode, chatOpen bool) bool
}

var helpEntries = []helpEntry{
	{"q · ctrl+c", "quit", always},
	{"r", "refresh run state", notInPTY},
	{"j / k · ↑/↓", "select agent", notInPTY},
	{"pgup / pgdn · ctrl+f / ctrl+b", "page through list", notInPTY},
	{"g / G · home / end", "jump to top / bottom", notInPTY},
	{"enter (on agent)", "attach live PTY (live) or replay (dead)", inAgentDetail},
	{"esc", "back / detach PTY / dismiss overlay", always},
	{"R", "resume claude/codex session for dead agent", inAgentDetail},
	{"/", "open chat composer to selected agent", inAgentDetail},
	{"[ / ] · , / .", "previous / next iteration", notInPTY},
	{"p", "pin / unpin selected agent", inAgentDetail},
	{"?", "toggle this help", always},
}

func always(_ RightPaneMode, _ bool) bool { return true }

func inAgentDetail(mode RightPaneMode, chatOpen bool) bool {
	return !chatOpen && mode == ModeAgentDetail
}

func notInPTY(mode RightPaneMode, chatOpen bool) bool {
	if chatOpen {
		return false
	}
	return mode != ModeLivePTY && mode != ModeReplayPTY && mode != ModeResumedPTY
}

func renderHelp(mode RightPaneMode, chatOpen bool, width int) string {
	rows := []string{title.Render("keys")}
	for _, e := range helpEntries {
		line := padKeys(e.keys, 32) + e.desc
		if !e.relevant(mode, chatOpen) {
			line = muted.Render(line)
		}
		rows = append(rows, line)
	}
	return lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(lipgloss.Color("#888")).
		Width(max(48, width-4)).
		Padding(0, 1).
		Render(strings.Join(rows, "\n"))
}

func padKeys(s string, width int) string {
	if len(s) >= width {
		return s + "  "
	}
	return s + strings.Repeat(" ", width-len(s))
}
