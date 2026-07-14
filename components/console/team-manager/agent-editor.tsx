"use client"

import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/status-badge"
import type { AgentDefinition, AgentProvider } from "@/lib/types"
import { buildAgentFieldId } from "./utils"

const PROVIDERS: AgentProvider[] = ["codex", "claude", "gemini", "opencode", "cmd"]

interface AgentEditorProps {
  agent: AgentDefinition
  onUpdate: (patch: Partial<AgentDefinition>) => void
  onDelete: () => void
}

export function AgentEditor({ agent, onUpdate, onDelete }: AgentEditorProps) {
  const fid = (field: string) => buildAgentFieldId(agent.id, field)

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-mono text-base font-semibold">{agent.id}</p>
          <StatusBadge status={agent.provider} />
        </div>
        <Button size="icon-xs" variant="ghost" title="Remove agent" onClick={onDelete}>
          <Trash2 />
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label
            htmlFor={fid("provider")}
            className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground"
          >
            Provider
          </label>
          <select
            id={fid("provider")}
            value={agent.provider}
            onChange={(e) => onUpdate({ provider: e.target.value as AgentProvider })}
            className="rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary/50"
          >
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor={fid("model")}
            className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground"
          >
            Model / command label
          </label>
          <input
            id={fid("model")}
            value={agent.model ?? ""}
            onChange={(e) => onUpdate({ model: e.target.value || undefined })}
            placeholder="e.g. claude-opus-4"
            className="rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary/50"
          />
        </div>
      </div>

      {agent.provider === "cmd" && (
        <div className="flex flex-col gap-1">
          <label
            htmlFor={fid("cmd")}
            className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground"
          >
            Command args (space-separated)
          </label>
          <input
            id={fid("cmd")}
            value={(agent.cmd ?? []).join(" ")}
            onChange={(e) =>
              onUpdate({
                cmd: e.target.value
                  .split(" ")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            placeholder="e.g. orq-lite run"
            className="rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary/50"
          />
        </div>
      )}
    </div>
  )
}
