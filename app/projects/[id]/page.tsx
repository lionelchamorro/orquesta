import { notFound } from "next/navigation"
import { ConsoleHeader } from "@/components/console/console-header"
import { ProjectView, ProjectActions } from "@/components/console/project-view"
import { getProject, getProjects } from "@/lib/orq-lite"

export async function generateStaticParams() {
  const projects = await getProjects()
  return projects.map((p) => ({ id: p.id }))
}

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
