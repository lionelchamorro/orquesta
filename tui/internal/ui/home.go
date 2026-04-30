package ui

import (
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/lionelchamorro/orquesta/tui/internal/client"
)

type Home struct {
	api           *client.Client
	events        <-chan client.TaggedEvent
	state         client.RunState
	width         int
	height        int
	cursor        int
	listOffset    int
	pane          RightPane
	selectedAgent string
	ttyBuffer     string
	ttyEvents     chan ttyMsg
	err           error
}

type runStateMsg struct {
	state client.RunState
	err   error
}

type eventMsg client.TaggedEvent

type ttyMsg struct {
	agentID string
	chunk   string
	err     error
}

func NewHome(api *client.Client, events <-chan client.TaggedEvent) Home {
	return Home{api: api, events: events, ttyEvents: make(chan ttyMsg, 64)}
}

func (h Home) Init() tea.Cmd {
	return tea.Batch(h.fetchRunState(), waitEvent(h.events))
}

func (h Home) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		h.width = msg.Width
		h.height = msg.Height
	case tea.KeyMsg:
		switch msg.String() {
		case "q", "ctrl+c":
			return h, tea.Quit
		case "r":
			return h, h.fetchRunState()
		case "j", "down":
			if h.cursor < len(h.state.Agents)-1 {
				h.cursor++
			}
			h.listOffset = settleListOffset(h.state, h.cursor, h.listOffset, h.listPaneHeight())
			h.pane = focusForCursor(h.pane, h.state.Agents, h.cursor)
		case "k", "up":
			if h.cursor > 0 {
				h.cursor--
			}
			h.listOffset = settleListOffset(h.state, h.cursor, h.listOffset, h.listPaneHeight())
			h.pane = focusForCursor(h.pane, h.state.Agents, h.cursor)
		case "pgdown", "ctrl+f":
			page := pageSize(h.listPaneHeight())
			h.cursor = clamp(h.cursor+page, 0, max(0, len(h.state.Agents)-1))
			h.listOffset = settleListOffset(h.state, h.cursor, h.listOffset, h.listPaneHeight())
		case "pgup", "ctrl+b":
			page := pageSize(h.listPaneHeight())
			h.cursor = clamp(h.cursor-page, 0, max(0, len(h.state.Agents)-1))
			h.listOffset = settleListOffset(h.state, h.cursor, h.listOffset, h.listPaneHeight())
		case "g", "home":
			h.cursor = 0
			h.listOffset = 0
		case "G", "end":
			h.cursor = max(0, len(h.state.Agents)-1)
			h.listOffset = settleListOffset(h.state, h.cursor, 0, h.listPaneHeight())
		case "enter":
			if len(h.state.Agents) > 0 {
				h.selectedAgent = h.state.Agents[h.cursor].ID
				h.ttyBuffer = ""
				return h, tea.Batch(h.startTTY(h.selectedAgent), waitTTY(h.ttyEvents))
			}
		}
	case runStateMsg:
		h.err = msg.err
		if msg.err == nil {
			h.state = msg.state
			if h.cursor >= len(h.state.Agents) {
				h.cursor = max(0, len(h.state.Agents)-1)
			}
			h.pane = focusForCursor(h.pane, h.state.Agents, h.cursor)
		}
	case eventMsg:
		event := client.TaggedEvent(msg)
		if isStructural(event.Type()) {
			return h, tea.Batch(h.fetchRunState(), waitEvent(h.events))
		}
		return h, waitEvent(h.events)
	case ttyMsg:
		if msg.agentID != h.selectedAgent {
			return h, nil
		}
		if msg.err != nil {
			h.ttyBuffer = appendTTY(h.ttyBuffer, "\n[terminal closed]\n")
			return h, nil
		}
		h.ttyBuffer = appendTTY(h.ttyBuffer, msg.chunk)
		return h, waitTTY(h.ttyEvents)
	}
	return h, nil
}

