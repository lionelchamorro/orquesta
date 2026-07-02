import { ConsoleHeader } from "@/components/console/console-header"
import { FlowManager } from "@/components/console/flow-manager"
import { getFlows, getProjects } from "@/lib/orq-lite"

export default async function FlowsPage() {
  const projects = await getProjects()
  const firstProjectId = projects[0]?.id
  const flows = await getFlows(firstProjectId)

  return (
    <>
      <ConsoleHeader
        title="Flows"
        subtitle="Edit the flows.json definitions that orq-lite flow run <name> executes"
      />
      <div className="p-5 md:p-7">
        <FlowManager
          key={firstProjectId}
          initialFlows={flows}
          projects={projects}
          initialProjectId={firstProjectId}
        />
      </div>
    </>
  )
}
