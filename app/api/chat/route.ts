import { type NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"

type Msg = { role: "user" | "assistant"; content: string }
type ProjInfo = {
  id: string
  name: string
  state: string
  watch: { prs: boolean; issues: boolean }
}

/**
 * Global admin chat endpoint.
 *
 * In production this proxies to a running opencode server (the orq-lite admin
 * agent). Set OPENCODE_SERVER_URL to enable it. The agent is responsible for
 * resolving the project from the registry, appending to feature.md, toggling
 * watchers, and launching runs.
 *
 * When no server is configured we fall back to a lightweight rule-based reply
 * so the UI stays fully interactive against mock data.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const messages: Msg[] = body.messages ?? []
  const projects: ProjInfo[] = body.projects ?? []

  const serverUrl = process.env.OPENCODE_SERVER_URL
  if (serverUrl) {
    try {
      const res = await fetch(`${serverUrl.replace(/\/$/, "")}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(process.env.OPENCODE_API_KEY
            ? { Authorization: `Bearer ${process.env.OPENCODE_API_KEY}` }
            : {}),
        },
        body: JSON.stringify({ messages, projects }),
      })
      if (res.ok) {
        const data = await res.json()
        return NextResponse.json({
          content: data.content ?? data.message ?? "",
          project: data.project,
          action: data.action,
        })
      }
    } catch {
      // fall through to local reasoning
    }
  }

  return NextResponse.json(mockReply(messages, projects))
}

function mockReply(messages: Msg[], projects: ProjInfo[]) {
  const last = (messages.filter((m) => m.role === "user").at(-1)?.content ?? "").toLowerCase()
  const matched = projects.find((p) => last.includes(p.name.toLowerCase()) || last.includes(p.id.toLowerCase()))

  // register a project
  if (/(registr|add|nuevo proyecto|crear proyecto)/.test(last)) {
    return {
      content:
        "Para registrar un proyecto necesito el nombre, la repo URL y el workspace path. Ejecutaría:\n\norq-lite project add <name> --repo <url> --path <dir>\n\nDecime los datos o agregalo desde la pestaña Projects.",
      action: "pending",
    }
  }

  // enable / disable watchers
  if (/(watcher|watch|pr|issue)/.test(last) && /(habilit|enable|activ|desactiv|disable)/.test(last)) {
    const target = matched?.name ?? "<proyecto>"
    const kind = last.includes("issue") ? "--issues" : "--prs"
    return {
      content: `Listo. Toggleo el watcher para ${target}:\n\norq-lite project watch enable ${target} ${kind}\n\nEl demonio releerá projects.json y polleará solo los tipos habilitados.`,
      project: matched?.id,
      action: "done",
    }
  }

  // status / attention queries
  if (/(estado|status|atenci|needs human|colas|queue|qué proyectos)/.test(last)) {
    const needs = projects.filter((p) => p.state === "needs_human").map((p) => p.name)
    const running = projects.filter((p) => p.state === "running").map((p) => p.name)
    return {
      content:
        (needs.length
          ? `Necesitan intervención: ${needs.join(", ")}.\n`
          : "Ningún proyecto está bloqueado en needs_human.\n") +
        (running.length ? `Corriendo ahora: ${running.join(", ")}.` : "No hay runs activos."),
      action: needs.length ? "needs_human" : "done",
    }
  }

  // define a feature
  if (/(feature|definir|implement|agregar|caché|cache|build)/.test(last)) {
    if (!matched) {
      return {
        content:
          "¿A qué proyecto va esta feature? Decime el nombre (por ejemplo orquestalite o atlas-api) y la appendeo a su feature.md para disparar la factory.",
        action: "needs_clarification",
      }
    }
    return {
      content: `Entendido. Appendeo la feature al feature.md de ${matched.name} y disparo su factory. Vas a ver las tasks nuevas aparecer en el stream de ese proyecto.`,
      project: matched.id,
      action: "in_progress",
    }
  }

  // launch a run
  if (/(lanz|run|corr|ejecut)/.test(last)) {
    const target = matched?.name ?? projects[0]?.name ?? "<proyecto>"
    return {
      content: `Lanzo un run para ${target}:\n\norq-lite factory --project ${target}\n\nSeguí el progreso en el panel de Live events.`,
      project: matched?.id,
      action: "in_progress",
    }
  }

  return {
    content:
      "Puedo registrar proyectos, alternar watchers de PR/issues, consultar el estado del conjunto, definir features (las appendo al feature.md del proyecto y disparo la factory) y lanzar runs. ¿Sobre qué proyecto querés operar?",
  }
}