func (h Home) View() string {
	width := h.width
	height := h.height
	if width == 0 {
		width = 100
	}
	if height == 0 {
		height = 30
	}
	if h.err != nil {
		return bad.Render(h.err.Error())
	}
	footer := muted.Render("j/k select agent  pgup/pgdn page  g/G top/bottom  enter attach  r refresh  q quit")
	contentHeight := max(1, height-1)
	if width >= 80 {
		left := max(28, width*35/100)
		right := max(20, width-left)
		return lipgloss.JoinHorizontal(
			lipgloss.Top,
			renderList(h.state, h.cursor, h.listOffset, left, contentHeight),
			h.renderRightPane(right, contentHeight),
		) + "\n" + footer
	}
	top := max(8, contentHeight/2)
	return lipgloss.JoinVertical(
		lipgloss.Left,
		renderList(h.state, h.cursor, h.listOffset, width, top),
		h.renderRightPane(width, contentHeight-top),
		footer,
	)
}

// renderRightPane dispatches based on the current pane mode. AgentDetail
// shows the info card; everything else falls back to the legacy TTY preview
// (which #017 will replace).
func (h Home) renderRightPane(width, height int) string {
	if h.selectedAgent != "" {
		return renderPreview(h.selectedAgent, h.ttyBuffer, width, height)
	}
	if h.pane.Mode == ModeAgentDetail && h.pane.AgentID != "" {
		for _, a := range h.state.Agents {
			if a.ID == h.pane.AgentID {
				return renderAgentDetail(a, worktreeForAgent(h.state, a), width, height)
			}
		}
	}
	return renderPreview("", "", width, height)
}

// focusForCursor moves the right pane between Activity and AgentDetail
// based on the cursor position; PTY modes are left untouched.
func focusForCursor(p RightPane, agents []client.Agent, cursor int) RightPane {
	if p.Mode != ModeActivity && p.Mode != ModeAgentDetail {
		return p
	}
	if cursor < 0 || cursor >= len(agents) {
		next, err := p.BlurAgent()
		if err != nil {
			return p
		}
		return next
	}
	next, err := p.FocusAgent(agents[cursor].ID)
	if err != nil {
		return p
	}
	return next
}

// worktreeForAgent finds the worktree path for the agent's bound task.
func worktreeForAgent(state client.RunState, a client.Agent) string {
	if a.BoundTask == "" {
		return ""
	}
	for _, t := range state.Tasks {
		if t.ID == a.BoundTask {
			return t.WorktreePath
		}
	}
	return ""
}

// listPaneHeight returns the visible height of the list pane for the current
// terminal size, mirroring the layout logic in View.
func (h Home) listPaneHeight() int {
	height := h.height
	if height == 0 {
		height = 30
	}
	width := h.width
	if width == 0 {
		width = 100
	}
	contentHeight := max(1, height-1)
	if width >= 80 {
		return contentHeight
	}
	return max(8, contentHeight/2)
}

func pageSize(height int) int {
	if height <= 1 {
		return 1
	}
	return height - 1
}

func (h Home) fetchRunState() tea.Cmd {
	return func() tea.Msg {
		state, err := h.api.GetRunsCurrent()
		return runStateMsg{state: state, err: err}
	}
}

func waitEvent(events <-chan client.TaggedEvent) tea.Cmd {
	return func() tea.Msg {
		return eventMsg(<-events)
	}
}

func (h Home) startTTY(agentID string) tea.Cmd {
	return func() tea.Msg {
		tty, err := h.api.OpenTTY(agentID)
		if err != nil {
			return ttyMsg{agentID: agentID, err: err}
		}
		go func() {
			defer tty.Close()
			buf := make([]byte, 4096)
			for {
				n, err := tty.Read(buf)
				if n > 0 {
					h.ttyEvents <- ttyMsg{agentID: agentID, chunk: string(buf[:n])}
				}
				if err != nil {
					h.ttyEvents <- ttyMsg{agentID: agentID, err: err}
					return
				}
			}
		}()
		return nil
	}
}

func waitTTY(events <-chan ttyMsg) tea.Cmd {
	return func() tea.Msg {
		return <-events
	}
}

func isStructural(eventType string) bool {
	switch eventType {
	case "tasks_emitted", "task_ready", "task_started", "task_completed", "task_cancelled",
		"subtask_started", "subtask_completed", "subtask_failed", "critic_findings",
		"task_merged", "task_archived", "agent_completed", "agent_failed", "plan_approved":
		return true
	default:
		return strings.HasPrefix(eventType, "iteration_")
	}
}
