package ui

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

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
	chat              ChatOverlay
	toasts            ToastQueue
	displayedIter     int
	pinnedAgents      map[string]bool
	iterationOverride bool
	err               error
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

type resumeMsg struct {
	agentID string
	err     error
}

type chatSendMsg struct {
	agentID string
	err     error
}

func NewHome(api *client.Client, events <-chan client.TaggedEvent) Home {
	return Home{api: api, events: events, ttyEvents: make(chan ttyMsg, 64), pinnedAgents: map[string]bool{}, displayedIter: 1}
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
		// Chat overlay swallows all keys when open.
		if h.chat.Open {
			switch msg.String() {
			case "esc":
				h.chat = h.chat.Reset()
				return h, nil
			case "enter":
				if strings.TrimSpace(h.chat.Text) == "" {
					return h, nil
				}
				return h, h.sendChat(h.chat.AgentID, h.chat.Text)
			case "backspace":
				h.chat = h.chat.Backspace()
				return h, nil
			case "ctrl+c":
				return h, tea.Quit
			default:
				if r := []rune(msg.String()); len(r) == 1 {
					h.chat = h.chat.AppendRune(r[0])
				}
				return h, nil
			}
		}
		// In LivePTY/ResumedPTY mode, forward typed keys to the PTY
		// (read-only in ReplayPTY). Reserved keys (esc, ctrl+c) still apply.
		if (h.pane.Mode == ModeLivePTY || h.pane.Mode == ModeResumedPTY) && h.tty != nil {
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
			switch h.pane.Mode {
			case ModeLivePTY, ModeReplayPTY, ModeResumedPTY:
				h.closeTTY()
				if next, err := h.pane.Detach(); err == nil {
					h.pane = next
				}
			}
			return h, nil
		case "r":
			return h, h.fetchRunState()
		case "j", "down":
			if h.pane.Mode == ModeLivePTY || h.pane.Mode == ModeReplayPTY || h.pane.Mode == ModeResumedPTY {
				h.closeTTY()
			}
			agents := h.visibleAgents()
			if h.cursor < len(agents)-1 {
				h.cursor++
			}
			h.listOffset = settleListOffset(h.listStateFiltered(), h.cursor, h.listOffset, h.listPaneHeight())
			h.pane = focusForCursor(h.pane, agents, h.cursor)
		case "k", "up":
			if h.pane.Mode == ModeLivePTY || h.pane.Mode == ModeReplayPTY || h.pane.Mode == ModeResumedPTY {
				h.closeTTY()
			}
			if h.cursor > 0 {
				h.cursor--
			}
			h.listOffset = settleListOffset(h.listStateFiltered(), h.cursor, h.listOffset, h.listPaneHeight())
			h.pane = focusForCursor(h.pane, h.visibleAgents(), h.cursor)
		case "pgdown", "ctrl+f":
			page := pageSize(h.listPaneHeight())
			h.cursor = clamp(h.cursor+page, 0, max(0, len(h.visibleAgents())-1))
			h.listOffset = settleListOffset(h.listStateFiltered(), h.cursor, h.listOffset, h.listPaneHeight())
		case "pgup", "ctrl+b":
			page := pageSize(h.listPaneHeight())
			h.cursor = clamp(h.cursor-page, 0, max(0, len(h.visibleAgents())-1))
			h.listOffset = settleListOffset(h.listStateFiltered(), h.cursor, h.listOffset, h.listPaneHeight())
		case "g", "home":
			h.cursor = 0
			h.listOffset = 0
		case "G", "end":
			h.cursor = max(0, len(h.visibleAgents())-1)
			h.listOffset = settleListOffset(h.listStateFiltered(), h.cursor, 0, h.listPaneHeight())
		case "[", ",":
			h.displayedIter = ClampIteration(h.displayedIter-1, planMax(h.state.Plan))
			h.iterationOverride = true
		case "]", ".":
			h.displayedIter = ClampIteration(h.displayedIter+1, planMax(h.state.Plan))
			h.iterationOverride = true
		case "p":
			if h.pane.Mode == ModeAgentDetail && h.pane.AgentID != "" {
				if h.pinnedAgents[h.pane.AgentID] {
					delete(h.pinnedAgents, h.pane.AgentID)
				} else {
					h.pinnedAgents[h.pane.AgentID] = true
				}
			}
		case "enter":
			// Pending toast jump-to-agent takes priority when no pane action applies.
			if latest, ok := h.toasts.Latest(time.Now(), defaultToastTimeout); ok && h.pane.Mode != ModeAgentDetail {
				agents := h.visibleAgents()
				if idx := agentIndex(agents, latest.AgentID); idx >= 0 {
					h.cursor = idx
					h.listOffset = settleListOffset(h.listStateFiltered(), h.cursor, h.listOffset, h.listPaneHeight())
					h.pane = focusForCursor(h.pane, agents, h.cursor)
				}
				h.toasts = h.toasts.Dismiss(latest.AskID)
				return h, nil
			}
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
		case "/":
			if h.pane.Mode != ModeAgentDetail || h.pane.AgentID == "" {
				return h, nil
			}
			agent, ok := findAgent(h.state.Agents, h.pane.AgentID)
			if !ok {
				return h, nil
			}
			h.chat = ChatOverlay{Open: true, AgentID: agent.ID, Role: agent.Role}
			return h, nil
		case "R":
			if h.pane.Mode != ModeAgentDetail || h.pane.AgentID == "" {
				return h, nil
			}
			agent, ok := findAgent(h.state.Agents, h.pane.AgentID)
			if !ok {
				return h, nil
			}
			la := toLocalAgent(agent, worktreeForAgent(h.state, agent))
			if ok, reason := resumable(la, diskExists); !ok {
				h.ttyBuffer = "[resume not available: " + reason + "]"
				return h, nil
			}
			return h, h.startResume(agent.ID)
		}
	case runStateMsg:
		h.err = msg.err
		if msg.err == nil {
			h.state = msg.state
			if !h.iterationOverride {
				h.displayedIter = ClampIteration(msg.state.Plan.CurrentIteration, planMax(msg.state.Plan))
				if h.displayedIter == 0 {
					h.displayedIter = 1
				}
			}
			if h.cursor >= len(h.visibleAgents()) {
				h.cursor = max(0, len(h.visibleAgents())-1)
			}
			h.pane = focusForCursor(h.pane, h.visibleAgents(), h.cursor)
		}
	case eventMsg:
		event := client.TaggedEvent(msg)
		h.activityBuffer = append(h.activityBuffer, event)
		if len(h.activityBuffer) > maxActivityBuffer {
			h.activityBuffer = h.activityBuffer[len(h.activityBuffer)-maxActivityBuffer:]
		}
		h.toasts = applyAskEvent(h.toasts, event, time.Now())
		if isStructural(event.Type()) {
			return h, tea.Batch(h.fetchRunState(), waitEvent(h.events))
		}
		return h, waitEvent(h.events)
	case chatSendMsg:
		if msg.err != nil {
			h.chat.Error = msg.err.Error()
			return h, nil
		}
		h.chat = h.chat.Reset()
		return h, nil
	case resumeMsg:
		if msg.err != nil {
			h.ttyBuffer = "[resume failed: " + msg.err.Error() + "]"
			return h, nil
		}
		if next, err := h.pane.AttachResumed(msg.agentID); err == nil {
			h.pane = next
		}
		h.ttyBuffer = ""
		return h, tea.Batch(h.startTTY(msg.agentID), waitTTY(h.ttyEvents))
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
	header := renderHeader(h.state, h.displayedIter, width)
	footer := h.footerForMode()
	if pending := h.toasts.PendingDigest(); pending > 0 {
		footer = muted.Render(footerDigest(pending)) + "  " + footer
	}
	overlay := renderChatOverlay(h.chat, width)
	visibleToasts := h.toasts.Visible(time.Now(), defaultToastTimeout)
	toastBlock := renderToasts(visibleToasts, width)

	filteredState := h.filteredState()
	visibleAgents := h.visibleAgents()
	contentHeight := max(1, height-2) // -1 for header, -1 for footer
	if overlay != "" {
		contentHeight = max(1, contentHeight-3)
	}
	listState := filteredState
	listState.Agents = visibleAgents
	var main string
	if width >= 80 {
		left := max(28, width*35/100)
		right := max(20, width-left)
		main = lipgloss.JoinHorizontal(
			lipgloss.Top,
			renderList(listState, h.cursor, h.listOffset, left, contentHeight),
			h.renderRightPane(right, contentHeight),
		)
	} else {
		top := max(8, contentHeight/2)
		main = lipgloss.JoinVertical(
			lipgloss.Left,
			renderList(listState, h.cursor, h.listOffset, width, top),
			h.renderRightPane(width, contentHeight-top),
		)
	}
	parts := []string{header, main}
	if toastBlock != "" {
		parts = append(parts, toastBlock)
	}
	if overlay != "" {
		parts = append(parts, overlay)
	}
	parts = append(parts, footer)
	return strings.Join(parts, "\n")
}

