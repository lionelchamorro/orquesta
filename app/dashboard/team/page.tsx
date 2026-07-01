import { ConsoleHeader } from "@/components/console/console-header"
import { TeamManager } from "@/components/console/team-manager"
import { getTeams } from "@/lib/orq-lite"

export default async function TeamPage() {
  const teams = await getTeams()

  return (
    <>
      <ConsoleHeader
        title="Teams"
        subtitle="Edit the team.json roster that orq-lite uses for roles, agents, prompts and gates"
      />
      <div className="p-5 md:p-7">
        <TeamManager initialTeams={teams} />
      </div>
    </>
  )
}
