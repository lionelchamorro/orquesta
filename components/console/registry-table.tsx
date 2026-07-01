"use client"

import { useState } from "react"
import Link from "next/link"
import { Plus, GitBranch, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { StatusBadge, StateDot } from "@/components/status-badge"
import type { Project } from "@/lib/types"

function Toggle({
  on,
  label,
  onClick,
}: {
  on: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      role="switch"
      aria-checked={on}
      className="flex items-center gap-2 font-mono text-[11px]"
    >
      <span
        className={cn(
          "relative h-4 w-7 rounded-full transition-colors",
          on ? "bg-primary" : "bg-muted",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-3 w-3 rounded-full bg-background transition-transform",
            on ? "translate-x-3.5" : "translate-x-0.5",
          )}
        />
      </span>
      <span className={cn(on ? "text-foreground" : "text-muted-foreground")}>{label}</span>
    </button>
  )
}

export function RegistryTable({ initialProjects }: { initialProjects: Project[] }) {
  const [projects, setProjects] = useState<Project[]>(initialProjects)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ name: "", repo: "", path: "", branch: "main" })
  const [error, setError] = useState("")

  function toggleWatch(id: string, key: "prs" | "issues") {
    setProjects((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, watch: { ...p.watch, [key]: !p.watch[key] } } : p,
      ),
    )
  }

  function addProject(e: React.FormEvent) {
    e.preventDefault()
    const name = form.name.trim()
    if (!name) return
    if (projects.some((p) => p.id === name)) {
      setError(`project add rejected: "${name}" already exists`)
      return
    }
    const next: Project = {
      id: name,
      name,
      repo_url: form.repo.trim() || `github.com/you/${name}`,
      workspace_path: form.path.trim() || `~/code/${name}`,
      base_branch: form.branch.trim() || "main",
      watch: { prs: false, issues: false },
      state: "idle",
      description: "Newly registered project.",
      language: "—",
      cost_usd: 0,
      last_run: new Date().toISOString(),
      tasks: [],
      features: [],
      events: [],
    }
    setProjects((prev) => [...prev, next])
    setForm({ name: "", repo: "", path: "", branch: "main" })
    setError("")
    setAdding(false)
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="font-mono text-xs text-muted-foreground">
          {projects.length} projects in <span className="text-foreground">projects.json</span>
        </p>
        <Button size="sm" className="font-mono text-xs" onClick={() => setAdding((v) => !v)}>
          {adding ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {adding ? "Cancel" : "Add project"}
        </Button>
      </div>

      {adding && (
        <form
          onSubmit={addProject}
          className="mb-4 grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2"
        >
          <div className="flex flex-col gap-1">
            <label className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
              Name
            </label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="my-service"
              className="rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary/50"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
              Repo URL
            </label>
            <input
              value={form.repo}
              onChange={(e) => setForm({ ...form, repo: e.target.value })}
              placeholder="github.com/you/my-service"
              className="rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary/50"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
              Workspace path
            </label>
            <input
              value={form.path}
              onChange={(e) => setForm({ ...form, path: e.target.value })}
              placeholder="~/code/my-service"
              className="rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary/50"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
              Base branch
            </label>
            <input
              value={form.branch}
              onChange={(e) => setForm({ ...form, branch: e.target.value })}
              placeholder="main"
              className="rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary/50"
            />
          </div>
          {error && <p className="font-mono text-[11px] text-err sm:col-span-2">{error}</p>}
          <div className="sm:col-span-2">
            <Button type="submit" size="sm" className="font-mono text-xs">
              orq-lite project add
            </Button>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-card/50 text-left font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 font-medium">Project</th>
              <th className="hidden px-4 py-3 font-medium md:table-cell">Branch</th>
              <th className="px-4 py-3 font-medium">State</th>
              <th className="px-4 py-3 font-medium">Watchers</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id} className="border-b border-border last:border-0 hover:bg-card/40">
                <td className="px-4 py-3">
                  <Link href={`/projects/${p.id}`} className="flex items-center gap-2.5">
                    <StateDot state={p.state} />
                    <div className="min-w-0">
                      <p className="font-mono text-sm font-medium">{p.name}</p>
                      <p className="truncate font-mono text-[11px] text-muted-foreground">
                        {p.workspace_path}
                      </p>
                    </div>
                  </Link>
                </td>
                <td className="hidden px-4 py-3 md:table-cell">
                  <span className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
                    <GitBranch className="h-3 w-3" />
                    {p.base_branch}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={p.state} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-1.5">
                    <Toggle on={p.watch.prs} label="PRs" onClick={() => toggleWatch(p.id, "prs")} />
                    <Toggle
                      on={p.watch.issues}
                      label="Issues"
                      onClick={() => toggleWatch(p.id, "issues")}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
