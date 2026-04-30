package ui

import (
	"strings"

	"github.com/charmbracelet/lipgloss"
)

// ChatOverlay is a tiny pure value: text the user is typing, the target
// agent and role, and an optional inline error.
type ChatOverlay struct {
	Open     bool
	AgentID  string
	Role     string
	Text     string
	Error    string
}

func (c ChatOverlay) AppendRune(r rune) ChatOverlay {
	c.Text += string(r)
	return c
}

func (c ChatOverlay) Backspace() ChatOverlay {
	if c.Text == "" {
		return c
	}
	c.Text = c.Text[:len(c.Text)-1]
	return c
}

func (c ChatOverlay) Reset() ChatOverlay {
	return ChatOverlay{}
}

func renderChatOverlay(c ChatOverlay, width int) string {
	if !c.Open {
		return ""
	}
	header := title.Render("chat → " + c.AgentID + " · " + c.Role)
	input := "› " + c.Text + "▌"
	hints := muted.Render("enter send  esc cancel")
	body := []string{header, input}
	if c.Error != "" {
		body = append(body, bad.Render("error: "+c.Error))
	}
	body = append(body, hints)
	return lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(lipgloss.Color("#888")).
		Width(max(40, width-4)).
		Padding(0, 1).
		Render(strings.Join(body, "\n"))
}
