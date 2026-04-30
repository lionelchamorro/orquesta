package ui

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/lionelchamorro/orquesta/tui/internal/client"
)

func TestFilterTasksByIteration_KeepsOnlyMatching(t *testing.T) {
	tasks := []client.Task{
		{ID: "task-1", Iteration: 1},
		{ID: "task-2", Iteration: 2},
		{ID: "task-3", Iteration: 1},
	}
	got := FilterTasksByIteration(tasks, 1)
	want := []string{"task-1", "task-3"}
	gotIDs := make([]string, len(got))
	for i, t := range got {
		gotIDs[i] = t.ID
	}
	if !reflect.DeepEqual(gotIDs, want) {
		t.Fatalf("expected %v, got %v", want, gotIDs)
	}
}

func TestFilterEventsByIteration_KeepsIterTagged(t *testing.T) {
	mk := func(typ string, tags ...string) client.TaggedEvent {
		raw, _ := json.Marshal(map[string]string{"type": typ})
		return client.TaggedEvent{Tags: tags, Payload: raw}
	}
	events := []client.TaggedEvent{
		mk("task_started", "iter-1"),
		mk("task_started", "iter-2"),
		mk("run_completed"),
	}
	got := FilterEventsByIteration(events, 1)
	if len(got) != 2 {
		t.Fatalf("expected 2 events (iter-1 + run-level), got %d", len(got))
	}
}

func TestClampIteration(t *testing.T) {
	if got := ClampIteration(0, 3); got != 1 {
		t.Fatalf("expected clamp to 1, got %d", got)
	}
	if got := ClampIteration(99, 3); got != 3 {
		t.Fatalf("expected clamp to 3, got %d", got)
	}
	if got := ClampIteration(2, 3); got != 2 {
		t.Fatalf("expected pass-through 2, got %d", got)
	}
}

func TestFilterAgentsForIteration_KeepsPinnedAcrossIterations(t *testing.T) {
	agents := []client.Agent{
		{ID: "a-1", BoundTask: "task-1"},
		{ID: "a-2", BoundTask: "task-2"},
		{ID: "a-3", BoundTask: ""},
	}
	inIter := func(taskID string) bool { return taskID == "task-1" }
	pinned := map[string]bool{"a-2": true}
	got := FilterAgentsForIteration(agents, inIter, pinned)
	ids := make([]string, len(got))
	for i, a := range got {
		ids[i] = a.ID
	}
	if !reflect.DeepEqual(ids, []string{"a-1", "a-2", "a-3"}) {
		t.Fatalf("expected a-1+a-2(pinned)+a-3(unbound), got %v", ids)
	}
}
