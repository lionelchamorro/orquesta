package ui

import "fmt"

// RightPaneMode enumerates the modes the right pane can be in. Per ADR-0002,
// each mode owns its own input handling and render. Only Activity and
// AgentDetail are reachable in this slice; the others are stubs.
type RightPaneMode int

const (
	ModeActivity RightPaneMode = iota
	ModeAgentDetail
	ModeLivePTY
	ModeReplayPTY
	ModeResumedPTY
)

// RightPane is a pure value: Mode + the focused AgentID (when applicable).
// All transitions return a new RightPane and an error if the action is
// illegal from the current mode.
type RightPane struct {
	Mode    RightPaneMode
	AgentID string
}

// FocusAgent moves to AgentDetail when in Activity or AgentDetail. Illegal
// from any PTY mode in this slice.
func (p RightPane) FocusAgent(agentID string) (RightPane, error) {
	switch p.Mode {
	case ModeActivity, ModeAgentDetail:
		return RightPane{Mode: ModeAgentDetail, AgentID: agentID}, nil
	default:
		return p, fmt.Errorf("FocusAgent illegal from mode %v", p.Mode)
	}
}

// BlurAgent returns to Activity. Only legal from AgentDetail or Activity in
// this slice.
func (p RightPane) BlurAgent() (RightPane, error) {
	switch p.Mode {
	case ModeActivity:
		return p, nil
	case ModeAgentDetail:
		return RightPane{Mode: ModeActivity}, nil
	default:
		return p, fmt.Errorf("BlurAgent illegal from mode %v", p.Mode)
	}
}

// AttachLive is a stub: it must be reachable later, but is not in this
// slice. Returns an error.
func (p RightPane) AttachLive(agentID string) (RightPane, error) {
	return p, fmt.Errorf("AttachLive not reachable in this slice")
}

// Replay is a stub for #017.
func (p RightPane) Replay(agentID string) (RightPane, error) {
	return p, fmt.Errorf("Replay not reachable in this slice")
}

// AttachResumed is a stub for #018.
func (p RightPane) AttachResumed(agentID string) (RightPane, error) {
	return p, fmt.Errorf("AttachResumed not reachable in this slice")
}

// agent is the local view of an Agent record used by purity-preserving
// helpers. The full client.Agent struct is converted to this shape at the
// pane boundary.
type agent struct {
	ID            string
	Role          string
	CLI           string
	Model         string
	Status        string
	BoundTask     string
	BoundSubtask  string
	SessionCWD    string
	CLISessionID  string
	StartedAt     string
	FinishedAt    string
	LastActivity  string
	ExitCode      *int
	StopReason    string
	DurationMS    *int64
	TotalCostUSD  *float64
	NumTurns      *int
	WorktreePath  string
}

// resumable returns whether an agent can be resumed and, if not, a short
// human-readable reason. The cwdExists predicate is injected so the helper
// stays pure for tests.
func resumable(a agent, cwdExists func(string) bool) (bool, string) {
	if a.CLISessionID == "" {
		return false, "no captured cli session id"
	}
	if a.CLI != "claude" && a.CLI != "codex" {
		return false, fmt.Sprintf("cli %q does not support resume", a.CLI)
	}
	if a.SessionCWD == "" || !cwdExists(a.SessionCWD) {
		return false, "session cwd missing on disk"
	}
	return true, ""
}
