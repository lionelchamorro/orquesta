import type { ReactNode } from "react"
import { ConsoleSidebar } from "@/components/console/console-sidebar"
import { getProjects } from "@/lib/orq-lite"

export default async function ProjectsLayout({ children }: { children: ReactNode }) {
  const projects = await getProjects()

  return (
    <div className="flex min-h-dvh">
      <ConsoleSidebar projects={projects} />
      <div className="flex min-w-0 flex-1 flex-col pt-14 lg:pt-0">{children}</div>
    </div>
  )
}
