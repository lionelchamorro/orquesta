package ui

import "github.com/charmbracelet/lipgloss"

var (
	border = lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).BorderForeground(lipgloss.Color("240")).Padding(0, 1)
	title  = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("230"))
	muted  = lipgloss.NewStyle().Foreground(lipgloss.Color("244"))
	live   = lipgloss.NewStyle().Foreground(lipgloss.Color("42"))
	warn   = lipgloss.NewStyle().Foreground(lipgloss.Color("214"))
	bad    = lipgloss.NewStyle().Foreground(lipgloss.Color("203"))
)

func statusGlyph(status string) string {
	switch status {
	case "done":
		return live.Render("✓")
	case "running", "working", "live":
		return warn.Render("◐")
	case "failed":
		return bad.Render("✕")
	case "cancelled", "dead":
		return muted.Render("⊘")
	case "ready":
		return warn.Render("✎")
	default:
		return muted.Render("•")
	}
}
