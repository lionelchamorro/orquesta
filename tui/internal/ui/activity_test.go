package ui

import (
	"encoding/json"
	"testing"

	"github.com/lionelchamorro/orquesta/tui/internal/client"
)

func mkEvent(t *testing.T, payloadType string, tags ...string) client.TaggedEvent {
	t.Helper()
	raw, err := json.Marshal(map[string]string{"type": payloadType})
	if err != nil {
		t.Fatal(err)
	}
	return client.TaggedEvent{ID: payloadType, TS: "2026-01-01T00:00:00Z", Tags: tags, Payload: raw}
}

func TestSelection_TaskFilters_OnlyMatchTaskTag(t *testing.T) {
	sel := Selection{Kind: SelectionTask, ID: "task-1"}
	predicate := selectionFilter(sel, 1)
	if !predicate(mkEvent(t, "task_started", "task-1")) {
		t.Fatalf("expected task-1 event to match")
	}
	if predicate(mkEvent(t, "task_started", "task-2")) {
		t.Fatalf("task-2 event should not match task-1 selection")
	}
}

func TestSelection_AgentFilters_OnlyMatchAgentTag(t *testing.T) {
	sel := Selection{Kind: SelectionAgent, ID: "agent-99"}
	predicate := selectionFilter(sel, 1)
	if !predicate(mkEvent(t, "activity", "agent-99")) {
		t.Fatalf("agent-99 event should match")
	}
	if predicate(mkEvent(t, "activity", "agent-7")) {
		t.Fatalf("agent-7 event should not match")
	}
}

func TestSelection_None_FiltersByIteration(t *testing.T) {
	sel := Selection{Kind: SelectionNone}
	predicate := selectionFilter(sel, 2)
	if !predicate(mkEvent(t, "task_started", "iter-2")) {
		t.Fatalf("iter-2 event should match SelectionNone with iter 2")
	}
	if predicate(mkEvent(t, "task_started", "iter-1")) {
		t.Fatalf("iter-1 event should not match iter-2 filter")
	}
}

func TestSelection_None_AcceptsUntaggedRunEvents(t *testing.T) {
	sel := Selection{Kind: SelectionNone}
	predicate := selectionFilter(sel, 1)
	if !predicate(mkEvent(t, "run_completed", "run-abc")) {
		t.Fatalf("run-level event should match when no iteration tag is present")
	}
}
