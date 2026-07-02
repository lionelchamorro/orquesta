// Desk positions for the per-project virtual office. The 7 known pipeline
// roles + the orchestrator hub reuse the exact coordinates from
// orquesta-lite/internal/web/static/gameboard.js:58-67 (this.LAYOUT). Custom
// roles from a project's team.json (roles outside that fixed set) are placed
// on a ring around the hub instead, since the original gameboard hardcoded
// exactly 8 roles and orquesta's roster is dynamic.

export interface Desk {
  role: string
  x: number
  y: number
  hub: boolean
}

const HUB_ROLE = "orchestrator"

// gameboard.js:58-67 — top-left corner of each desk cell.
const KNOWN_POSITIONS: Record<string, { x: number; y: number }> = {
  planner: { x: 66, y: 64 },
  parser: { x: 410, y: 48 },
  coder: { x: 754, y: 64 },
  tester: { x: 790, y: 248 },
  critic: { x: 754, y: 438 },
  reviewer: { x: 410, y: 470 },
  verifier: { x: 66, y: 438 },
}

const HUB_POSITION = { x: 410, y: 248 }

// Ring layout for roles outside the known set — centered on the hub.
const RING_CENTER_X = 470
const RING_CENTER_Y = 310
const RING_RADIUS_X = 390
const RING_RADIUS_Y = 240
const MIN_CENTER_DISTANCE = 130

function ringPoint(index: number, total: number, growth: number): { x: number; y: number } {
  const angle = -Math.PI / 2 + (2 * Math.PI * index) / total
  return {
    x: Math.round(RING_CENTER_X + RING_RADIUS_X * growth * Math.cos(angle) - 60),
    y: Math.round(RING_CENTER_Y + RING_RADIUS_Y * growth * Math.sin(angle) - 72),
  }
}

/**
 * Growth factor applied to both ellipse radii so that adjacent ring points
 * stay >= MIN_CENTER_DISTANCE apart. The tightest spacing around an ellipse
 * occurs at its minor-axis vertices, where the parametric speed is
 * min(rx, ry); scaling both radii by the same factor scales that minimum
 * speed (and therefore the worst-case adjacent-point spacing) linearly, so a
 * single closed-form factor is enough — no iterative collision search needed.
 */
function ringGrowthFor(total: number): number {
  if (total <= 1) return 1
  const angleStep = (2 * Math.PI) / total
  const minSemiAxis = Math.min(RING_RADIUS_X, RING_RADIUS_Y)
  const required = (MIN_CENTER_DISTANCE * 1.15) / (minSemiAxis * angleStep)
  return Math.max(1, required)
}

/**
 * Compute desk positions for a set of role names. The hub (orchestrator) is
 * always included and centered, regardless of whether "orchestrator" appears
 * in `roles` (it is a control-plane concept, not a team.json role).
 */
export function layoutDesks(roles: string[]): Desk[] {
  const uniqueRoles = [...new Set(roles)].filter((role) => role.toLowerCase() !== HUB_ROLE)
  const desks: Desk[] = [{ role: HUB_ROLE, x: HUB_POSITION.x, y: HUB_POSITION.y, hub: true }]

  const known = uniqueRoles.filter((role) => KNOWN_POSITIONS[role.toLowerCase()])
  const extras = uniqueRoles.filter((role) => !KNOWN_POSITIONS[role.toLowerCase()])

  for (const role of known) {
    const position = KNOWN_POSITIONS[role.toLowerCase()]
    desks.push({ role, x: position.x, y: position.y, hub: false })
  }

  const growth = ringGrowthFor(extras.length)
  extras.forEach((role, index) => {
    const point = ringPoint(index, extras.length, growth)
    desks.push({ role, x: point.x, y: point.y, hub: false })
  })

  return desks
}
