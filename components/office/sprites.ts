// Sprite grid, palette, and per-role identity — ported from
// orquesta-lite/internal/web/static/gameboard.js (this.SPR, this.ROLE_META).

export interface RoleIdentity {
  label: string
  color: string
  skin: string
  hair: string
  desc: string
}

// gameboard.js: this.SPR — 15-row x 12-col ASCII pixel map.
export const SPR: readonly string[] = [
  "....kkkk....",
  "...khhhhk...",
  "..khhhhhhk..",
  "..khsssshk..",
  "..ksessesk..",
  "..kssssssk..",
  "..kssSSssk..",
  "....kssk....",
  ".kttttttttk.",
  ".kttttttttk.",
  ".ktTTTTTTtk.",
  ".ksttttttsk.",
  ".kppppppppk.",
  "..kpp..ppk..",
  "..kkk..kkk..",
]

function darken(hex: string, amount: number): string {
  const n = Number.parseInt(hex.slice(1), 16)
  const r = Math.max(0, Math.round(((n >> 16) & 0xff) * (1 - amount)))
  const g = Math.max(0, Math.round(((n >> 8) & 0xff) * (1 - amount)))
  const b = Math.max(0, Math.round((n & 0xff) * (1 - amount)))
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`
}

export const SPR_COLS = SPR[0]?.length ?? 12
export const SPR_ROWS = SPR.length

/**
 * Render SPR as a single-div box-shadow sprite (gameboard.js:319-332): every
 * non-transparent pixel becomes one `<offset-x> <offset-y> 0 0 <color>` shadow
 * entry at `scale` px per pixel, avoiding a 180-node-per-sprite DOM cost.
 */
export function spriteBoxShadow(identity: RoleIdentity, scale: number): string {
  const shadows: string[] = []
  SPR.forEach((row, r) => {
    for (let c = 0; c < row.length; c += 1) {
      const color = pixelColor(row[c], identity)
      if (!color) continue
      shadows.push(`${c * scale}px ${r * scale}px 0 0 ${color}`)
    }
  })
  return shadows.join(", ")
}

/** Map one SPR symbol to a CSS color for a given role palette, or null if transparent. */
export function pixelColor(symbol: string, identity: RoleIdentity): string | null {
  switch (symbol) {
    case ".":
      return null
    case "k":
      return "#221830"
    case "h":
      return identity.hair
    case "s":
      return identity.skin
    case "S":
      return darken(identity.skin, 0.14)
    case "e":
      return "#1c1330"
    case "t":
      return identity.color
    case "T":
      return darken(identity.color, 0.22)
    case "p":
      return "#2b2742"
    default:
      return null
  }
}

// gameboard.js: this.ROLE_META (colors/skin/hair) merged with descriptive
// blurbs already used elsewhere in the console (lib/mock-data.ts ROLES).
const KNOWN_IDENTITY: Record<string, RoleIdentity> = {
  planner: {
    label: "PLANNER",
    color: "#b07cff",
    skin: "#f1c9a5",
    hair: "#3a2d4a",
    desc: "Breaks the goal into ordered, testable tasks.",
  },
  parser: {
    label: "PARSER",
    color: "#5b9cff",
    skin: "#e8b48c",
    hair: "#241a2a",
    desc: "Turns the plan into structured tasks.",
  },
  coder: {
    label: "CODER",
    color: "#46d39a",
    skin: "#f1c9a5",
    hair: "#6b4a2a",
    desc: "Implements each task in the workspace.",
  },
  tester: {
    label: "TESTER",
    color: "#ffc24b",
    skin: "#d99b6c",
    hair: "#1e1726",
    desc: "Runs the suite and verifies claims.",
  },
  critic: {
    label: "CRITIC",
    color: "#ff6b8a",
    skin: "#f1c9a5",
    hair: "#8a3b3b",
    desc: "Reviews diffs for risk and quality.",
  },
  reviewer: {
    label: "REVIEWER",
    color: "#38d6d6",
    skin: "#e8b48c",
    hair: "#241a2a",
    desc: "Approves and commits successful tasks.",
  },
  verifier: {
    label: "VERIFIER",
    color: "#ff924b",
    skin: "#c98a5e",
    hair: "#1e1726",
    desc: "Confirms the fix actually resolves the issue.",
  },
  orchestrator: {
    label: "ORCHESTRATOR",
    color: "#ffd84b",
    skin: "#f1c9a5",
    hair: "#caa23a",
    desc: "Coordinates the run end to end.",
  },
}

// 12-color palette for custom roles, at roughly the same lightness as the
// known role colors above (chosen for contrast against the office's dark
// background, #15102b).
const CUSTOM_PALETTE = [
  "#b07cff",
  "#5b9cff",
  "#46d39a",
  "#ffc24b",
  "#ff6b8a",
  "#38d6d6",
  "#ff924b",
  "#ffd84b",
  "#7dd3fc",
  "#fca5f1",
  "#a3e635",
  "#f97316",
]
const CUSTOM_SKINS = ["#f1c9a5", "#e8b48c", "#d99b6c", "#c98a5e"]
const CUSTOM_HAIRS = ["#3a2d4a", "#241a2a", "#6b4a2a", "#8a3b3b", "#1e1726", "#caa23a"]

function hashString(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (Math.imul(hash, 31) + value.charCodeAt(i)) >>> 0
  }
  return hash
}

/** Return the visual identity for a role: exact for the 8 known roles, deterministic for custom ones. */
export function roleIdentity(role: string): RoleIdentity {
  const known = KNOWN_IDENTITY[role.toLowerCase()]
  if (known) return known

  const hash = hashString(role.toLowerCase())
  return {
    label: role.toUpperCase(),
    color: CUSTOM_PALETTE[hash % CUSTOM_PALETTE.length],
    skin: CUSTOM_SKINS[Math.floor(hash / CUSTOM_PALETTE.length) % CUSTOM_SKINS.length],
    hair: CUSTOM_HAIRS[
      Math.floor(hash / (CUSTOM_PALETTE.length * CUSTOM_SKINS.length)) % CUSTOM_HAIRS.length
    ],
    desc: "Custom role from team.json",
  }
}
