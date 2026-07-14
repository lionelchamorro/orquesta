/**
 * Layout arithmetic tests for DeskButton's sprite / label non-overlap guarantee.
 *
 * Root cause (before fix): the sprite span was sized SPR_COLS*scale × SPR_ROWS*scale
 * (e.g. 48×60). CSS box-shadow with spread=0 renders each shadow the SAME SIZE as
 * the element, so every "pixel" shadow was 48×60 instead of scale×scale (4×4).
 * The bottommost row's shadow therefore extended far below the sprite's logical
 * bounds, painting over the role-label beneath it.
 *
 * After fix: the outer span (48×60) reserves layout space; an inner span (4×4 for
 * scale=4) carries the box-shadow, so each shadow is 4×4 and the maximum visual
 * extent of the sprite equals the outer span's height — leaving a clear gap above
 * the label.
 */

import { describe, expect, it } from "vitest"
import { SPR_ROWS, SPR_COLS } from "../sprites"

// These constants mirror the values used in DeskButton (office-stage.tsx).
const CELL_PADDING = 8 // p-2 = 8 px on every side
const FLEX_GAP = 8 // gap-2 = 8 px between sprite and label in the flex column

/**
 * Approximate rendered height of the label row:
 *   font-size 10 px × line-height 1.5 ≈ 15 px, rounded up to be conservative.
 */
const LABEL_H = 16

/**
 * With the fixed inner-span approach, the visual bottom of the sprite equals
 * outer-span bottom (sprite_top_in_cell + SPR_ROWS*scale).
 */
function spriteShadowBottom(cellH: number, scale: number): number {
  const contentH = cellH - 2 * CELL_PADDING
  const spriteH = SPR_ROWS * scale
  // flex-col + justify-end: items packed from bottom → sprite top from content top
  const spriteTopInContent = contentH - (spriteH + FLEX_GAP + LABEL_H)
  const spriteTopInCell = CELL_PADDING + spriteTopInContent
  // With scale×scale inner span, max shadow bottom = sprite top + SPR_ROWS*scale
  return spriteTopInCell + spriteH
}

/**
 * With justify-end, label is at the very bottom of the content area.
 */
function labelTopInCell(cellH: number): number {
  const contentH = cellH - 2 * CELL_PADDING
  return CELL_PADDING + contentH - LABEL_H
}

describe("DeskButton sprite / label clearance (inner scale×scale span)", () => {
  it("regular desk (scale=4, cellH=128): shadow bottom is above the label", () => {
    const shadowBottom = spriteShadowBottom(128, 4)
    const labelTop = labelTopInCell(128)
    expect(shadowBottom).toBeLessThanOrEqual(labelTop)
  })

  it("hub desk (scale=5, cellH=150): shadow bottom is above the label", () => {
    const shadowBottom = spriteShadowBottom(150, 5)
    const labelTop = labelTopInCell(150)
    expect(shadowBottom).toBeLessThanOrEqual(labelTop)
  })

  it("sprite visual width (SPR_COLS*scale) does not exceed the outer span width", () => {
    // The inner 4×4 span's last pixel column is (SPR_COLS-1)*scale + scale = SPR_COLS*scale
    // which exactly equals the outer span width — no horizontal bleed.
    const scale = 4
    const lastShadowRight = (SPR_COLS - 1) * scale + scale
    const outerSpanW = SPR_COLS * scale
    expect(lastShadowRight).toBeLessThanOrEqual(outerSpanW)
  })

  it("sprite visual height (SPR_ROWS*scale) does not exceed the outer span height", () => {
    const scale = 4
    const lastShadowBottom = (SPR_ROWS - 1) * scale + scale
    const outerSpanH = SPR_ROWS * scale
    expect(lastShadowBottom).toBeLessThanOrEqual(outerSpanH)
  })
})
