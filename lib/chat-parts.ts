// Modelo puro del chat: convierte los mensajes y eventos de opencode al shape
// que renderiza GlobalChat. Sin React ni I/O — testeado en aislamiento.
import type { Part } from "@opencode-ai/sdk/client"

export interface ChatRunLink {
  runId: string
  projectId?: string
}

export type ChatPart =
  | { kind: "text"; id: string; text: string }
  | { kind: "tool"; id: string; name: string; status: "pending" | "running" | "completed" | "error"; link?: ChatRunLink }

export interface ChatTurn {
  id: string
  role: "user" | "assistant"
  parts: ChatPart[]
}

// Tools del MCP orquesta cuyo output contiene un Run del control plane.
const RUN_TOOL = /^orquesta_(launch_flow|start_watch_daemon)$/

export function runLinkFromTool(tool: string, output: string): ChatRunLink | null {
  if (!RUN_TOOL.test(tool)) return null
  try {
    const data = JSON.parse(output) as { id?: unknown; run_id?: unknown; project_id?: unknown }
    const runId = typeof data.id === "string" ? data.id : typeof data.run_id === "string" ? data.run_id : null
    if (!runId) return null
    return {
      runId,
      projectId: typeof data.project_id === "string" ? data.project_id : undefined,
    }
  } catch {
    return null
  }
}

function toChatPart(part: Part): ChatPart | null {
  if (part.type === "text") {
    if (part.synthetic || part.ignored) return null
    return { kind: "text", id: part.id, text: part.text }
  }
  if (part.type === "tool") {
    const status = part.state.status
    const link =
      status === "completed" && typeof part.state.output === "string"
        ? (runLinkFromTool(part.tool, part.state.output) ?? undefined)
        : undefined
    return { kind: "tool", id: part.id, name: part.tool, status, link }
  }
  return null
}

export function localUserTurn(id: string, text: string): ChatTurn {
  return { id, role: "user", parts: [{ kind: "text", id, text }] }
}

// Upsert inmutable de un part dentro del turno del assistant al que pertenece
// (messageID). Crea el turno si es la primera vez que lo vemos; conserva el
// orden de primera aparición de cada part (los updates reemplazan in place).
export function applyPartUpdate(turns: ChatTurn[], part: Part): ChatTurn[] {
  const chatPart = toChatPart(part)
  if (!chatPart) return turns

  const idx = turns.findIndex((t) => t.id === part.messageID)
  if (idx === -1) {
    return [...turns, { id: part.messageID, role: "assistant", parts: [chatPart] }]
  }
  const turn = turns[idx]
  const partIdx = turn.parts.findIndex((p) => p.id === chatPart.id)
  const parts =
    partIdx === -1
      ? [...turn.parts, chatPart]
      : turn.parts.map((p, i) => (i === partIdx ? chatPart : p))
  return turns.map((t, i) => (i === idx ? { ...turn, parts } : t))
}

export function turnsFromHistory(
  entries: Array<{ info: { id: string; role: string }; parts: Part[] }>,
): ChatTurn[] {
  const turns: ChatTurn[] = []
  for (const entry of entries) {
    const parts = entry.parts.map(toChatPart).filter((p): p is ChatPart => p !== null)
    if (parts.length === 0) continue
    turns.push({
      id: entry.info.id,
      role: entry.info.role === "user" ? "user" : "assistant",
      parts,
    })
  }
  return turns
}
