package ui

// Viewport is a pure scroll model: it owns the cursor position and a top-of-window
// offset. All transitions return a new Viewport; there is no I/O.
type Viewport struct {
	Cursor int
	Offset int
}

// Slice returns the visible window of content and the row index (within that
// window) where the cursor sits. When content is shorter than height, the full
// content is returned with no scrolling.
func (v Viewport) Slice(content []string, height int) (visible []string, cursorRow int) {
	n := len(content)
	if height <= 0 || n == 0 {
		return nil, 0
	}
	if n <= height {
		return content, clamp(v.Cursor, 0, n-1)
	}
	off := v.Offset
	if off < 0 {
		off = 0
	}
	if off > n-height {
		off = n - height
	}
	return content[off : off+height], v.Cursor - off
}

// Move shifts the cursor by delta within content of length n, with the given
// pane height. The offset is adjusted to keep the cursor visible.
func (v Viewport) Move(delta, n, height int) Viewport {
	if n <= 0 || height <= 0 {
		return Viewport{}
	}
	v.Cursor = clamp(v.Cursor+delta, 0, n-1)
	if n <= height {
		v.Offset = 0
		return v
	}
	if v.Cursor < v.Offset {
		v.Offset = v.Cursor
	}
	if v.Cursor >= v.Offset+height {
		v.Offset = v.Cursor - height + 1
	}
	v.Offset = clamp(v.Offset, 0, n-height)
	return v
}

// PageDown moves the cursor forward by one page (height rows).
func (v Viewport) PageDown(n, height int) Viewport {
	return v.Move(height, n, height)
}

// PageUp moves the cursor backward by one page.
func (v Viewport) PageUp(n, height int) Viewport {
	return v.Move(-height, n, height)
}

// Top jumps to the first row.
func (v Viewport) Top() Viewport {
	return Viewport{Cursor: 0, Offset: 0}
}

// Bottom jumps to the last row.
func (v Viewport) Bottom(n, height int) Viewport {
	if n <= 0 {
		return Viewport{}
	}
	return Viewport{Cursor: n - 1}.Move(0, n, height)
}

func clamp(x, lo, hi int) int {
	if x < lo {
		return lo
	}
	if x > hi {
		return hi
	}
	return x
}
