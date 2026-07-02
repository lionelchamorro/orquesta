import { notFound } from "next/navigation"
import { OfficeView } from "@/components/office/office-view"
import { getProject, getTeams } from "@/lib/orq-lite"

export const dynamic = "force-dynamic"

export default async function OfficePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const project = await getProject(id)
  if (!project) notFound()

  const teams = await getTeams(id)
  const roles = [...new Set(teams.flatMap((team) => team.roles.map((role) => role.role)))]

  return <OfficeView project={project} roles={roles} />
}
