"use client"

import { useState, useRef, useEffect } from "react"
import { Send, Sparkles, Loader2, CornerDownLeft, Wrench } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/status-badge"
import type { ChatMessage } from "@/lib/types"

const suggestions = [
  "What projects need attention?",
  "List my projects",
  "Enable the PR watcher on atlas-api",
  "Queue a caching feature for orquestalite",
]

type ChatEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; name: string; input: Record<string, unknown> }
  | { type: "done"; action?: string; project?: string }

function parseSseLines(chunk: string): ChatEvent[] {
  const events: ChatEvent[] = []
  for (const block of chunk.split("\n\n")) {
    const line = block.trim()
    if (!line.startsWith("data:")) continue
    const payload = line.slice("data:".length).trim()
    if (!payload) continue
    try {
      events.push(JSON.parse(payload) as ChatEvent)
    } catch {
      // ignore malformed chunk boundary; the next read will complete it
    }
  }
  return events
}

export function GlobalChat({ compact = false }: { compact?: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [toolCalls, setToolCalls] = useState<string[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/control-plane/chat/history", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : []))
      .then((history: ChatMessage[]) => {
        if (!cancelled) setMessages(history)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setHistoryLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages, loading, toolCalls])

  async function send(text: string) {
    const content = text.trim()
    if (!content || loading) return
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", content }
    setMessages((prev) => [...prev, userMsg])
    setInput("")
    setLoading(true)
    setToolCalls([])

    const assistantId = crypto.randomUUID()

    try {
      const res = await fetch("/api/control-plane/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: content }),
      })
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const events = parseSseLines(buffer)
        buffer = buffer.slice(buffer.lastIndexOf("\n\n") + 2)

        for (const event of events) {
          if (event.type === "text") {
            // Accumulate inside the updater so there's no mutable closure
            // variable (react-compiler immutability rule).
            setMessages((prev) => {
              const draft = prev.find((m) => m.id === assistantId)
              const content = (draft?.content ?? "") + event.text
              const withoutDraft = prev.filter((m) => m.id !== assistantId)
              return [...withoutDraft, { id: assistantId, role: "assistant", content }]
            })
          } else if (event.type === "tool_call") {
            setToolCalls((prev) => [...prev, event.name])
          } else if (event.type === "done") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, action: event.action, project: event.project } : m,
              ),
            )
          }
        }
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "Could not reach the admin agent. Try again in a moment.",
        },
      ])
    } finally {
      setLoading(false)
      setToolCalls([])
    }
  }

  return (
    <div className="flex h-full flex-col">
      {!compact && (
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="font-mono text-sm font-semibold">Admin agent</span>
          <span className="ml-auto font-mono text-[11px] text-muted-foreground">orquesta chat</span>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
          >
            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                m.role === "user"
                  ? "rounded-br-sm bg-primary text-primary-foreground"
                  : "rounded-bl-sm bg-secondary text-secondary-foreground",
              )}
            >
              {(m.project || m.action) && (
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  {m.action && <StatusBadge status={m.action} />}
                  {m.project && (
                    <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                      {m.project}
                    </span>
                  )}
                </div>
              )}
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
        {loading && toolCalls.length === 0 && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm bg-secondary px-4 py-2.5 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              thinking…
            </div>
          </div>
        )}
      </div>

      {historyLoaded && messages.length === 0 && (
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
            placeholder="Ask for something: register a project, launch a run, queue a feature…"
            className="max-h-32 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
          />
          <Button type="submit" size="icon" disabled={loading || !input.trim()} className="shrink-0">
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
