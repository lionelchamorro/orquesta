package ui

import (
	"strings"
	"testing"
)

func TestRightPane_DefaultIsActivity(t *testing.T) {
	var p RightPane
	if p.Mode != ModeActivity {
		t.Fatalf("zero-value RightPane should be ModeActivity, got %v", p.Mode)
	}
}

func TestRightPane_FocusAgent_TransitionsToAgentDetail(t *testing.T) {
	p := RightPane{Mode: ModeActivity}
	next, err := p.FocusAgent("agent-1")
	if err != nil {
		t.Fatalf("FocusAgent from Activity should be legal, got %v", err)
	}
	if next.Mode != ModeAgentDetail {
		t.Fatalf("expected ModeAgentDetail, got %v", next.Mode)
	}
	if next.AgentID != "agent-1" {
		t.Fatalf("expected AgentID=agent-1, got %q", next.AgentID)
	}
}

func TestRightPane_BlurAgent_FromAgentDetail_GoesToActivity(t *testing.T) {
	p := RightPane{Mode: ModeAgentDetail, AgentID: "agent-1"}
	next, err := p.BlurAgent()
	if err != nil {
		t.Fatalf("BlurAgent from AgentDetail should be legal, got %v", err)
	}
	if next.Mode != ModeActivity {
		t.Fatalf("expected ModeActivity, got %v", next.Mode)
	}
	if next.AgentID != "" {
		t.Fatalf("expected empty AgentID, got %q", next.AgentID)
	}
}

func TestRightPane_BlurFromLivePTY_IsRejected(t *testing.T) {
	p := RightPane{Mode: ModeLivePTY, AgentID: "agent-1"}
	if _, err := p.BlurAgent(); err == nil {
		t.Fatalf("BlurAgent from LivePTY should be illegal in this slice")
	}
}

func TestRightPane_AgentDetail_AttachLive_GoesToLivePTY(t *testing.T) {
	p := RightPane{Mode: ModeAgentDetail, AgentID: "agent-1"}
	next, err := p.AttachLive("agent-1")
	if err != nil {
		t.Fatalf("AttachLive from AgentDetail should be legal, got %v", err)
	}
	if next.Mode != ModeLivePTY {
		t.Fatalf("expected ModeLivePTY, got %v", next.Mode)
	}
	if next.AgentID != "agent-1" {
		t.Fatalf("expected AgentID=agent-1, got %q", next.AgentID)
	}
}

func TestRightPane_AgentDetail_Replay_GoesToReplayPTY(t *testing.T) {
	p := RightPane{Mode: ModeAgentDetail, AgentID: "agent-1"}
	next, err := p.Replay("agent-1")
	if err != nil {
		t.Fatalf("Replay from AgentDetail should be legal, got %v", err)
	}
	if next.Mode != ModeReplayPTY {
		t.Fatalf("expected ModeReplayPTY, got %v", next.Mode)
	}
}

func TestRightPane_LivePTY_Detach_ReturnsToAgentDetail(t *testing.T) {
	p := RightPane{Mode: ModeLivePTY, AgentID: "agent-1"}
	next, err := p.Detach()
	if err != nil {
		t.Fatalf("Detach from LivePTY should be legal, got %v", err)
	}
	if next.Mode != ModeAgentDetail {
		t.Fatalf("expected ModeAgentDetail, got %v", next.Mode)
	}
	if next.AgentID != "agent-1" {
		t.Fatalf("expected AgentID kept on detach, got %q", next.AgentID)
	}
}

func TestRightPane_ReplayPTY_Detach_ReturnsToAgentDetail(t *testing.T) {
	p := RightPane{Mode: ModeReplayPTY, AgentID: "agent-1"}
	next, err := p.Detach()
	if err != nil {
		t.Fatalf("Detach from ReplayPTY should be legal, got %v", err)
	}
	if next.Mode != ModeAgentDetail {
		t.Fatalf("expected ModeAgentDetail, got %v", next.Mode)
	}
}

func TestRightPane_AttachLive_FromActivity_Rejected(t *testing.T) {
	p := RightPane{Mode: ModeActivity}
	if _, err := p.AttachLive("agent-1"); err == nil {
		t.Fatalf("AttachLive from Activity must be illegal — must focus first")
	}
}

func TestResumable_AllConditionsTrue(t *testing.T) {
	a := agent{
		CLI:           "claude",
		CLISessionID:  "sess-abc",
		SessionCWD:    "/exists",
	}
	exists := func(p string) bool { return p == "/exists" }
	ok, reason := resumable(a, exists)
	if !ok {
		t.Fatalf("expected resumable=true, got false (reason=%q)", reason)
	}
	if reason != "" {
		t.Fatalf("expected empty reason on success, got %q", reason)
	}
}

func TestResumable_NoSessionID(t *testing.T) {
	a := agent{CLI: "claude", CLISessionID: "", SessionCWD: "/exists"}
	exists := func(string) bool { return true }
	ok, reason := resumable(a, exists)
	if ok || !strings.Contains(reason, "session") {
		t.Fatalf("expected (false, reason mentioning session), got (%v, %q)", ok, reason)
	}
}

func TestResumable_UnsupportedCLI(t *testing.T) {
	a := agent{CLI: "gemini", CLISessionID: "sess-abc", SessionCWD: "/exists"}
	exists := func(string) bool { return true }
	ok, reason := resumable(a, exists)
	if ok || !strings.Contains(reason, "gemini") {
		t.Fatalf("expected false with reason mentioning gemini, got (%v, %q)", ok, reason)
	}
}

func TestResumable_CWDMissing(t *testing.T) {
	a := agent{CLI: "claude", CLISessionID: "sess-abc", SessionCWD: "/missing"}
	exists := func(string) bool { return false }
	ok, reason := resumable(a, exists)
	if ok || !strings.Contains(reason, "cwd") {
		t.Fatalf("expected false with reason mentioning cwd, got (%v, %q)", ok, reason)
	}
}
