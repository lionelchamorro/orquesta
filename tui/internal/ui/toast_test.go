package ui

import (
	"testing"
	"time"
)

func TestToastQueue_Add_DedupsByAskID(t *testing.T) {
	q := ToastQueue{}
	q = q.Add(AskToast{AskID: "ask-1", AgentID: "a"})
	q = q.Add(AskToast{AskID: "ask-1", AgentID: "a"})
	if len(q.Asks) != 1 {
		t.Fatalf("expected 1 ask after dedup, got %d", len(q.Asks))
	}
}

func TestToastQueue_VisibleHidesTimedOut(t *testing.T) {
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	q := ToastQueue{Asks: []AskToast{
		{AskID: "ask-old", CreatedAt: now.Add(-60 * time.Second)},
		{AskID: "ask-fresh", CreatedAt: now.Add(-5 * time.Second)},
	}}
	visible := q.Visible(now, 30*time.Second)
	if len(visible) != 1 || visible[0].AskID != "ask-fresh" {
		t.Fatalf("expected only ask-fresh visible, got %+v", visible)
	}
}

func TestToastQueue_DismissHidesButRetainsForDigest(t *testing.T) {
	now := time.Now()
	q := ToastQueue{Asks: []AskToast{{AskID: "ask-1", CreatedAt: now}}}
	q = q.Dismiss("ask-1")
	if len(q.Visible(now, 30*time.Second)) != 0 {
		t.Fatalf("dismissed ask should not be visible")
	}
	if q.PendingDigest() != 1 {
		t.Fatalf("dismissed ask should still count toward digest, got %d", q.PendingDigest())
	}
}

func TestToastQueue_Resolve_RemovesEntirely(t *testing.T) {
	q := ToastQueue{Asks: []AskToast{{AskID: "ask-1"}}}
	q = q.Resolve("ask-1")
	if len(q.Asks) != 0 {
		t.Fatalf("resolved ask should leave queue, got %d", len(q.Asks))
	}
}

func TestToastQueue_Latest_OldestFirstNewestLast(t *testing.T) {
	now := time.Now()
	q := ToastQueue{Asks: []AskToast{
		{AskID: "ask-1", CreatedAt: now.Add(-5 * time.Second)},
		{AskID: "ask-2", CreatedAt: now.Add(-1 * time.Second)},
	}}
	latest, ok := q.Latest(now, 30*time.Second)
	if !ok || latest.AskID != "ask-2" {
		t.Fatalf("expected latest=ask-2, got %v ok=%v", latest, ok)
	}
}
