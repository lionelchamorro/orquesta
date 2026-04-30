package ui

import (
	"strings"
	"time"

	"github.com/charmbracelet/lipgloss"
)

// AskToast represents one ephemeral notification for a pending agent ask.
type AskToast struct {
	AskID     string
	AgentID   string
	Role      string
	Question  string
	CreatedAt time.Time
	Dismissed bool
}

// ToastQueue is the pure model: an ordered list of asks (oldest first), plus
// a derived count of dismissed-but-still-pending asks for the footer digest.
type ToastQueue struct {
	Asks []AskToast
}

const defaultToastTimeout = 30 * time.Second

func (q ToastQueue) Add(t AskToast) ToastQueue {
	for _, existing := range q.Asks {
		if existing.AskID == t.AskID {
			return q
		}
	}
	return ToastQueue{Asks: append(q.Asks, t)}
}

// Visible returns the asks that should be shown right now (not dismissed
// and not timed out) given the current time and timeout.
func (q ToastQueue) Visible(now time.Time, timeout time.Duration) []AskToast {
	if timeout <= 0 {
		timeout = defaultToastTimeout
	}
	out := make([]AskToast, 0, len(q.Asks))
	for _, t := range q.Asks {
		if t.Dismissed {
			continue
		}
		if now.Sub(t.CreatedAt) >= timeout {
			continue
		}
		out = append(out, t)
	}
	return out
}

// Latest returns the most recent visible ask (or zero value when none).
func (q ToastQueue) Latest(now time.Time, timeout time.Duration) (AskToast, bool) {
	visible := q.Visible(now, timeout)
	if len(visible) == 0 {
		return AskToast{}, false
	}
	return visible[len(visible)-1], true
}

// Dismiss marks the latest visible ask as dismissed; the ask is preserved
// in the queue so PendingDigest can still count it.
func (q ToastQueue) Dismiss(askID string) ToastQueue {
	out := make([]AskToast, len(q.Asks))
	copy(out, q.Asks)
	for i := range out {
		if out[i].AskID == askID {
			out[i].Dismissed = true
		}
	}
	return ToastQueue{Asks: out}
}

// Resolve removes an ask from the queue (e.g., after the human answered or
// the daemon timed it out).
func (q ToastQueue) Resolve(askID string) ToastQueue {
	out := make([]AskToast, 0, len(q.Asks))
	for _, t := range q.Asks {
		if t.AskID != askID {
			out = append(out, t)
		}
	}
	return ToastQueue{Asks: out}
}

// PendingDigest counts asks that were dismissed but are still in the queue
// (i.e., the daemon hasn't told us they were answered yet) plus visible
// asks. Both contribute to the footer digest.
func (q ToastQueue) PendingDigest() int {
	count := 0
	for _, t := range q.Asks {
		if t.Dismissed {
			count++
		}
	}
	return count
}

func renderToasts(visible []AskToast, width int) string {
	if len(visible) == 0 {
		return ""
	}
	rows := make([]string, 0, len(visible))
	for _, t := range visible {
		head := title.Render("ask · " + t.AgentID + " · " + t.Role)
		question := t.Question
		if len(question) > 80 {
			question = question[:77] + "…"
		}
		hint := muted.Render("enter jump  esc dismiss")
		card := lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(lipgloss.Color("#d8a")).
			Width(max(40, width/3)).
			Padding(0, 1).
			Render(strings.Join([]string{head, question, hint}, "\n"))
		rows = append(rows, card)
	}
	return lipgloss.JoinVertical(lipgloss.Right, rows...)
}
