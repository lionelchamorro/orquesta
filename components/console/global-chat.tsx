"use client"

import { useState, useRef, useEffect } from "react"
import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/client"
import { Send, Sparkles, Loader2, CornerDownLeft, Wrench } from "lucide-react"
import { cn, uid } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useSystemStatus } from "@/lib/use-system-status"
import { BackendBanner } from "@/components/console/system-status"
import type { ChatMessage } from "@/lib/types"

const suggestions = [
  "What projects need attention?",
  "List my projects",
  "Enable the PR watcher on prm",
  "Launch factory_fast on prm",
]

// The browser talks to the loopback opencode server through the same-origin
// /opencode proxy (app/opencode/[...path]/route.ts). The `orquesta` agent
// (deploy/opencode.json) drives the control plane via its MCP tools.
const AGENT = "orquesta"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractParts(data: any): { text: string; tools: string[] } {
  const parts: unknown[] = data?.parts ?? data?.info?.parts ?? []
  let text = ""
  const tools: string[] = []
  for (const p of parts) {
    const part = p as { type?: string; text?: string; tool?: string; state?: { title?: string } }
    if (part.type === "text" && part.text) text += part.text
    else if (part.type === "tool") tools.push(part.tool ?? part.state?.title ?? "tool")
  }
  return { text: text.trim(), tools }
}

export function GlobalChat({ compact = false }: { compact?: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [toolCalls, setToolCalls] = useState<string[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const clientRef = useRef<OpencodeClient | null>(null)
  const sessionRef = useRef<string | null>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages, loading, toolCalls])

  async function ensureSession(): Promise<{ client: OpencodeClient; sessionID: string }> {
    if (!clientRef.current) clientRef.current = createOpencodeClient({ baseUrl: "/opencode" })
    const client = clientRef.current
    if (!sessionRef.current) {
      const created = await client.session.create({ body: {} })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sessionRef.current = (created.data as any)?.id
      if (!sessionRef.current) throw new Error("could not create an opencode session")
    }
    return { client, sessionID: sessionRef.current }
  }

  const { status, refresh } = useSystemStatus()
  const opencodeDown = status !== null && status.opencode === "down"

  async function send(text: string) {
    const content = text.trim()
    if (!content || loading || opencodeDown) return
    setMessages((prev) => [...prev, { id: uid(), role: "user", content }])
    setInput("")
    setLoading(true)
    setToolCalls([])

    try {
      const { client, sessionID } = await ensureSession()
      const result = await client.session.prompt({
        path: { id: sessionID },
        body: { agent: AGENT, parts: [{ type: "text", text: content }] },
      })
      if (result.error) throw new Error(JSON.stringify(result.error))
      const { text: reply, tools } = extractParts(result.data)
      if (tools.length) setToolCalls(tools)
      setMessages((prev) => [
        ...prev,
        { id: uid(), role: "assistant", content: reply || "(the agent returned no text)" },
      ])
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: "assistant",
          content: `Could not reach the agent: ${err instanceof Error ? err.message : String(err)}`,
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      {!compact && (
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="font-mono text-sm font-semibold">Orquesta agent</span>
          <span className="ml-auto font-mono text-[11px] text-muted-foreground">opencode · {AGENT}</span>
        </div>
      )}

      {opencodeDown && (
        <div className="p-4">
          <BackendBanner
            label="opencode is not running"
            hint="The chat needs the opencode server (OPENCODE_SERVER_URL). In the container, check `docker logs` — supervisord should keep it alive on :4096."
            onRetry={refresh}
          />
        </div>
      )}

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.map((m) => (
          <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                m.role === "user"
                  ? "rounded-br-sm bg-primary text-primary-foreground"
                  : "rounded-bl-sm bg-secondary text-secondary-foreground",
              )}
            >
              <p className="whitespace-pre-wrap text-pretty">{m.content}</p>
            </div>
          </div>
        ))}
        {toolCalls.map((name, i) => (
          <div key={`${name}-${i}`} className="flex justify-start">
            <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm bg-secondary/60 px-4 py-2 font-mono text-xs text-muted-foreground">
              <Wrench className="h-3.5 w-3.5" />
              {name}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm bg-secondary px-4 py-2.5 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              thinking…
            </div>
          </div>
        )}
      </div>

      {messages.length === 0 && (
        <div className="flex flex-wrap gap-2 px-4 pb-2">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              className="rounded-full border border-border bg-card px-3 py-1.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          send(input)
        }}
        className="border-t border-border p-3"
      >
        <div className="flex items-end gap-2 rounded-xl border border-border bg-card p-2 focus-within:border-primary/50">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                send(input)
              }
            }}
            rows={1}
            placeholder="Ask for something: register a project, launch a flow, toggle a watcher…"
            className="max-h-32 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
          />
          <Button type="submit" size="icon" disabled={loading || !input.trim() || opencodeDown} className="shrink-0">
            <Send className="h-4 w-4" />
            <span className="sr-only">Send</span>
          </Button>
        </div>
        <p className="mt-1.5 flex items-center gap-1 px-1 font-mono text-[11px] text-muted-foreground">
          <CornerDownLeft className="h-3 w-3" /> enter to send · shift+enter for a new line
        </p>
      </form>
    </div>
  )
}