// filteredState returns a copy of state with Tasks filtered to the
// displayed iteration. Agents are filtered separately via visibleAgents().
func (h Home) filteredState() client.RunState {
	s := h.state
	s.Tasks = FilterTasksByIteration(h.state.Tasks, h.displayedIter)
	return s
}

// listStateFiltered returns a state copy with Tasks+Agents filtered.
func (h Home) listStateFiltered() client.RunState {
	s := h.filteredState()
	s.Agents = h.visibleAgents()
	return s
}

func (h Home) visibleAgents() []client.Agent {
	tasks := FilterTasksByIteration(h.state.Tasks, h.displayedIter)
	inIter := make(map[string]bool, len(tasks))
	for _, t := range tasks {
		inIter[t.ID] = true
	}
	return FilterAgentsForIteration(h.state.Agents, func(id string) bool { return inIter[id] }, h.pinnedAgents)
}

func footerDigest(n int) string {
	if n == 1 {
		return "1 ask pending"
	}
	return fmt.Sprintf("%d asks pending", n)
}

func agentIndex(agents []client.Agent, id string) int {
	for i, a := range agents {
		if a.ID == id {
			return i
		}
	}
	return -1
}

// applyAskEvent updates the toast queue based on a streamed event. New asks
// are added with the receipt time; answered/timed-out asks are resolved.
func applyAskEvent(q ToastQueue, e client.TaggedEvent, now time.Time) ToastQueue {
	switch e.Type() {
	case "ask_user":
		var payload struct {
			AskID    string `json:"askId"`
			From     string `json:"fromAgent"`
			Question string `json:"question"`
		}
		if err := json.Unmarshal(e.Payload, &payload); err != nil {
			return q
		}
		role := ""
		for _, tag := range e.Tags {
			if strings.HasPrefix(tag, "role:") {
				role = strings.TrimPrefix(tag, "role:")
			}
		}
		return q.Add(AskToast{AskID: payload.AskID, AgentID: payload.From, Role: role, Question: payload.Question, CreatedAt: now})
	case "ask_user_answered", "ask_timed_out":
		var payload struct {
			AskID string `json:"askId"`
		}
		if err := json.Unmarshal(e.Payload, &payload); err != nil {
			return q
		}
		return q.Resolve(payload.AskID)
	}
	return q
}

