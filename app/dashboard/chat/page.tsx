import { ConsoleHeader } from "@/components/console/console-header"
import { GlobalChat } from "@/components/console/global-chat"

export default function ChatPage() {
  return (
    <>
      <ConsoleHeader
        title="Global chat"
        subtitle="Define features, route to projects, toggle watchers and launch runs"
      />
      <div className="mx-auto flex h-[calc(100dvh-4rem)] w-full max-w-3xl flex-col">
        <GlobalChat />
      </div>
    </>
  )
}
