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
