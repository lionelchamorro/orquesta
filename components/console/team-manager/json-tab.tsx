"use client"

import { Braces, Copy } from "lucide-react"
import { useMemo } from "react"
import { Button } from "@/components/ui/button"
import type { TeamDefinition } from "@/lib/types"
import { teamExport } from "./utils"

interface JsonTabProps {
  team: TeamDefinition
}

export function JsonTab({ team }: JsonTabProps) {
  const json = useMemo(() => JSON.stringify(teamExport(team), null, 2), [team])

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="inline-flex items-center gap-2 font-mono text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <Braces className="h-4 w-4" />
          team.json
        </h2>
        <Button
          size="sm"
          variant="ghost"
          className="font-mono text-xs"
          onClick={() => navigator.clipboard?.writeText(json)}
        >
          <Copy />
          Copy
        </Button>
      </div>
      <pre className="max-h-[70vh] overflow-auto rounded-lg border border-border bg-background p-4 font-mono text-xs leading-relaxed text-muted-foreground">
        {json}
      </pre>
    </div>
  )
}
