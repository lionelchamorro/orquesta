import { ConsoleHeader } from "@/components/console/console-header"
import { TeamManager } from "@/components/console/team-manager"
import { getProjects, getTeams } from "@/lib/orq-lite"

export default async function TeamPage() {
  const projects = await getProjects()
  const firstProjectId = projects[0]?.id
  const teams = await getTeams(firstProjectId)

  return (
    <>
      <ConsoleHeader
        title="Teams"
        subtitle="Edit the team.json roster that orq-lite uses for roles, agents, prompts and gates"
      />
      <div className="p-5 md:p-7">
        <TeamManager initialTeams={teams} projects={projects} initialProjectId={firstProjectId} />
      </div>
    </>
  )
}