func (h Home) footerForMode() string {
	switch h.pane.Mode {
	case ModeLivePTY, ModeResumedPTY:
		return muted.Render("typing → PTY  esc detach  ctrl+c quit")
	case ModeReplayPTY:
		return muted.Render("read-only replay  esc back  q quit")
	case ModeAgentDetail:
		if a, ok := findAgent(h.state.Agents, h.pane.AgentID); ok {
			la := toLocalAgent(a, worktreeForAgent(h.state, a))
			if ok, reason := resumable(la, diskExists); ok {
				return muted.Render("enter attach  R resume  esc back  r refresh  q quit")
			} else if reason != "" {
				return muted.Render("enter attach  esc back  R disabled — " + reason + "  r refresh  q quit")
			}
		}
		return muted.Render("enter attach  esc back  r refresh  q quit")
	default:
		return muted.Render("[enter] open agent  [/] chat  [,.] iter  [p] pin  [q] quit")
	}
}

// renderRightPane dispatches based on the current pane mode.
func (h Home) renderRightPane(width, height int) string {
	switch h.pane.Mode {
	case ModeLivePTY:
		return renderLivePTY(h.pane.AgentID, h.ttyBuffer, width, height)
	case ModeReplayPTY:
		return renderReplayPTY(h.pane.AgentID, h.ttyBuffer, width, height)
	case ModeResumedPTY:
		return renderResumedPTY(h.pane.AgentID, h.ttyBuffer, width, height)
	case ModeAgentDetail:
		if h.pane.AgentID == "" {
			break
		}
		if a, ok := findAgent(h.state.Agents, h.pane.AgentID); ok {
			return renderAgentDetail(a, worktreeForAgent(h.state, a), width, height)
		}
	}
	sel := Selection{Kind: SelectionNone}
	out, _ := renderActivity(h.activityBuffer, sel, h.displayedIter, h.activityOffset, width, height)
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

func (h Home) sendChat(agentID, text string) tea.Cmd {
	return func() tea.Msg {
		err := h.api.PostAgentInput(agentID, text)
		return chatSendMsg{agentID: agentID, err: err}
	}
}

func (h Home) startResume(agentID string) tea.Cmd {
	return func() tea.Msg {
		_, err := h.api.PostAgentResume(agentID)
		return resumeMsg{agentID: agentID, err: err}
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
