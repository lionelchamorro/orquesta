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
		case "k", "up":
			if h.cursor > 0 {
				h.cursor--
			}
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
	footer := muted.Render("j/k select agent  enter attach tty  r refresh  q quit")
	contentHeight := max(1, height-1)
	if width >= 80 {
		left := max(28, width*35/100)
		right := max(20, width-left)
		return lipgloss.JoinHorizontal(
			lipgloss.Top,
			renderList(h.state, h.cursor, left, contentHeight),
			renderPreview(h.selectedAgent, h.ttyBuffer, right, contentHeight),
		) + "\n" + footer
	}
	top := max(8, contentHeight/2)
	return lipgloss.JoinVertical(
		lipgloss.Left,
		renderList(h.state, h.cursor, width, top),
		renderPreview(h.selectedAgent, h.ttyBuffer, width, contentHeight-top),
		footer,
	)
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
