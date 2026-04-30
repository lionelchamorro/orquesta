package ui

import (
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/lionelchamorro/orquesta/tui/internal/client"
)

type Home struct {
	api            *client.Client
	events         <-chan client.TaggedEvent
	state          client.RunState
	width          int
	height         int
	cursor         int
	listOffset     int
	pane           RightPane
	activityBuffer []client.TaggedEvent
	activityOffset int
	tty            *client.TTY
	ttyAgentID     string
	ttyBuffer      string
	ttyEvents      chan ttyMsg
	err            error
}

const maxActivityBuffer = 1000

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

type ttyOpenedMsg struct {
	agentID string
	tty     *client.TTY
	err     error
}

func NewHome(api *client.Client, events <-chan client.TaggedEvent) Home {
	return Home{api: api, events: events, ttyEvents: make(chan ttyMsg, 64)}
}

func (h Home) Init() tea.Cmd {
	return tea.Batch(h.fetchRunState(), waitEvent(h.events))
}

func (h *Home) closeTTY() {
	if h.tty != nil {
		_ = h.tty.Close()
		h.tty = nil
	}
	h.ttyAgentID = ""
	h.ttyBuffer = ""
}

func (h Home) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		h.width = msg.Width
		h.height = msg.Height
	case tea.KeyMsg:
		// In LivePTY mode, forward typed keys to the PTY (read-only in
		// ReplayPTY). Reserved keys (esc, ctrl+c) still apply.
		if h.pane.Mode == ModeLivePTY && h.tty != nil {
			switch msg.String() {
			case "esc":
				h.closeTTY()
				if next, err := h.pane.Detach(); err == nil {
					h.pane = next
				}
				return h, nil
			case "ctrl+c", "q":
				return h, tea.Quit
			default:
				_, _ = h.tty.Write([]byte(msg.String()))
				return h, nil
			}
		}
		switch msg.String() {
		case "q", "ctrl+c":
			return h, tea.Quit
		case "esc":
			if h.pane.Mode == ModeLivePTY || h.pane.Mode == ModeReplayPTY || h.pane.Mode == ModeResumedPTY {
				h.closeTTY()
				if next, err := h.pane.Detach(); err == nil {
					h.pane = next
				}
			}
			return h, nil
		case "r":
			return h, h.fetchRunState()
		case "j", "down":
			if h.pane.Mode == ModeLivePTY || h.pane.Mode == ModeReplayPTY {
				h.closeTTY()
			}
			if h.cursor < len(h.state.Agents)-1 {
				h.cursor++
			}
			h.listOffset = settleListOffset(h.state, h.cursor, h.listOffset, h.listPaneHeight())
			h.pane = focusForCursor(h.pane, h.state.Agents, h.cursor)
		case "k", "up":
			if h.pane.Mode == ModeLivePTY || h.pane.Mode == ModeReplayPTY {
				h.closeTTY()
			}
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
			if h.pane.Mode != ModeAgentDetail || h.pane.AgentID == "" {
				return h, nil
			}
			agent, ok := findAgent(h.state.Agents, h.pane.AgentID)
			if !ok {
				return h, nil
			}
			h.ttyBuffer = ""
			if agent.Status == "dead" {
				if next, err := h.pane.Replay(agent.ID); err == nil {
					h.pane = next
				}
			} else {
				if next, err := h.pane.AttachLive(agent.ID); err == nil {
					h.pane = next
				}
			}
			return h, tea.Batch(h.startTTY(agent.ID), waitTTY(h.ttyEvents))
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
		h.activityBuffer = append(h.activityBuffer, event)
		if len(h.activityBuffer) > maxActivityBuffer {
			h.activityBuffer = h.activityBuffer[len(h.activityBuffer)-maxActivityBuffer:]
		}
		if isStructural(event.Type()) {
			return h, tea.Batch(h.fetchRunState(), waitEvent(h.events))
		}
		return h, waitEvent(h.events)
	case ttyOpenedMsg:
		if msg.err != nil {
			h.ttyBuffer = appendTTY(h.ttyBuffer, "\n[failed to open terminal: "+msg.err.Error()+"]\n")
			return h, nil
		}
		h.tty = msg.tty
		h.ttyAgentID = msg.agentID
		go func(tty *client.TTY, agentID string, ch chan<- ttyMsg) {
			buf := make([]byte, 4096)
			for {
				n, err := tty.Read(buf)
				if n > 0 {
					ch <- ttyMsg{agentID: agentID, chunk: string(buf[:n])}
				}
				if err != nil {
					ch <- ttyMsg{agentID: agentID, err: err}
					return
				}
			}
		}(msg.tty, msg.agentID, h.ttyEvents)
		return h, waitTTY(h.ttyEvents)
	case ttyMsg:
		if msg.agentID != h.ttyAgentID {
			return h, waitTTY(h.ttyEvents)
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
	if isEmptyRun(h.state) {
		return renderEmpty(width, height) + "\n" + muted.Render("r refresh  q quit")
	}
	footer := h.footerForMode()
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

func (h Home) footerForMode() string {
	switch h.pane.Mode {
	case ModeLivePTY:
		return muted.Render("typing → PTY  esc detach  ctrl+c quit")
	case ModeReplayPTY:
		return muted.Render("read-only replay  esc back  q quit")
	default:
		return muted.Render("j/k select  pgup/pgdn page  g/G top/bottom  enter attach  esc back  r refresh  q quit")
	}
}

// renderRightPane dispatches based on the current pane mode.
func (h Home) renderRightPane(width, height int) string {
	switch h.pane.Mode {
	case ModeLivePTY:
		return renderLivePTY(h.pane.AgentID, h.ttyBuffer, width, height)
	case ModeReplayPTY:
		return renderReplayPTY(h.pane.AgentID, h.ttyBuffer, width, height)
	case ModeAgentDetail:
		if h.pane.AgentID == "" {
			break
		}
		if a, ok := findAgent(h.state.Agents, h.pane.AgentID); ok {
			return renderAgentDetail(a, worktreeForAgent(h.state, a), width, height)
		}
	}
	sel := Selection{Kind: SelectionNone}
	out, _ := renderActivity(h.activityBuffer, sel, h.state.Plan.CurrentIteration, h.activityOffset, width, height)
	return out
}

func findAgent(agents []client.Agent, id string) (client.Agent, bool) {
	for _, a := range agents {
		if a.ID == id {
			return a, true
		}
	}
	return client.Agent{}, false
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

func isEmptyRun(state client.RunState) bool {
	return state.Plan.RunID == "" || state.Plan.RunID == "run-1" || len(state.Tasks) == 0
}

func renderEmpty(width, height int) string {
	body := strings.Join([]string{
		title.Render("No run yet"),
		"",
		"Build a Task DAG and start a run with:",
		"",
		"  orq import <file>",
		"  orq start",
		"",
		muted.Render("See tasks/prd/0001-tui-fix-and-planner-ui-strip.md"),
		muted.Render("for the import payload format."),
	}, "\n")
	return border.Width(width).Height(max(1, height-1)).Render(body)
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
		return ttyOpenedMsg{agentID: agentID, tty: tty, err: err}
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
