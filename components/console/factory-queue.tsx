"use client"

import { useState } from "react"
import { GitBranch, ExternalLink, Plus, X } from "lucide-react"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { submitAddFeature } from "@/lib/add-feature"
import { fetchJSON } from "@/lib/fetch-json"
import type { Feature } from "@/lib/types"

interface FeaturesResponse {
  features: Feature[]
}

// ---------------------------------------------------------------------------
// AddFeatureComposer — inline form for title + description
// ---------------------------------------------------------------------------

interface AddFeatureComposerProps {
  projectId: string
  onSuccess: () => void
}

function AddFeatureComposer({ projectId, onSuccess }: AddFeatureComposerProps) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  function reset() {
    setTitle("")
    setDescription("")
    setError("")
    setOpen(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) {
      setError("Title is required.")
      return
    }
    setSubmitting(true)
    setError("")
    const result = await submitAddFeature(projectId, title.trim(), description.trim())
    setSubmitting(false)
    if (result.error !== null) {
      setError(result.error)
      return
    }
    reset()
    onSuccess()
  }

  if (!open) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="font-mono text-xs"
        onClick={() => setOpen(true)}
      >
        <Plus className="h-3.5 w-3.5" />
        Add feature
      </Button>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-border bg-card p-4"
      aria-label="Add feature form"
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-xs font-medium text-foreground">New feature</span>
        <button
          type="button"
          onClick={reset}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Cancel"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mb-2">
        <label className="mb-1 block font-mono text-[11px] text-muted-foreground" htmlFor="feature-title">
          Title
        </label>
        <input
          id="feature-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Add pagination to the tasks table"
          className="w-full rounded-lg border border-border bg-background px-3 py-1.5 font-mono text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary"
          disabled={submitting}
          autoFocus
        />
      </div>
      <div className="mb-3">
        <label
          className="mb-1 block font-mono text-[11px] text-muted-foreground"
          htmlFor="feature-description"
        >
          Description (optional)
        </label>
        <textarea
          id="feature-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Acceptance criteria, context, or implementation hints…"
          rows={3}
          className="w-full resize-none rounded-lg border border-border bg-background px-3 py-1.5 font-mono text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary"
          disabled={submitting}
        />
      </div>
      {error && (
        <p className="mb-2 font-mono text-[11px] text-err" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="outline" className="font-mono text-xs" onClick={reset}>
          Cancel
        </Button>
        <Button type="submit" size="sm" className="font-mono text-xs" disabled={submitting}>
          {submitting ? "Adding…" : "Add feature"}
        </Button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// FactoryQueue — feature list + Add feature affordance
// ---------------------------------------------------------------------------

interface FactoryQueueProps {
  projectId: string
  initialFeatures: Feature[]
}

export function FactoryQueue({ projectId, initialFeatures }: FactoryQueueProps) {
  const [features, setFeatures] = useState<Feature[]>(initialFeatures)

  async function refresh() {
    const data = await fetchJSON<FeaturesResponse>(
      `/api/control-plane/projects/${projectId}/factory`,
    )
    if (data?.features) {
      setFeatures(data.features)
    }
  }

  if (features.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-6 text-center">
        <p className="font-mono text-sm text-muted-foreground">
          Factory queue is empty. Add a feature below or ask the project chat to add one.
        </p>
        <AddFeatureComposer projectId={projectId} onSuccess={refresh} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {features.map((f) => (
        <div key={f.id} className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{f.id}</span>
                <StatusBadge status={f.status} />
              </div>
              <p className="mt-1.5 text-sm font-medium">{f.title}</p>
            </div>
            {f.pr_url && (
              <a
                href={f.pr_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex shrink-0 items-center gap-1 font-mono text-[11px] text-primary hover:underline"
              >
                PR <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4 font-mono text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <GitBranch className="h-3 w-3" />
              {f.branch}
            </span>
            <span className="text-ok">{f.tasks_done} done</span>
            {f.tasks_failed > 0 && <span className="text-err">{f.tasks_failed} failed</span>}
            {f.cost_usd > 0 && <span className="text-warn">${f.cost_usd.toFixed(2)}</span>}
          </div>
        </div>
      ))}
      <AddFeatureComposer projectId={projectId} onSuccess={refresh} />
    </div>
  )
}
