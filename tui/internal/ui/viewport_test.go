package ui

import (
	"reflect"
	"testing"
)

func TestViewport_ShortContent_NoScroll(t *testing.T) {
	content := []string{"a", "b", "c"}
	v := Viewport{Cursor: 1, Offset: 0}
	visible, row := v.Slice(content, 10)
	if !reflect.DeepEqual(visible, content) {
		t.Fatalf("expected full content %v, got %v", content, visible)
	}
	if row != 1 {
		t.Fatalf("expected cursorRow=1, got %d", row)
	}
}

func TestViewport_MoveDown_ScrollsToKeepCursorVisible(t *testing.T) {
	content := mkRows(20)
	v := Viewport{Cursor: 0, Offset: 0}
	height := 5
	for i := 0; i < 7; i++ {
		v = v.Move(1, len(content), height)
	}
	if v.Cursor != 7 {
		t.Fatalf("cursor=7 expected, got %d", v.Cursor)
	}
	visible, row := v.Slice(content, height)
	if len(visible) != height {
		t.Fatalf("expected window of %d rows, got %d", height, len(visible))
	}
	if row < 0 || row >= height {
		t.Fatalf("cursorRow %d not in [0,%d)", row, height)
	}
	if visible[row] != content[7] {
		t.Fatalf("cursor row content %q != content[7] %q", visible[row], content[7])
	}
}

func TestViewport_Move_ClampsAtBounds(t *testing.T) {
	content := mkRows(10)
	v := Viewport{}
	v = v.Move(-5, len(content), 4)
	if v.Cursor != 0 {
		t.Fatalf("cursor should clamp to 0, got %d", v.Cursor)
	}
	if v.Offset != 0 {
		t.Fatalf("offset should be 0 at top, got %d", v.Offset)
	}
	v = v.Move(99, len(content), 4)
	if v.Cursor != 9 {
		t.Fatalf("cursor should clamp to last index, got %d", v.Cursor)
	}
	if v.Offset != 6 {
		t.Fatalf("offset should be n-height (6), got %d", v.Offset)
	}
}

func TestViewport_PageDownPageUp(t *testing.T) {
	content := mkRows(20)
	height := 5
	v := Viewport{}
	v = v.PageDown(len(content), height)
	if v.Cursor != 5 {
		t.Fatalf("after PageDown, cursor=5 expected, got %d", v.Cursor)
	}
	v = v.PageDown(len(content), height)
	if v.Cursor != 10 {
		t.Fatalf("after 2x PageDown, cursor=10 expected, got %d", v.Cursor)
	}
	v = v.PageUp(len(content), height)
	if v.Cursor != 5 {
		t.Fatalf("after PageUp, cursor=5 expected, got %d", v.Cursor)
	}
}

func TestViewport_TopBottom(t *testing.T) {
	content := mkRows(20)
	height := 5
	v := Viewport{Cursor: 7, Offset: 4}
	v = v.Top()
	if v.Cursor != 0 || v.Offset != 0 {
		t.Fatalf("Top should reset to 0,0 — got cursor=%d offset=%d", v.Cursor, v.Offset)
	}
	v = v.Bottom(len(content), height)
	if v.Cursor != 19 {
		t.Fatalf("Bottom cursor=19 expected, got %d", v.Cursor)
	}
	if v.Offset != 15 {
		t.Fatalf("Bottom offset=15 (n-height) expected, got %d", v.Offset)
	}
}

func TestViewport_NeverScrollsPastContent(t *testing.T) {
	content := mkRows(8)
	height := 5
	v := Viewport{Cursor: 0, Offset: 99}
	visible, _ := v.Slice(content, height)
	if len(visible) != height {
		t.Fatalf("visible length must be height, got %d", len(visible))
	}
	last := visible[len(visible)-1]
	if last != content[len(content)-1] {
		t.Fatalf("last visible row should be last content row when offset overshoots; got %q want %q", last, content[len(content)-1])
	}
}

func mkRows(n int) []string {
	out := make([]string, n)
	for i := range out {
		out[i] = string(rune('a' + i))
	}
	return out
}
