import { notFound } from "next/navigation"
import { ConsoleHeader } from "@/components/console/console-header"
import { ProjectView, ProjectActions } from "@/components/console/project-view"
import { getProject } from "@/lib/orq-lite"

// Live control-plane data — never statically pre-rendered.
export const dynamic = "force-dynamic"

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const project = await getProject(id)
  if (!project) notFound()

  return (
    <>
      <ConsoleHeader
        title={project.name}
        subtitle={project.repo_url}
        actions={<ProjectActions project={project} />}
      />
      <ProjectView project={project} />
    </>
  )
}
