package ui

import (
	"strings"
)

const maxTTYBuffer = 200 * 1024

func appendTTY(buffer, chunk string) string {
	buffer += chunk
	if len(buffer) > maxTTYBuffer {
		buffer = buffer[len(buffer)-maxTTYBuffer:]
	}
	return buffer
}

func renderPreview(agentID, buffer string, width, height int) string {
	head := "Terminal"
	if agentID != "" {
		head += " " + agentID
	}
	lines := strings.Split(buffer, "\n")
	if len(lines) > height-2 {
		lines = lines[len(lines)-(height-2):]
	}
	body := strings.Join(lines, "\n")
	if strings.TrimSpace(body) == "" {
		body = muted.Render("Select an agent with j/k, press enter to attach.")
	}
	return border.Width(width).Height(height).Render(title.Render(head) + "\n" + body)
}

// renderLivePTY renders a streaming PTY view with a "live" header.
func renderLivePTY(agentID, buffer string, width, height int) string {
	head := title.Render("Live · " + agentID)
	body := tailLines(buffer, height-2)
	if strings.TrimSpace(body) == "" {
		body = muted.Render("(connecting…)")
	}
	return border.Width(width).Height(height).Render(head + "\n" + body)
}

// renderReplayPTY renders a dead agent's cached scrollback with a clear
// "exited · replay" banner. Read-only — no input is forwarded.
func renderReplayPTY(agentID, buffer string, width, height int) string {
	head := title.Render("Exited · replay · " + agentID)
	body := tailLines(buffer, height-2)
	if strings.TrimSpace(body) == "" {
		body = muted.Render("(no cached output)")
	}
	return border.Width(width).Height(height).Render(head + "\n" + body)
}

func tailLines(buffer string, n int) string {
	if n <= 0 {
		return ""
	}
	lines := strings.Split(buffer, "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.Join(lines, "\n")
}
