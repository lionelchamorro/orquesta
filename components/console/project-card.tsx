import Link from "next/link"
import { GitBranch, GitPullRequest, CircleDot, ArrowUpRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { StatusBadge, StateDot } from "@/components/status-badge"
import type { Project } from "@/lib/types"

function timeAgo(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

export function ProjectCard({ project }: { project: Project }) {
  const open = project.tasks.filter((t) => t.status !== "done").length
  const activeFeature = project.features.find((f) => f.status === "in_progress")
  return (
    <Link
      href={`/projects/${project.id}`}
      className="group flex flex-col rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/40"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <StateDot state={project.state} />
          <div className="min-w-0">
            <h3 className="truncate font-mono text-sm font-semibold">{project.name}</h3>
            <p className="truncate font-mono text-[11px] text-muted-foreground">{project.repo_url}</p>
          </div>
        </div>
        <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
      </div>

      <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
        {project.description}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <StatusBadge status={project.state} />
        <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
          <GitBranch className="h-3 w-3" />
          {project.base_branch}
        </span>
        <span className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
          {project.language}
        </span>
      </div>

      {activeFeature && (
        <div className="mt-4 rounded-lg border border-border bg-background/60 p-3">
          <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
            Building
          </p>
          <p className="mt-1 line-clamp-1 text-sm">{activeFeature.title}</p>
        </div>
      )}

      <div className="mt-4 flex items-center gap-4 border-t border-border pt-3 font-mono text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <CircleDot className="h-3 w-3" />
          {open} open
        </span>
        <span
          className={cn(
            "flex items-center gap-1",
            project.watch.prs ? "text-foreground" : "opacity-40",
          )}
          title={project.watch.prs ? "PR watcher on" : "PR watcher off"}
        >
          <GitPullRequest className="h-3 w-3" />
          PRs
        </span>
        <span
          className={cn(
            "flex items-center gap-1",
            project.watch.issues ? "text-foreground" : "opacity-40",
          )}
          title={project.watch.issues ? "Issue watcher on" : "Issue watcher off"}
        >
          <CircleDot className="h-3 w-3" />
          Issues
        </span>
        <span className="ml-auto">{timeAgo(project.last_run)}</span>
      </div>
    </Link>
  )
}
