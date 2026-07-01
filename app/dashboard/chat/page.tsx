import { ConsoleHeader } from "@/components/console/console-header"
import { GlobalChat } from "@/components/console/global-chat"
import { getProjects } from "@/lib/orq-lite"

export default async function ChatPage() {
  const projects = await getProjects()

  return (
    <>
      <ConsoleHeader
        title="Global chat"
        subtitle="Define features, route to projects, toggle watchers and launch runs"
      />
      <div className="mx-auto flex h-[calc(100dvh-4rem)] w-full max-w-3xl flex-col">
        <GlobalChat projects={projects} />
      </div>
    </>
  )
}
