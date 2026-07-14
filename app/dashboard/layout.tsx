import type { ReactNode } from "react"
import { ConsoleSidebar } from "@/components/console/console-sidebar"
import { ControlPlaneBanner } from "@/components/console/control-plane-banner"
import { getProjects } from "@/lib/orq-lite"

// The dashboard reads live control-plane state (projects, flows, teams). Without
// this the pages get statically prerendered at build time — when the API isn't
// running — and serve a permanently-empty registry. Render on demand instead.
export const dynamic = "force-dynamic"

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const projects = await getProjects()

  return (
    <div className="flex min-h-dvh">
      <ConsoleSidebar projects={projects} />
      <div className="flex min-w-0 flex-1 flex-col pt-14 lg:pt-0">
        <ControlPlaneBanner />
        {children}
      </div>
    </div>
  )
}
