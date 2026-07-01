import { ConsoleHeader } from "@/components/console/console-header"
import { FlowManager } from "@/components/console/flow-manager"
import { getFlows, getProjects, getTeams } from "@/lib/orq-lite"

export default async function FlowsPage() {
  const [flows, teams, projects] = await Promise.all([getFlows(), getTeams(), getProjects()])

  return (
    <>
      <ConsoleHeader
        title="Flows"
        subtitle="Define reusable flows for orq-lite flow run <name> and bind them to a team"
      />
      <div className="p-5 md:p-7">
        <FlowManager initialFlows={flows} teams={teams} projects={projects} />
      </div>
    </>
  )
}
