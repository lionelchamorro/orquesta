"use client"

import { useState, useRef, useEffect } from "react"
import { Send, Sparkles, Loader2, CornerDownLeft } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/status-badge"
import { seedChat } from "@/lib/mock-data"
import type { ChatMessage, Project } from "@/lib/types"

const suggestions = [
  "Registrar un nuevo proyecto",
  "¿Qué proyectos necesitan atención?",
  "Habilitar el watcher de PRs en atlas-api",
  "Definir una feature de caché para orquestalite",
]

export function GlobalChat({
  compact = false,
  projects,
}: {
  compact?: boolean
  projects: Project[]
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(seedChat)
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages, loading])

  async function send(text: string) {
    const content = text.trim()
    if (!content || loading) return
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", content }
    const history = [...messages, userMsg]
    setMessages(history)
    setInput("")
    setLoading(true)
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.map((m) => ({ role: m.role, content: m.content })),
          projects: projects.map((p) => ({
            id: p.id,
            name: p.name,
            state: p.state,
            watch: p.watch,
          })),
        }),
      })
      const data = await res.json()
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: data.content ?? "No pude procesar el pedido.",
          project: data.project,
          action: data.action,
        },
      ])
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "No pude conectar con el servidor de agentes. Reintentá en unos segundos.",
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
          <span className="font-mono text-sm font-semibold">Admin agent</span>
          <span className="ml-auto font-mono text-[11px] text-muted-foreground">orq-lite admin</span>
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
        {loading && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm bg-secondary px-4 py-2.5 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              pensando…
            </div>
          </div>
        )}
      </div>

      {messages.length <= 1 && (
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
            placeholder="Pedí algo: registrar proyecto, lanzar run, definir feature…"
            className="max-h-32 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
          />
          <Button type="submit" size="icon" disabled={loading || !input.trim()} className="shrink-0">
            <Send className="h-4 w-4" />
            <span className="sr-only">Enviar</span>
          </Button>
        </div>
        <p className="mt-1.5 flex items-center gap-1 px-1 font-mono text-[11px] text-muted-foreground">
          <CornerDownLeft className="h-3 w-3" /> enter para enviar · shift+enter nueva línea
        </p>
      </form>
    </div>
  )
}
