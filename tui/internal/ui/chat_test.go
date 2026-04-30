package ui

import "testing"

func TestChatOverlay_AppendRune_AddsText(t *testing.T) {
	c := ChatOverlay{Open: true, AgentID: "a", Role: "pm"}
	c = c.AppendRune('h').AppendRune('i')
	if c.Text != "hi" {
		t.Fatalf("expected text=hi, got %q", c.Text)
	}
}

func TestChatOverlay_Backspace_TrimsLastChar(t *testing.T) {
	c := ChatOverlay{Open: true, Text: "abc"}
	c = c.Backspace()
	if c.Text != "ab" {
		t.Fatalf("expected ab, got %q", c.Text)
	}
	c = c.Backspace().Backspace().Backspace()
	if c.Text != "" {
		t.Fatalf("expected empty after extra backspaces, got %q", c.Text)
	}
}

func TestChatOverlay_Reset_Closes(t *testing.T) {
	c := ChatOverlay{Open: true, AgentID: "a", Text: "draft"}
	c = c.Reset()
	if c.Open || c.Text != "" {
		t.Fatalf("expected closed empty overlay, got %+v", c)
	}
}
