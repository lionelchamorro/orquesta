"use client"

import { cn } from "@/lib/utils"
import type { Desk } from "./layout"
import { roleIdentity, spriteBoxShadow, SPR_COLS, SPR_ROWS } from "./sprites"
import type { DeskStatus } from "./status"

// Reference canvas size from the original gameboard (gameboard.js: this.W/H);
// desks are positioned as percentages of this so the stage scales responsively
// instead of the original's fixed-pixel canvas.
const STAGE_W = 940
const STAGE_H = 620

const STATUS_COLOR: Record<DeskStatus, string> = {
  working: "#46d39a",
  done: "#5b9cff",
  failed: "#ff6b8a",
  waiting: "#ffc24b",
  idle: "#6c63a0",
  coord: "#ffd84b",
}

const STATUS_LABEL: Record<DeskStatus, string> = {
  working: "working",
  done: "done",
  failed: "failed",
  waiting: "waiting",
  idle: "idle",
  coord: "coordinating",
}

function DeskButton({
  desk,
  status,
  selected,
  onSelect,
}: {
  desk: Desk
  status: DeskStatus
  selected: boolean
  onSelect: () => void
}) {
  const identity = roleIdentity(desk.role)
  const scale = desk.hub ? 5 : 4
  const cellW = desk.hub ? 124 : 120
  const cellH = desk.hub ? 150 : 128

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`${identity.label} — ${STATUS_LABEL[status]}`}
      aria-pressed={selected}
      style={{
        left: `${(desk.x / STAGE_W) * 100}%`,
        top: `${(desk.y / STAGE_H) * 100}%`,
        width: cellW,
        height: cellH,
      }}
      className={cn(
        "absolute flex flex-col items-center justify-end gap-2 rounded-lg border p-2 transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        selected ? "border-primary bg-primary/10" : "border-white/10 bg-black/20 hover:bg-black/30",
      )}
    >
      <span
        className="shrink-0"
        style={{
          width: SPR_COLS * scale,
          height: SPR_ROWS * scale,
          boxShadow: spriteBoxShadow(identity, scale),
        }}
      />
      <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-white/80">
        <span
          className={cn("h-1.5 w-1.5 rounded-full", status === "working" && "motion-safe:animate-pulse")}
          style={{ backgroundColor: STATUS_COLOR[status] }}
        />
        {identity.label}
      </span>
    </button>
  )
}

export function OfficeStage({
  desks,
  statuses,
  selectedRole,
  onSelect,
}: {
  desks: Desk[]
  statuses: Record<string, DeskStatus>
  selectedRole: string | null
  onSelect: (role: string) => void
}) {
  return (
    <div
      role="group"
      aria-label="Office desks — select a role to open its status panel"
      className="relative w-full overflow-hidden rounded-xl border border-white/10 bg-[#15102b]"
      style={{ aspectRatio: `${STAGE_W} / ${STAGE_H}` }}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(0,0,0,0.16) 0 1px, transparent 1px 3px)",
        }}
        aria-hidden
      />
      {desks.map((desk) => (
        <DeskButton
          key={desk.role}
          desk={desk}
          status={statuses[desk.role] ?? "idle"}
          selected={selectedRole === desk.role}
          onSelect={() => onSelect(desk.role)}
        />
      ))}
    </div>
  )
}
