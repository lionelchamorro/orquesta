"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { createOpencodeClient, type OpencodeClient, type Part } from "@opencode-ai/sdk/client"
import { Send, Sparkles, Loader2, CornerDownLeft, Wrench, Plus, ExternalLink, CircleCheck, CircleX } from "lucide-react"
import { cn, uid } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useSystemStatus } from "@/lib/use-system-status"
import { BackendBanner } from "@/components/console/system-status"
import { applyPartUpdate, localUserTurn, turnsFromHistory, type ChatPart, type ChatTurn } from "@/lib/chat-parts"
import {
  GLOBAL_SCOPE,
  projectContextHint,
  scopeLabel,
  scopeSuggestions,
  sessionStorageKey,
  type ChatScope,
} from "@/lib/chat-scope"

// El browser habla con el opencode loopback a través del proxy same-origin
// /opencode (app/opencode/[...path]/route.ts). El agente `orquesta`
// (deploy/opencode.json) opera el control plane vía sus tools MCP.
const AGENT = "orquesta"

function ToolChip({ part }: { part: Extract<ChatPart, { kind: "tool" }> }) {
  const icon =
    part.status === "completed" ? <CircleCheck className="h-3.5 w-3.5 text-emerald-500" />
    : part.status === "error" ? <CircleX className="h-3.5 w-3.5 text-red-500" />
    : <Loader2 className="h-3.5 w-3.5 animate-spin" />
  return (
    <div className="my-1 flex items-center gap-2 rounded-2xl rounded-bl-sm bg-secondary/60 px-4 py-2 font-mono text-xs text-muted-foreground">
      <Wrench className="h-3.5 w-3.5" />
      {part.name}
      {icon}
      {part.link && (
        <Link
          href={part.link.projectId ? `/projects/${part.link.projectId}` : "/dashboard/projects"}
          className="inline-flex items-center gap-1 text-primary hover:underline"
        >
          run {part.link.runId.slice(0, 8)} <ExternalLink className="h-3 w-3" />
        </Link>
      )}
    </div>
  )
}

