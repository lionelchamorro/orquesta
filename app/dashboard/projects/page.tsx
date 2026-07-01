import { ConsoleHeader } from "@/components/console/console-header"
import { RegistryTable } from "@/components/console/registry-table"
import { getProjects } from "@/lib/orq-lite"

export default async function ProjectsPage() {
  const projects = await getProjects()

  return (
    <>
      <ConsoleHeader
        title="Project registry"
        subtitle="File-based projects.json · enable PR and issue watchers per project"
      />
      <div className="p-5 md:p-7">
        <RegistryTable initialProjects={projects} />
      </div>
    </>
  )
}
