import Link from "next/link"
import { Boxes, Activity, AlertTriangle, DollarSign, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConsoleHeader } from "@/components/console/console-header"
import { ProjectCard } from "@/components/console/project-card"
import { GlobalChat } from "@/components/console/global-chat"
import { getProjects } from "@/lib/orq-lite"

export default async function DashboardPage() {
  const projects = await getProjects()
  const running = projects.filter((p) => p.state === "running").length
  const needsHuman = projects.filter((p) => p.state === "needs_human").length
  const totalCost = projects.reduce((acc, p) => acc + p.cost_usd, 0)

  const stats = [
    { label: "Projects", value: projects.length, icon: Boxes },
    { label: "Running", value: running, icon: Activity },
    { label: "Needs human", value: needsHuman, icon: AlertTriangle },
    { label: "Spend (total)", value: `$${totalCost.toFixed(2)}`, icon: DollarSign },
  ]

  return (
    <>
      <ConsoleHeader
        title="Overview"
        subtitle="Every project, team and task in one place"
        actions={
          <Button asChild size="sm" className="font-mono text-xs">
            <Link href="/dashboard/chat">
              Global chat
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        }
      />

      <div className="grid flex-1 gap-0 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 p-5 md:p-7">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                    {s.label}
                  </span>
                  <s.icon className="h-4 w-4 text-primary" />
                </div>
                <p className="mt-2 font-mono text-2xl font-semibold">{s.value}</p>
              </div>
            ))}
          </div>

          <div className="mb-3 mt-8 flex items-center justify-between">
            <h2 className="font-mono text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Projects
            </h2>
            <Button asChild variant="ghost" size="sm" className="font-mono text-xs">
              <Link href="/dashboard/projects">Manage registry</Link>
            </Button>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {projects.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>
        </div>

        <div className="hidden border-l border-border xl:block">
          <div className="sticky top-16 h-[calc(100dvh-4rem)]">
            <GlobalChat />
          </div>
        </div>
      </div>
    </>
  )
}