export function GlobalChat({
  compact = false,
  scope = GLOBAL_SCOPE,
}: {
  compact?: boolean
  scope?: ChatScope
}) {
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const { status, refresh } = useSystemStatus()
  const opencodeDown = status !== null && status.opencode === "down"
  const scrollRef = useRef<HTMLDivElement>(null)
  const clientRef = useRef<OpencodeClient | null>(null)
  const sessionRef = useRef<string | null>(null)
  // messageID -> role, poblado desde message.updated. message.part.updated no
  // trae el role del mensaje al que pertenece el part, así que lo llevamos
  // aparte para poder distinguir los parts del usuario (que no se re-renderan,
  // ver applyPartUpdate) de los del assistant.
  const rolesRef = useRef(new Map<string, "user" | "assistant">())

  // Derive the localStorage key and label from the current scope.
  const storageKey = sessionStorageKey(scope)
  const label = scopeLabel(scope)
  const suggestions = scopeSuggestions(scope)

  function client(): OpencodeClient {
    if (!clientRef.current) clientRef.current = createOpencodeClient({ baseUrl: "/opencode" })
    return clientRef.current
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [turns, sending])

  // Restaurar la conversación previa y luego suscribirnos al stream SSE, en
  // ese orden estricto: si el restore y el listen corrieran en paralelo, un
  // part SSE que llegue mientras el fetch de historial está pendiente sería
  // descartado por el reemplazo duro de setTurns(turnsFromHistory(...)).
  // Al esperar el restore antes de arrancar el listen, cualquier delta que
  // nos perdamos en la ventana del fetch se autocorrige: cada
  // message.part.updated trae el estado completo del part.
  //
  // NOTE: storageKey is used inside this effect but we do NOT include it in
  // the dependency array so the effect runs only once per mount — the same
  // pattern as the previous SESSION_KEY constant. Switching scope should
  // unmount/remount the component (e.g. by changing the project tab).
  useEffect(() => {
    let active = true
    let stream: AsyncGenerator<unknown> | null = null

    async function start() {
      const stored = localStorage.getItem(storageKey)
      if (stored) {
        sessionRef.current = stored
        try {
          const res = await client().session.messages({ path: { id: stored } })
          if (res.error) {
            // Respuesta definitiva del server: la sesión ya no existe.
            sessionRef.current = null
            localStorage.removeItem(storageKey)
          } else if (active && res.data) {
            const history = res.data as Array<{ info: { id: string; role: string }; parts: Part[] }>
            for (const entry of history) {
              rolesRef.current.set(entry.info.id, entry.info.role === "user" ? "user" : "assistant")
            }
            setTurns(turnsFromHistory(history))
          }
        } catch {
          // Falla transitoria (red, opencode reiniciando): conservamos la
          // sesión guardada para reintentar en el próximo mount/reload en
          // vez de perder el hilo de la conversación.
        }
      }

      if (!active) return

      // Streaming: el feed SSE global de opencode emite message.part.updated
      // con cada delta de texto y transición de tool — filtramos por nuestra
      // sesión. Si el stream no está disponible, send() igual renderiza el
      // turno completo al resolver (fallback sin streaming).
      try {
        const events = await client().event.subscribe()
        if (!active) {
          void events.stream.return?.(undefined)
          return
        }
        stream = events.stream as AsyncGenerator<unknown>
        for await (const event of events.stream) {
          if (!active) break
          const ev = event as {
            type?: string
            properties?: { part?: Part; info?: { id?: string; role?: string; sessionID?: string } }
          }
          if (ev.type === "message.updated") {
            const info = ev.properties?.info
            if (info?.sessionID !== sessionRef.current) continue
            if (info?.id) rolesRef.current.set(info.id, info.role === "user" ? "user" : "assistant")
            continue
          }
          if (ev.type !== "message.part.updated") continue
          const part = ev.properties?.part
          if (!part || part.sessionID !== sessionRef.current) continue
          const role = rolesRef.current.get(part.messageID) ?? "assistant"
          setTurns((prev) => applyPartUpdate(prev, part, role))
        }
      } catch {
        // sin SSE seguimos funcionando en modo respuesta-completa
      }
    }

    void start()
    return () => {
      active = false
      void stream?.return?.(undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function ensureSession(): Promise<string> {
    if (sessionRef.current) return sessionRef.current
    const created = await client().session.create({ body: {} })
    const id = (created.data as { id?: string } | undefined)?.id
    if (!id) throw new Error("could not create an opencode session")
    sessionRef.current = id
    localStorage.setItem(storageKey, id)
    return id
  }

  function resetConversation() {
    sessionRef.current = null
    localStorage.removeItem(storageKey)
    setTurns([])
    setSendError(null)
    rolesRef.current.clear()
  }

  async function send(text: string) {
    const content = text.trim()
    if (!content || sending || opencodeDown) return
    // Show the user's original text in the UI before any context injection.
    setTurns((prev) => [...prev, localUserTurn(uid(), content)])
    setInput("")
    setSending(true)
    setSendError(null)

    try {
      // Capture whether this send will create a new session so we know
      // whether to inject the project context hint.
      const isNewSession = sessionRef.current === null
      const sessionID = await ensureSession()

      // For project-scoped chats: on the very first message of a new session,
      // prepend a context hint so the orquesta agent knows the active project
      // without the user having to name it. The hint is NOT shown in the UI
      // bubble — the UI already rendered `localUserTurn(content)` above.
      const contextHint = isNewSession ? projectContextHint(scope) : null
      const textToSend = contextHint ? `${contextHint}\n\n${content}` : content

      const result = await client().session.prompt({
        path: { id: sessionID },
        body: { agent: AGENT, parts: [{ type: "text", text: textToSend }] },
      })
      if (result.error) throw new Error(JSON.stringify(result.error))
      // Reconciliación final (idempotente): si el SSE se perdió algo, los
      // parts del resultado completan el turno. Si el usuario reinició la
      // conversación (o inició otra) mientras el prompt estaba en vuelo,
      // descartamos esta reconciliación.
      if (sessionRef.current !== sessionID) return
      const parts = ((result.data as { parts?: Part[] } | undefined)?.parts ?? []) as Part[]
      setTurns((prev) =>
        parts.reduce((acc, p) => applyPartUpdate(acc, p, rolesRef.current.get(p.messageID) ?? "assistant"), prev),
      )
    } catch (err) {
      setSendError(err instanceof Error ? err.message : String(err))
    } finally {
      setSending(false)
    }
  }

  // Show the header when:
  // - not compact (global chat page and overview panel), OR
  // - project scope (always show scope label in the project tab)
  const showHeader = !compact || scope.kind === "project"

  return (
    <div className="flex h-full flex-col">
      {showHeader && (
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="font-mono text-sm font-semibold">{label}</span>
          <Button size="sm" variant="ghost" className="ml-auto font-mono text-[11px] text-muted-foreground" onClick={resetConversation}>
            <Plus className="h-3.5 w-3.5" /> new conversation
          </Button>
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
        {turns.map((turn) => (
          <div key={turn.id} className={cn("flex flex-col", turn.role === "user" ? "items-end" : "items-start")}>
            {turn.parts.map((part) =>
              part.kind === "text" ? (
                <div
                  key={part.id}
                  className={cn(
                    "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                    turn.role === "user"
                      ? "rounded-br-sm bg-primary text-primary-foreground"
                      : "rounded-bl-sm bg-secondary text-secondary-foreground",
                  )}
                >
                  <p className="whitespace-pre-wrap text-pretty">{part.text}</p>
                </div>
              ) : (
                <ToolChip key={part.id} part={part} />
              ),
            )}
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm bg-secondary px-4 py-2.5 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              thinking…
            </div>
          </div>
        )}
        {sendError && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-red-500/10 px-4 py-2.5 text-sm text-red-400">
              Could not complete the turn: {sendError}
            </div>
          </div>
        )}
      </div>

      {turns.length === 0 && !opencodeDown && (
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
          <Button type="submit" size="icon" disabled={sending || !input.trim() || opencodeDown} className="shrink-0">
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
