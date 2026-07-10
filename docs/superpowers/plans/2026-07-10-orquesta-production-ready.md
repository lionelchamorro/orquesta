# Orquesta Production-Ready Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el ciclo *pedir una tarea por chat → orq-lite la ejecuta → ver el progreso* funcione completo desde el browser en el contenedor all-in-one, con un editor de flows dual (grafo interactivo + JSON editable) y observabilidad de los procesos internos.

**Architecture:** El frontend Next.js habla solo con proxies same-origin: `/api/control-plane/*` → FastAPI (:8000) y `/opencode/*` → opencode (:4096); el agente opencode `orquesta` opera el control plane vía MCP (:8765), que a su vez lanza `orq-lite` por run. Este plan no toca el backend Python ni el engine Go: todo el trabajo es frontend + deploy, apoyado en módulos puros testeables (`lib/chat-parts`, `lib/flow-steps`, `lib/flow-validate`, `lib/flow-json`, `lib/flow-graph`) con la orquestación en componentes finos.

**Tech Stack:** Next.js 16 / React 19 / TypeScript 5.7, `@opencode-ai/sdk` 1.17.13, `@xyflow/react` (React Flow), `@uiw/react-codemirror` + `@codemirror/lang-json`, vitest, bash para deploy/smoke.

**Spec:** `docs/superpowers/specs/2026-07-10-orquesta-production-ready-design.md`

## Global Constraints

- Comandos pesados (`pnpm build`, `docker compose build`) SIEMPRE bajo `systemd-run` con cap de memoria — un Next build sin cap ya crasheó la máquina (~50GB RAM). Patrón exacto en cada step que lo necesita.
- Commits en Conventional Commits: `type(scope): description` (hook commit-msg lo valida).
- `flows.json` es un archivo del usuario que parsea el engine de orq-lite: **solo** las claves `{description, inputs, steps}` se escriben a disco. Ningún campo UI-only (posiciones, ids, nombres) puede llegar al PUT.
- Ninguna env var nueva puede ser `NEXT_PUBLIC_*` — rompería el modelo de proxy (URLs horneadas en el bundle del browser).
- Tests frontend: vitest puro sobre módulos de lógica (no hay @testing-library; no agregarla). Los componentes se mantienen finos y la lógica vive en `lib/`.
- Archivos chicos: si un componente supera ~300 líneas, dividirlo (el editor de flows se divide en `components/console/flow-editor/`).
- Correr tests con `pnpm test` (vitest run) y types con `pnpm typecheck`; ambos livianos, no necesitan systemd-run.
- El repo tiene MUCHOS archivos untracked ajenos a este trabajo (cmd/, internal/, tasks/, etc.). `git add` siempre por ruta explícita, nunca `git add -A` ni `git add .`.

## File Structure

```
app/api/system-status/route.ts        (nuevo)  probe server-side de api/opencode/mcp/runs
lib/use-system-status.ts              (nuevo)  hook cliente con polling 30s
components/console/system-status.tsx  (nuevo)  StatusStrip (sidebar) + BackendBanner (reusable)
components/console/console-sidebar.tsx (mod)   monta StatusStrip
lib/chat-parts.ts                     (nuevo)  puro: eventos/mensajes opencode → modelo de chat UI
lib/__tests__/chat-parts.test.ts      (nuevo)
components/console/global-chat.tsx    (mod)    streaming SSE, historial, banner, links a runs
deploy/opencode.json                  (mod)    prompt con path absoluto
deploy/orquesta-entrypoint.sh         (mod)    render de /data/opencode.json con ORQUESTA_CHAT_MODEL
deploy/supervisord.conf               (mod)    OPENCODE_CONFIG=/data/opencode.json
deploy/docker-compose.yml             (mod)    passthrough ORQUESTA_CHAT_MODEL
lib/flow-steps.ts                     (nuevo)  puro: ops de árbol de steps por path
lib/__tests__/flow-steps.test.ts      (nuevo)
lib/flow-validate.ts                  (nuevo)  puro: espejo de validate_flow_steps + parser de locators
lib/__tests__/flow-validate.test.ts   (nuevo)
lib/flow-json.ts                      (nuevo)  puro: FlowDefinition ⇄ JSON shape del engine
lib/__tests__/flow-json.test.ts       (nuevo)
lib/flow-graph.ts                     (nuevo)  puro: steps → nodos/aristas con layout calculado
lib/__tests__/flow-graph.test.ts      (nuevo)
components/console/flow-editor/step-fields.tsx (nuevo)  campos por tipo de step (extraídos de flow-manager)
components/console/flow-editor/form-view.tsx   (nuevo)  pestaña Formulario (lista actual de steps)
components/console/flow-editor/graph-view.tsx  (nuevo)  pestaña Grafo (React Flow + panel lateral)
components/console/flow-editor/json-view.tsx   (nuevo)  pestaña JSON (CodeMirror + Aplicar)
components/console/flow-manager.tsx   (mod)    tabs + estado compartido + save + 422→highlight
app/dashboard/layout.tsx              (mod)    ControlPlaneBanner sobre children
deploy/smoke.sh                       (nuevo)  smoke test ejecutable del contenedor
deploy/README.md                      (mod)    env vars nuevas + smoke
```

Rutas de referencia ya existentes (no se modifican): `app/opencode/[...path]/route.ts` (proxy SSE-capaz), `app/api/control-plane/[...path]/route.ts`, `orquesta_api/routers/flows.py` (PUT revalida con `validate_flow_steps`), `orquesta_api/mcp/server.py` (tools `launch_flow`, `start_watch_daemon` devuelven el Run con `id`).

---

### Task 1: Endpoint de system-status + strip en sidebar

**Files:**
- Create: `app/api/system-status/route.ts`
- Create: `lib/use-system-status.ts`
- Create: `components/console/system-status.tsx`
- Modify: `components/console/console-sidebar.tsx` (montar strip al fondo del aside)

**Interfaces:**
- Produces: `GET /api/system-status` → `SystemStatus = { api: "up" | "down"; opencode: "up" | "down"; mcp: "up" | "down"; activeRuns: number | null }`
- Produces: `useSystemStatus(): { status: SystemStatus | null; refresh: () => void }` (status null mientras carga; polling 30s) en `lib/use-system-status.ts`
- Produces: `<BackendBanner label={string} hint={string} onRetry={() => void} />` y `<SystemStatusStrip />` en `components/console/system-status.tsx`
- Consumes: `orquestaApiBaseURL()` de `lib/orq-lite.ts`

- [ ] **Step 1: Crear la ruta `/api/system-status`**

```ts
// app/api/system-status/route.ts
import { NextResponse } from "next/server"
import { orquestaApiBaseURL } from "@/lib/orq-lite"

export const dynamic = "force-dynamic"

export interface SystemStatus {
  api: "up" | "down"
  opencode: "up" | "down"
  mcp: "up" | "down"
  activeRuns: number | null
}

// "up" exige respuesta HTTP 2xx.
async function probeOk(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch {
    return false
  }
}

// El MCP es JSON-RPC sobre POST: un GET devuelve 4xx, pero cualquier respuesta
// HTTP prueba que el proceso está vivo — solo el error de red cuenta como caído.
async function probeAlive(url: string): Promise<boolean> {
  try {
    await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(2000) })
    return true
  } catch {
    return false
  }
}

async function countActiveRuns(baseURL: string): Promise<number | null> {
  try {
    const token = process.env.ORQUESTA_API_TOKEN
    const res = await fetch(`${baseURL}/runs`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2000),
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
    if (!res.ok) return null
    const runs = (await res.json()) as Array<{ state?: string }>
    return runs.filter((r) => r.state === "running").length
  } catch {
    return null
  }
}

export async function GET() {
  const apiBase = orquestaApiBaseURL()
  const opencodeBase = (process.env.OPENCODE_SERVER_URL ?? "http://127.0.0.1:4096").replace(/\/$/, "")
  const mcpBase = (process.env.ORQUESTA_MCP_URL ?? "http://127.0.0.1:8765").replace(/\/$/, "")

  const [api, opencode, mcp, activeRuns] = await Promise.all([
    apiBase ? probeOk(`${apiBase}/health`) : Promise.resolve(false),
    probeOk(`${opencodeBase}/config`),
    probeAlive(`${mcpBase}/mcp`),
    apiBase ? countActiveRuns(apiBase) : Promise.resolve(null),
  ])

  const status: SystemStatus = {
    api: api ? "up" : "down",
    opencode: opencode ? "up" : "down",
    mcp: mcp ? "up" : "down",
    activeRuns,
  }
  return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } })
}
```

- [ ] **Step 2: Crear el hook de polling**

```ts
// lib/use-system-status.ts
"use client"

import { useEffect, useState } from "react"
import type { SystemStatus } from "@/app/api/system-status/route"

const POLL_MS = 30_000

export type { SystemStatus }

export function useSystemStatus(): { status: SystemStatus | null; refresh: () => void } {
  const [status, setStatus] = useState<SystemStatus | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let active = true
    async function poll() {
      try {
        const res = await fetch("/api/system-status", { cache: "no-store" })
        if (active && res.ok) setStatus((await res.json()) as SystemStatus)
      } catch {
        // la propia ruta está caída — conservar el último estado conocido
      }
    }
    void poll()
    const id = setInterval(poll, POLL_MS)
    return () => {
      active = false
      clearInterval(id)
    }
  }, [tick])

  return { status, refresh: () => setTick((t) => t + 1) }
}
```

- [ ] **Step 3: Crear strip + banner**

```tsx
// components/console/system-status.tsx
"use client"

import { AlertTriangle, RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useSystemStatus } from "@/lib/use-system-status"

const SERVICES = [
  { key: "api", label: "control plane" },
  { key: "opencode", label: "opencode" },
  { key: "mcp", label: "mcp" },
] as const

export function SystemStatusStrip() {
  const { status } = useSystemStatus()
  return (
    <div className="border-t border-border px-5 py-3">
      <div className="flex items-center gap-3">
        {SERVICES.map((s) => {
          const state = status?.[s.key]
          return (
            <span key={s.key} title={`${s.label}: ${state ?? "checking"}`} className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  state === "up" && "bg-emerald-500",
                  state === "down" && "bg-red-500",
                  !state && "bg-muted-foreground/40",
                )}
              />
              {s.label}
            </span>
          )
        })}
      </div>
      {typeof status?.activeRuns === "number" && (
        <p className="mt-1.5 font-mono text-[10px] text-muted-foreground">{status.activeRuns} active run{status.activeRuns === 1 ? "" : "s"}</p>
      )}
    </div>
  )
}

export function BackendBanner({ label, hint, onRetry }: { label: string; hint: string; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
      <div className="min-w-0 flex-1">
        <p className="font-mono text-sm font-semibold">{label}</p>
        <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
      </div>
      {onRetry && (
        <Button size="sm" variant="outline" className="shrink-0 font-mono text-xs" onClick={onRetry}>
          <RefreshCw className="h-3.5 w-3.5" />
          Reintentar
        </Button>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Montar el strip en el sidebar**

En `components/console/console-sidebar.tsx`: importar `SystemStatusStrip` y renderizarlo como último hijo del `<aside>`, después del bloque de proyectos, empujado al fondo. El `<aside>` ya es `flex-col`; envolver la lista de proyectos existente para que el strip quede abajo:

```tsx
import { SystemStatusStrip } from "@/components/console/system-status"
```

y como último elemento dentro del `<aside>` (agregar `mt-auto` para anclarlo):

```tsx
      <div className="mt-auto">
        <SystemStatusStrip />
      </div>
    </aside>
```

- [ ] **Step 5: Verificar**

Run: `pnpm typecheck && pnpm lint`
Expected: sin errores.

Run (con el dev server corriendo — `pnpm dev` en background si no está): `curl -s http://127.0.0.1:3000/api/system-status | jq .`
Expected (sin backends corriendo): `{"api":"down","opencode":"down","mcp":"down","activeRuns":null}`. Con el sidebar abierto en el browser, tres puntos rojos.

- [ ] **Step 6: Commit**

```bash
git add app/api/system-status/route.ts lib/use-system-status.ts components/console/system-status.tsx components/console/console-sidebar.tsx
git commit -m "feat(console): system status endpoint, sidebar strip and backend banner"
```

---

### Task 2: Chat — reproducir el crash, blindar la página y banner de opencode caído

El síntoma reportado: `/dashboard/chat` "tira directamente un error" en el contenedor all-in-one. Dos causas conocidas/candidatas: (a) imagen vieja sin el fix de `crypto.randomUUID` (`lib/utils.ts:uid` ya lo arregla en main — commit 21d3962); (b) `node_modules` local incompleto (faltaba `@opencode-ai/sdk` hasta que se corrió `pnpm install` durante el planning). El objetivo de esta task es confirmar la causa real en el contenedor y garantizar por código que la página **nunca** crashea aunque un backend falte.

**Files:**
- Modify: `components/console/global-chat.tsx` (solo lo mínimo de esta task: banner + guardas; el rewrite de streaming es Task 4)

**Interfaces:**
- Consumes: `useSystemStatus()` y `BackendBanner` de Task 1.

- [ ] **Step 1: Reproducir en el contenedor**

```bash
cd deploy
mkdir -p ../.tmp/logs/docker-build
ts=$(date +%Y-%m-%dT%H-%M-%S)
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 -p CPUQuota=400% \
  /usr/bin/time -v -o "../.tmp/logs/docker-build/${ts}_wall-stats.log" \
  docker compose build 2>&1 | tail -20
docker compose up -d
```

Abrir `http://127.0.0.1:3000/dashboard/chat` en el browser. Registrar: (1) ¿renderiza o muestra el error boundary?, (2) consola del browser, (3) `docker logs deploy-orquesta-1 2>&1 | grep -iA5 error | tail -40`.
Expected: con la imagen rebuildeada desde main actual, el crash de `crypto.randomUUID` ya no ocurre. Si aparece OTRO error, anotar el stack y corregir la causa raíz antes de seguir (es un hallazgo nuevo: reportarlo en el commit).

- [ ] **Step 2: Blindar GlobalChat con el banner**

En `components/console/global-chat.tsx`, agregar al componente (sin tocar todavía la lógica de send):

```tsx
import { useSystemStatus } from "@/lib/use-system-status"
import { BackendBanner } from "@/components/console/system-status"
```

Dentro de `GlobalChat`, arriba del `return`:

```tsx
const { status, refresh } = useSystemStatus()
const opencodeDown = status !== null && status.opencode === "down"
```

En el JSX, inmediatamente después del header (`{!compact && (...)}`), insertar:

```tsx
{opencodeDown && (
  <div className="p-4">
    <BackendBanner
      label="opencode no está corriendo"
      hint="El chat necesita el servidor opencode (OPENCODE_SERVER_URL). En el contenedor: revisá `docker logs` — supervisord debería mantenerlo vivo en :4096."
      onRetry={refresh}
    />
  </div>
)}
```

Y deshabilitar el envío cuando está caído: en el `<Button type="submit" ... disabled={loading || !input.trim()}` agregar `|| opencodeDown`, y en `send()` retornar temprano si `opencodeDown`.

- [ ] **Step 3: Verificar página con backends caídos**

Run: `pnpm typecheck && pnpm lint`
Expected: sin errores.

Con `pnpm dev` corriendo y SIN opencode: abrir `http://127.0.0.1:3000/dashboard/chat`.
Expected: la página renderiza, muestra el banner ámbar "opencode no está corriendo", el botón de enviar está deshabilitado. Nada de error boundary.

- [ ] **Step 4: Commit**

```bash
git add components/console/global-chat.tsx
git commit -m "fix(chat): never crash the chat page — banner + disabled send when opencode is down"
```

---

### Task 3: `lib/chat-parts.ts` — modelo puro del chat (TDD)

Módulo puro que convierte mensajes/eventos de opencode al modelo que renderiza la UI. Toda la lógica de streaming vive acá, testeada; `GlobalChat` (Task 4) queda como orquestación fina.

**Files:**
- Create: `lib/chat-parts.ts`
- Test: `lib/__tests__/chat-parts.test.ts`

**Interfaces:**
- Consumes: `type Part` de `@opencode-ai/sdk/client` (re-exporta los tipos generados; `TextPart` tiene `{id, sessionID, messageID, type:"text", text, synthetic?, ignored?}`, `ToolPart` tiene `{id, ..., type:"tool", callID, tool, state: {status: "pending"|"running"|"completed"|"error", output?, ...}}`).
- Produces (para Task 4):

```ts
export interface ChatRunLink { runId: string; projectId?: string }
export type ChatPart =
  | { kind: "text"; id: string; text: string }
  | { kind: "tool"; id: string; name: string; status: "pending" | "running" | "completed" | "error"; link?: ChatRunLink }
export interface ChatTurn { id: string; role: "user" | "assistant"; parts: ChatPart[] }

export function turnsFromHistory(entries: Array<{ info: { id: string; role: string }; parts: Part[] }>): ChatTurn[]
export function applyPartUpdate(turns: ChatTurn[], part: Part): ChatTurn[]
export function runLinkFromTool(tool: string, output: string): ChatRunLink | null
export function localUserTurn(id: string, text: string): ChatTurn
```

- [ ] **Step 1: Escribir los tests que fallan**

```ts
// lib/__tests__/chat-parts.test.ts
import { describe, expect, it } from "vitest"
import type { Part } from "@opencode-ai/sdk/client"
import { applyPartUpdate, localUserTurn, runLinkFromTool, turnsFromHistory } from "@/lib/chat-parts"

function textPart(over: Partial<Extract<Part, { type: "text" }>> = {}): Part {
  return {
    id: "prt_1",
    sessionID: "ses_1",
    messageID: "msg_1",
    type: "text",
    text: "hola",
    ...over,
  } as Part
}

function toolPart(over: Record<string, unknown> = {}): Part {
  return {
    id: "prt_t1",
    sessionID: "ses_1",
    messageID: "msg_1",
    type: "tool",
    callID: "call_1",
    tool: "orquesta_launch_flow",
    state: { status: "running", input: {}, time: { start: 1 } },
    ...over,
  } as Part
}

describe("applyPartUpdate", () => {
  it("creates an assistant turn keyed by messageID and renders text", () => {
    const turns = applyPartUpdate([], textPart())
    expect(turns).toHaveLength(1)
    expect(turns[0]).toMatchObject({ id: "msg_1", role: "assistant" })
    expect(turns[0].parts).toEqual([{ kind: "text", id: "prt_1", text: "hola" }])
  })

  it("replaces the text of an existing part on re-update (streaming)", () => {
    let turns = applyPartUpdate([], textPart({ text: "ho" }))
    turns = applyPartUpdate(turns, textPart({ text: "hola mundo" }))
    expect(turns[0].parts).toEqual([{ kind: "text", id: "prt_1", text: "hola mundo" }])
  })

  it("keeps parts in first-seen order and tracks tool status transitions", () => {
    let turns = applyPartUpdate([], textPart({ id: "prt_a", text: "voy a lanzar el flow" }))
    turns = applyPartUpdate(turns, toolPart())
    turns = applyPartUpdate(
      turns,
      toolPart({
        state: {
          status: "completed",
          input: {},
          output: JSON.stringify({ id: "run_9", project_id: "prm", state: "running" }),
          title: "launch_flow",
          metadata: {},
          time: { start: 1, end: 2 },
        },
      }),
    )
    expect(turns[0].parts.map((p) => p.kind)).toEqual(["text", "tool"])
    const tool = turns[0].parts[1]
    expect(tool).toMatchObject({ kind: "tool", name: "orquesta_launch_flow", status: "completed" })
    expect(tool.kind === "tool" && tool.link).toEqual({ runId: "run_9", projectId: "prm" })
  })

  it("ignores synthetic/ignored text and non text/tool parts", () => {
    let turns = applyPartUpdate([], textPart({ synthetic: true }))
    turns = applyPartUpdate(turns, { id: "p", sessionID: "ses_1", messageID: "msg_1", type: "step-start" } as Part)
    expect(turns).toHaveLength(0)
  })

  it("does not touch user turns added locally", () => {
    const user = localUserTurn("local-1", "listá mis proyectos")
    const turns = applyPartUpdate([user], textPart({ messageID: "msg_2" }))
    expect(turns[0]).toBe(user)
    expect(turns[1].id).toBe("msg_2")
  })
})

describe("turnsFromHistory", () => {
  it("maps user and assistant messages, dropping empty turns", () => {
    const turns = turnsFromHistory([
      { info: { id: "m1", role: "user" }, parts: [textPart({ id: "p1", messageID: "m1", text: "hola" })] },
      { info: { id: "m2", role: "assistant" }, parts: [textPart({ id: "p2", messageID: "m2", text: "hola!" }), toolPart({ id: "p3", messageID: "m2" })] },
      { info: { id: "m3", role: "assistant" }, parts: [{ id: "p4", sessionID: "s", messageID: "m3", type: "step-start" } as Part] },
    ])
    expect(turns.map((t) => t.id)).toEqual(["m1", "m2"])
    expect(turns[1].parts).toHaveLength(2)
  })
})

describe("runLinkFromTool", () => {
  it("extracts run id + project from an orquesta launch tool output", () => {
    expect(runLinkFromTool("orquesta_launch_flow", JSON.stringify({ id: "run_1", project_id: "prm" }))).toEqual({ runId: "run_1", projectId: "prm" })
  })
  it("returns null for non-run tools or unparseable output", () => {
    expect(runLinkFromTool("orquesta_list_projects", JSON.stringify({ id: "x" }))).toBeNull()
    expect(runLinkFromTool("orquesta_launch_flow", "not json")).toBeNull()
  })
})
```

- [ ] **Step 2: Correr los tests y verlos fallar**

Run: `pnpm test -- lib/__tests__/chat-parts.test.ts`
Expected: FAIL — `Cannot find module '@/lib/chat-parts'` (o equivalente). Nota: si vitest no resuelve el alias `@/`, agregar en `vitest.config.ts` (o crear uno si no existe) `resolve: { alias: { "@": new URL(".", import.meta.url).pathname } }` — los tests existentes de `components/office/__tests__` usan imports relativos, así que puede faltar.

- [ ] **Step 3: Implementar `lib/chat-parts.ts`**

```ts
// lib/chat-parts.ts
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
```

- [ ] **Step 4: Correr los tests y verlos pasar**

Run: `pnpm test -- lib/__tests__/chat-parts.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/chat-parts.ts lib/__tests__/chat-parts.test.ts vitest.config.ts
git commit -m "feat(chat): pure chat-parts model — history mapping, part upserts, run links"
```

(Omitir `vitest.config.ts` del add si no hizo falta crearlo/tocarlo.)

---

### Task 4: GlobalChat — streaming SSE, historial persistente y links a runs

**Files:**
- Modify: `components/console/global-chat.tsx` (rewrite del cuerpo; conserva el header, sugerencias, form y estilos actuales)

**Interfaces:**
- Consumes: `applyPartUpdate`, `turnsFromHistory`, `localUserTurn`, `ChatTurn` de `lib/chat-parts.ts`; `useSystemStatus`/`BackendBanner` (Tasks 1-2); `uid` de `lib/utils.ts`.
- Consumes (SDK 1.17.13): `client.event.subscribe()` → `Promise<{ stream: AsyncGenerator<Event> }>`; eventos `{ type: "message.part.updated", properties: { part: Part } }`; `client.session.messages({ path: { id } })` → `{ data: Array<{ info: Message; parts: Part[] }> }`; `client.session.prompt({ path: { id }, body: { agent, parts } })`.

- [ ] **Step 1: Reescribir el componente**

Reemplazar el contenido de `components/console/global-chat.tsx` por:

```tsx
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

const suggestions = [
  "What projects need attention?",
  "List my projects",
  "Enable the PR watcher on prm",
  "Launch factory_fast on prm",
]

// El browser habla con el opencode loopback a través del proxy same-origin
// /opencode (app/opencode/[...path]/route.ts). El agente `orquesta`
// (deploy/opencode.json) opera el control plane vía sus tools MCP.
const AGENT = "orquesta"
const SESSION_KEY = "orquesta.chat.session"

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

export function GlobalChat({ compact = false }: { compact?: boolean }) {
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const { status, refresh } = useSystemStatus()
  const opencodeDown = status !== null && status.opencode === "down"
  const scrollRef = useRef<HTMLDivElement>(null)
  const clientRef = useRef<OpencodeClient | null>(null)
  const sessionRef = useRef<string | null>(null)

  function client(): OpencodeClient {
    if (!clientRef.current) clientRef.current = createOpencodeClient({ baseUrl: "/opencode" })
    return clientRef.current
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [turns, sending])

  // Restaurar la conversación previa: opencode persiste las sesiones, nosotros
  // solo recordamos el id en localStorage.
  useEffect(() => {
    const stored = localStorage.getItem(SESSION_KEY)
    if (!stored) return
    sessionRef.current = stored
    client()
      .session.messages({ path: { id: stored } })
      .then((res) => {
        if (res.data) setTurns(turnsFromHistory(res.data as Array<{ info: { id: string; role: string }; parts: Part[] }>))
      })
      .catch(() => {
        sessionRef.current = null
        localStorage.removeItem(SESSION_KEY)
      })
  }, [])

  // Streaming: el feed SSE global de opencode emite message.part.updated con
  // cada delta de texto y transición de tool — filtramos por nuestra sesión.
  // Si el stream no está disponible, send() igual renderiza el turno completo
  // al resolver (fallback sin streaming).
  useEffect(() => {
    let active = true
    let stream: AsyncGenerator<unknown> | null = null
    async function listen() {
      try {
        const events = await client().event.subscribe()
        stream = events.stream as AsyncGenerator<unknown>
        for await (const event of events.stream) {
          if (!active) break
          const ev = event as { type?: string; properties?: { part?: Part } }
          if (ev.type !== "message.part.updated") continue
          const part = ev.properties?.part
          if (!part || part.sessionID !== sessionRef.current) continue
          setTurns((prev) => applyPartUpdate(prev, part))
        }
      } catch {
        // sin SSE seguimos funcionando en modo respuesta-completa
      }
    }
    void listen()
    return () => {
      active = false
      void stream?.return?.(undefined)
    }
  }, [])

  async function ensureSession(): Promise<string> {
    if (sessionRef.current) return sessionRef.current
    const created = await client().session.create({ body: {} })
    const id = (created.data as { id?: string } | undefined)?.id
    if (!id) throw new Error("could not create an opencode session")
    sessionRef.current = id
    localStorage.setItem(SESSION_KEY, id)
    return id
  }

  function resetConversation() {
    sessionRef.current = null
    localStorage.removeItem(SESSION_KEY)
    setTurns([])
    setSendError(null)
  }

  async function send(text: string) {
    const content = text.trim()
    if (!content || sending || opencodeDown) return
    setTurns((prev) => [...prev, localUserTurn(uid(), content)])
    setInput("")
    setSending(true)
    setSendError(null)

    try {
      const sessionID = await ensureSession()
      const result = await client().session.prompt({
        path: { id: sessionID },
        body: { agent: AGENT, parts: [{ type: "text", text: content }] },
      })
      if (result.error) throw new Error(JSON.stringify(result.error))
      // Reconciliación final (idempotente): si el SSE se perdió algo, los
      // parts del resultado completan el turno.
      const parts = ((result.data as { parts?: Part[] } | undefined)?.parts ?? []) as Part[]
      setTurns((prev) => parts.reduce(applyPartUpdate, prev))
    } catch (err) {
      setSendError(err instanceof Error ? err.message : String(err))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      {!compact && (
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="font-mono text-sm font-semibold">Orquesta agent</span>
          <Button size="sm" variant="ghost" className="ml-auto font-mono text-[11px] text-muted-foreground" onClick={resetConversation}>
            <Plus className="h-3.5 w-3.5" /> nueva conversación
          </Button>
        </div>
      )}

      {opencodeDown && (
        <div className="p-4">
          <BackendBanner
            label="opencode no está corriendo"
            hint="El chat necesita el servidor opencode (OPENCODE_SERVER_URL). En el contenedor: revisá `docker logs` — supervisord debería mantenerlo vivo en :4096."
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
              No se pudo completar el turno: {sendError}
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
```

Nota para el implementador: el subtítulo `opencode · orquesta` del header original fue reemplazado por el botón "nueva conversación". El tipo `ChatMessage` de `lib/types.ts` deja de usarse aquí — NO borrarlo (lo usa el backend Python via mirror de tipos; verificar con `rg "ChatMessage" --type ts` que no queden otros usos front antes de decidir).

- [ ] **Step 2: Verificación estática**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: todo verde (los tests de chat-parts siguen pasando).

- [ ] **Step 3: Verificación manual con opencode real**

```bash
# Terminal A — opencode local con la config del deploy (necesita estar logueado en opencode):
OPENCODE_CONFIG=$(pwd)/deploy/opencode.json opencode serve --hostname 127.0.0.1 --port 4096
# Terminal B — el dev server (si no está ya corriendo):
pnpm dev
```

En el browser (`/dashboard/chat`): mandar "List my projects".
Expected: el texto va apareciendo incrementalmente (no todo junto al final); si el agente usa una tool, aparece el chip con spinner → check verde. Nota: sin el control plane corriendo, las tools MCP fallarán — el chip termina en error, eso ES el comportamiento correcto para este test. Recargar la página: la conversación sigue ahí. "nueva conversación" la limpia.

- [ ] **Step 4: Commit**

```bash
git add components/console/global-chat.tsx
git commit -m "feat(chat): live SSE streaming, persistent history and run links in tool chips"
```

---

### Task 5: Modelo del agente de chat configurable en el deploy

**Files:**
- Modify: `deploy/opencode.json` (prompt con path absoluto)
- Modify: `deploy/orquesta-entrypoint.sh` (render de `/data/opencode.json`)
- Modify: `deploy/supervisord.conf` (`OPENCODE_CONFIG=/data/opencode.json`)
- Modify: `deploy/docker-compose.yml` (passthrough de `ORQUESTA_CHAT_MODEL`)

**Interfaces:**
- Produces: env var `ORQUESTA_CHAT_MODEL` (opcional; default = el modelo que ya está en `deploy/opencode.json`).

- [ ] **Step 1: Path absoluto del prompt en opencode.json**

En `deploy/opencode.json`, cambiar:

```json
"prompt": "{file:./orquesta-agent.md}",
```

por:

```json
"prompt": "{file:/etc/orquesta/orquesta-agent.md}",
```

(la config se va a leer desde `/data`, así que el path relativo dejaría de resolver).

- [ ] **Step 2: Render en el entrypoint**

En `deploy/orquesta-entrypoint.sh`, después del bloque de seed de flows.json y antes del bloque de orq-lite update, insertar:

```bash
# --- opencode chat agent config ----------------------------------------------
# El modelo del agente de chat es overrideable por env (ORQUESTA_CHAT_MODEL) sin
# rebuild: renderizamos la config de la imagen a /data aplicando el override.
# supervisord apunta OPENCODE_CONFIG a /data/opencode.json.
if [ -n "${ORQUESTA_CHAT_MODEL:-}" ]; then
  jq --arg m "$ORQUESTA_CHAT_MODEL" '.agent.orquesta.model = $m' \
    /etc/orquesta/opencode.json > /data/opencode.json
  echo "opencode: chat agent model => $ORQUESTA_CHAT_MODEL"
else
  cp /etc/orquesta/opencode.json /data/opencode.json
fi
```

- [ ] **Step 3: supervisord + compose**

En `deploy/supervisord.conf`, `[program:opencode]`, cambiar `OPENCODE_CONFIG="/etc/orquesta/opencode.json"` por `OPENCODE_CONFIG="/data/opencode.json"`.

En `deploy/docker-compose.yml`, en `environment:`, después de `OPENCODE_SERVER_URL`, agregar:

```yaml
      # Modelo del agente de chat (opcional). Ej: "anthropic/claude-sonnet-4-6".
      # Sin setear usa el default de deploy/opencode.json.
      ORQUESTA_CHAT_MODEL: "${ORQUESTA_CHAT_MODEL:-}"
```

- [ ] **Step 4: Verificar**

```bash
cd deploy && docker compose config >/dev/null && echo "compose OK"
bash -n orquesta-entrypoint.sh && echo "entrypoint syntax OK"
jq . opencode.json >/dev/null && echo "opencode.json OK"
```

Expected: los tres OK. Verificación completa en contenedor (rebuild) queda para Task 15 (smoke) — anotar en el commit que el render se prueba ahí.

- [ ] **Step 5: Commit**

```bash
git add deploy/opencode.json deploy/orquesta-entrypoint.sh deploy/supervisord.conf deploy/docker-compose.yml
git commit -m "feat(deploy): ORQUESTA_CHAT_MODEL env override for the chat agent model"
```

---

### Task 6: `lib/flow-steps.ts` — operaciones de árbol de steps (TDD)

Los steps de un flow forman un árbol (los `loop`/`retry_until` anidan `body`). Todas las mutaciones del editor (grafo y formulario) pasan por estas operaciones inmutables indexadas por **path** (`number[]`: índices en cada nivel de anidamiento).

**Files:**
- Create: `lib/flow-steps.ts`
- Test: `lib/__tests__/flow-steps.test.ts`

**Interfaces:**
- Consumes: `FlowStep` de `lib/types.ts`.
- Produces:

```ts
export type StepPath = number[]
export function getStepAt(steps: FlowStep[], path: StepPath): FlowStep | undefined
export function updateStepAt(steps: FlowStep[], path: StepPath, patch: Partial<FlowStep>): FlowStep[]
export function insertStepAt(steps: FlowStep[], path: StepPath, step: FlowStep): FlowStep[]   // inserta EN la posición path
export function removeStepAt(steps: FlowStep[], path: StepPath): FlowStep[]
export function moveStep(steps: FlowStep[], path: StepPath, dir: -1 | 1): FlowStep[]          // swap con el hermano
export function appendToBody(steps: FlowStep[], path: StepPath, step: FlowStep): FlowStep[]   // agrega al body del container en path
export function emptyStep(): FlowStep
```

- [ ] **Step 1: Tests que fallan**

```ts
// lib/__tests__/flow-steps.test.ts
import { describe, expect, it } from "vitest"
import type { FlowStep } from "@/lib/types"
import { appendToBody, getStepAt, insertStepAt, moveStep, removeStepAt, updateStepAt } from "@/lib/flow-steps"

const nested: FlowStep[] = [
  { type: "command", command: "go build ./..." },
  {
    type: "loop",
    iterator: "{features_queue}",
    as: "feature",
    body: [
      { type: "agent", agent: "coder" },
      { type: "command", command: "go test ./..." },
    ],
  },
  { type: "eval", expression: "{tester_res.pass}" },
]

describe("getStepAt", () => {
  it("resolves top-level and nested paths", () => {
    expect(getStepAt(nested, [0])?.command).toBe("go build ./...")
    expect(getStepAt(nested, [1, 1])?.command).toBe("go test ./...")
    expect(getStepAt(nested, [9])).toBeUndefined()
    expect(getStepAt(nested, [0, 0])).toBeUndefined()
  })
})

describe("updateStepAt", () => {
  it("patches a nested step immutably", () => {
    const out = updateStepAt(nested, [1, 0], { agent: "tester" })
    expect(getStepAt(out, [1, 0])?.agent).toBe("tester")
    expect(getStepAt(nested, [1, 0])?.agent).toBe("coder") // el original no cambia
    expect(out[0]).toBe(nested[0]) // ramas no tocadas se comparten
  })
})

describe("insertStepAt / removeStepAt / appendToBody", () => {
  it("inserts at a top-level position", () => {
    const out = insertStepAt(nested, [1], { type: "action", action: "lint" })
    expect(out).toHaveLength(4)
    expect(out[1].action).toBe("lint")
    expect(out[2].type).toBe("loop")
  })
  it("inserts inside a body", () => {
    const out = insertStepAt(nested, [1, 0], { type: "action", action: "pre" })
    expect(getStepAt(out, [1, 0])?.action).toBe("pre")
    expect(getStepAt(out, [1, 1])?.agent).toBe("coder")
  })
  it("removes a nested step", () => {
    const out = removeStepAt(nested, [1, 0])
    expect(getStepAt(out, [1, 0])?.command).toBe("go test ./...")
  })
  it("appends to a container body", () => {
    const out = appendToBody(nested, [1], { type: "eval", expression: "{x}" })
    expect(getStepAt(out, [1, 2])?.expression).toBe("{x}")
  })
})

describe("moveStep", () => {
  it("swaps with the previous sibling", () => {
    const out = moveStep(nested, [1], -1)
    expect(out[0].type).toBe("loop")
    expect(out[1].type).toBe("command")
  })
  it("is a no-op at the boundary", () => {
    expect(moveStep(nested, [0], -1)).toEqual(nested)
    expect(moveStep(nested, [2], 1)).toEqual(nested)
  })
})
```

- [ ] **Step 2: Correr y ver fallar**

Run: `pnpm test -- lib/__tests__/flow-steps.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar**

```ts
// lib/flow-steps.ts
// Operaciones inmutables sobre el árbol de steps de un flow. Un StepPath es la
// lista de índices por nivel: [1, 0] = steps[1].body[0].
import type { FlowStep } from "@/lib/types"

export type StepPath = number[]

export function emptyStep(): FlowStep {
  // Placeholder válido para que un draft nuevo guarde; el engine rechaza un
  // command vacío ("command steps require exactly one of command/args").
  return { type: "command", command: "echo configure this step" }
}

export function getStepAt(steps: FlowStep[], path: StepPath): FlowStep | undefined {
  const [head, ...rest] = path
  const step = steps[head]
  if (!step || rest.length === 0) return step
  return step.body ? getStepAt(step.body, rest) : undefined
}

function withSiblings(steps: FlowStep[], path: StepPath, edit: (siblings: FlowStep[], index: number) => FlowStep[]): FlowStep[] {
  const [head, ...rest] = path
  if (rest.length === 0) return edit(steps, head)
  const parent = steps[head]
  if (!parent?.body) return steps
  return steps.map((s, i) => (i === head ? { ...parent, body: withSiblings(parent.body!, rest, edit) } : s))
}

export function updateStepAt(steps: FlowStep[], path: StepPath, patch: Partial<FlowStep>): FlowStep[] {
  return withSiblings(steps, path, (siblings, i) =>
    siblings.map((s, j) => (j === i ? { ...s, ...patch } : s)),
  )
}

export function insertStepAt(steps: FlowStep[], path: StepPath, step: FlowStep): FlowStep[] {
  return withSiblings(steps, path, (siblings, i) => [...siblings.slice(0, i), step, ...siblings.slice(i)])
}

export function removeStepAt(steps: FlowStep[], path: StepPath): FlowStep[] {
  return withSiblings(steps, path, (siblings, i) => siblings.filter((_, j) => j !== i))
}

export function moveStep(steps: FlowStep[], path: StepPath, dir: -1 | 1): FlowStep[] {
  return withSiblings(steps, path, (siblings, i) => {
    const j = i + dir
    if (j < 0 || j >= siblings.length) return siblings
    const out = [...siblings]
    ;[out[i], out[j]] = [out[j], out[i]]
    return out
  })
}

export function appendToBody(steps: FlowStep[], path: StepPath, step: FlowStep): FlowStep[] {
  return updateStepAt(steps, path, { body: [...(getStepAt(steps, path)?.body ?? []), step] })
}
```

- [ ] **Step 4: Correr y ver pasar**

Run: `pnpm test -- lib/__tests__/flow-steps.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/flow-steps.ts lib/__tests__/flow-steps.test.ts
git commit -m "feat(flows): immutable path-based step tree operations"
```

---

### Task 7: `lib/flow-validate.ts` — validación espejo del backend (TDD)

Espejo exacto de `orquesta_api/meta/models.py::validate_flow_steps` (mismas reglas y MISMO formato de locator, para que los 422 del servidor mapeen igual que los errores locales).

**Files:**
- Create: `lib/flow-validate.ts`
- Test: `lib/__tests__/flow-validate.test.ts`

**Interfaces:**
- Consumes: `FlowStep` de `lib/types.ts`.
- Produces:

```ts
export interface FlowStepError { step: string; error: string }
export function validateFlowSteps(steps: FlowStep[], path?: string): FlowStepError[]
export function pathFromLocator(locator: string): StepPath   // "steps[1](loop).steps[0](command)" → [1, 0]
```

Reglas (de `_step_type_ok` del backend): `command` → exactamente uno de command/args; `action` → requiere action; `agent` → requiere agent; `loop` → requiere iterator y as; `retry_until` → requiere condition; `eval` → requiere expression. Además `on_failure` solo puede ser vacío/undefined/"continue". Locator: `steps[<i>](<type>)`, anidado con `.` — p. ej. `steps[1](loop).steps[0](command)`.

- [ ] **Step 1: Tests que fallan**

```ts
// lib/__tests__/flow-validate.test.ts
import { describe, expect, it } from "vitest"
import type { FlowStep } from "@/lib/types"
import { pathFromLocator, validateFlowSteps } from "@/lib/flow-validate"

describe("validateFlowSteps", () => {
  it("accepts a valid nested flow", () => {
    const steps: FlowStep[] = [
      { type: "command", command: "go test ./..." },
      { type: "loop", iterator: "{q}", as: "item", body: [{ type: "agent", agent: "coder" }] },
    ]
    expect(validateFlowSteps(steps)).toEqual([])
  })

  it("flags command steps with both or neither of command/args", () => {
    expect(validateFlowSteps([{ type: "command" }])).toEqual([
      { step: "steps[0](command)", error: "command steps require exactly one of command/args" },
    ])
    expect(validateFlowSteps([{ type: "command", command: "x", args: ["y"] }])).toHaveLength(1)
  })

  it("recurses into bodies with the backend's locator format", () => {
    const steps: FlowStep[] = [{ type: "loop", iterator: "{q}", as: "i", body: [{ type: "agent" }] }]
    expect(validateFlowSteps(steps)).toEqual([
      { step: "steps[0](loop).steps[0](agent)", error: "agent steps require 'agent'" },
    ])
  })

  it("flags loop without iterator/as, retry_until without condition, eval without expression, bad on_failure", () => {
    expect(validateFlowSteps([{ type: "loop", body: [] }])).toHaveLength(1)
    expect(validateFlowSteps([{ type: "retry_until", body: [] }])).toHaveLength(1)
    expect(validateFlowSteps([{ type: "eval" }])).toHaveLength(1)
    expect(validateFlowSteps([{ type: "command", command: "x", on_failure: "retry" as "continue" }])).toEqual([
      { step: "steps[0](command)", error: "invalid on_failure 'retry'" },
    ])
  })
})

describe("pathFromLocator", () => {
  it("parses top-level and nested locators", () => {
    expect(pathFromLocator("steps[0](command)")).toEqual([0])
    expect(pathFromLocator("steps[1](loop).steps[0](command)")).toEqual([1, 0])
    expect(pathFromLocator("garbage")).toEqual([])
  })
})
```

- [ ] **Step 2: Correr y ver fallar**

Run: `pnpm test -- lib/__tests__/flow-validate.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar**

```ts
// lib/flow-validate.ts
// Espejo client-side de orquesta_api/meta/models.py::validate_flow_steps.
// Mismas reglas y MISMO formato de locator: los 422 del PUT y los errores
// locales del editor apuntan al step con la misma string.
import type { FlowStep } from "@/lib/types"
import type { StepPath } from "@/lib/flow-steps"

export interface FlowStepError {
  step: string
  error: string
}

const STEP_TYPE_ERROR: Record<string, string> = {
  command: "command steps require exactly one of command/args",
  action: "action steps require 'action'",
  agent: "agent steps require 'agent'",
  loop: "loop steps require 'iterator' and 'as'",
  retry_until: "retry_until steps require 'condition'",
  eval: "eval steps require 'expression'",
}

function stepTypeOk(step: FlowStep): boolean {
  switch (step.type) {
    case "command":
      return Boolean(step.command) !== Boolean(step.args && step.args.length > 0)
    case "action":
      return Boolean(step.action)
    case "agent":
      return Boolean(step.agent)
    case "loop":
      return Boolean(step.iterator && step.as)
    case "retry_until":
      return Boolean(step.condition)
    case "eval":
      return Boolean(step.expression)
    default:
      return true
  }
}

export function validateFlowSteps(steps: FlowStep[], path = ""): FlowStepError[] {
  const errors: FlowStepError[] = []
  steps.forEach((step, index) => {
    const locator = `${path}steps[${index}](${step.type})`
    if (!stepTypeOk(step)) errors.push({ step: locator, error: STEP_TYPE_ERROR[step.type] })
    if (step.body) errors.push(...validateFlowSteps(step.body, `${locator}.`))
    if (step.on_failure !== undefined && step.on_failure !== "" && step.on_failure !== "continue") {
      errors.push({ step: locator, error: `invalid on_failure '${step.on_failure}'` })
    }
  })
  return errors
}

export function pathFromLocator(locator: string): StepPath {
  const path: StepPath = []
  for (const match of locator.matchAll(/steps\[(\d+)\]/g)) {
    path.push(Number(match[1]))
  }
  return path
}
```

Nota: el backend formatea `invalid on_failure 'retry'` con `repr()` de Python (comillas simples); el espejo usa comillas simples para igualar.

- [ ] **Step 4: Correr y ver pasar**

Run: `pnpm test -- lib/__tests__/flow-validate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/flow-validate.ts lib/__tests__/flow-validate.test.ts
git commit -m "feat(flows): client-side mirror of flow step validation with locator parsing"
```

---

### Task 8: `lib/flow-json.ts` — serialización/parseo del shape del engine (TDD)

**Files:**
- Create: `lib/flow-json.ts`
- Test: `lib/__tests__/flow-json.test.ts`
- Modify: `components/console/flow-manager.tsx` — borrar la función local `flowExport` e importar `flowToEngineJson` (ajuste mecánico; el uso real cambia en Task 10).

**Interfaces:**
- Consumes: `FlowDefinition`, `FlowStep` de `lib/types.ts`; `validateFlowSteps` de Task 7.
- Produces:

```ts
export function flowToEngineObject(flow: FlowDefinition): { flows: Record<string, unknown> }
export function flowToEngineJson(flow: FlowDefinition): string   // pretty, 2 espacios
export type ParsedFlow =
  | { ok: true; patch: Pick<FlowDefinition, "description" | "inputs" | "steps"> }
  | { ok: false; errors: string[] }
export function parseFlowJson(text: string, flowId: string): ParsedFlow
```

`parseFlowJson` acepta dos shapes: el wrapper `{flows: {<id>: entry}}` (usa la entrada `flowId` o la única presente) o la entry pelada `{description?, inputs?, steps}`. Valida con `validateFlowSteps` y reporta esos errores como strings `"<locator>: <error>"`.

- [ ] **Step 1: Tests que fallan**

```ts
// lib/__tests__/flow-json.test.ts
import { describe, expect, it } from "vitest"
import type { FlowDefinition } from "@/lib/types"
import { flowToEngineJson, flowToEngineObject, parseFlowJson } from "@/lib/flow-json"

const flow: FlowDefinition = {
  id: "release",
  name: "release",
  description: "ship it",
  entrypoint: "orq-lite flow run release",
  inputs: { tag: { default: "v0" } },
  steps: [{ type: "command", command: "go test ./..." }],
}

describe("flowToEngineObject", () => {
  it("exports exactly the engine keys under flows.<id>", () => {
    expect(flowToEngineObject(flow)).toEqual({
      flows: { release: { description: "ship it", inputs: { tag: { default: "v0" } }, steps: flow.steps } },
    })
  })
  it("omits empty inputs", () => {
    const obj = flowToEngineObject({ ...flow, inputs: {} })
    expect(obj.flows.release).not.toHaveProperty("inputs")
  })
})

describe("parseFlowJson", () => {
  it("round-trips the exported JSON", () => {
    const parsed = parseFlowJson(flowToEngineJson(flow), "release")
    expect(parsed).toEqual({
      ok: true,
      patch: { description: "ship it", inputs: { tag: { default: "v0" } }, steps: flow.steps },
    })
  })
  it("accepts a bare entry without the flows wrapper", () => {
    const parsed = parseFlowJson(JSON.stringify({ description: "d", steps: [{ type: "eval", expression: "{x}" }] }), "release")
    expect(parsed.ok).toBe(true)
  })
  it("reports JSON syntax errors", () => {
    const parsed = parseFlowJson("{nope", "release")
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.errors[0]).toMatch(/JSON/)
  })
  it("reports step validation errors with locators", () => {
    const parsed = parseFlowJson(JSON.stringify({ steps: [{ type: "agent" }] }), "release")
    expect(parsed).toEqual({ ok: false, errors: ["steps[0](agent): agent steps require 'agent'"] })
  })
  it("rejects a wrapper without the flow id and without a single entry", () => {
    const parsed = parseFlowJson(JSON.stringify({ flows: { a: { steps: [] }, b: { steps: [] } } }), "release")
    expect(parsed.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Correr y ver fallar**

Run: `pnpm test -- lib/__tests__/flow-json.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```ts
// lib/flow-json.ts
// FlowDefinition ⇄ el JSON exacto que parsea el engine de orq-lite:
// {flows: {<id>: {description?, inputs?, steps}}}. Ningún campo UI-only
// (id/name/entrypoint/source) entra ni sale de este shape.
import type { FlowDefinition, FlowStep } from "@/lib/types"
import { validateFlowSteps } from "@/lib/flow-validate"

export function flowToEngineObject(flow: FlowDefinition): { flows: Record<string, unknown> } {
  return {
    flows: {
      [flow.id]: {
        description: flow.description,
        ...(flow.inputs && Object.keys(flow.inputs).length > 0 ? { inputs: flow.inputs } : {}),
        steps: flow.steps,
      },
    },
  }
}

export function flowToEngineJson(flow: FlowDefinition): string {
  return JSON.stringify(flowToEngineObject(flow), null, 2)
}

export type ParsedFlow =
  | { ok: true; patch: Pick<FlowDefinition, "description" | "inputs" | "steps"> }
  | { ok: false; errors: string[] }

// ast-grep-ignore
type RawEntry = { description?: string; inputs?: FlowDefinition["inputs"]; steps?: FlowStep[] }

export function parseFlowJson(text: string, flowId: string): ParsedFlow {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (err) {
    return { ok: false, errors: [`JSON inválido: ${err instanceof Error ? err.message : String(err)}`] }
  }
  if (typeof data !== "object" || data === null) {
    return { ok: false, errors: ["JSON inválido: se esperaba un objeto"] }
  }

  let entry: RawEntry
  const wrapper = data as { flows?: Record<string, RawEntry> }
  if (wrapper.flows && typeof wrapper.flows === "object") {
    const keys = Object.keys(wrapper.flows)
    const key = keys.includes(flowId) ? flowId : keys.length === 1 ? keys[0] : null
    if (!key) return { ok: false, errors: [`el wrapper flows no contiene '${flowId}' (tiene: ${keys.join(", ")})`] }
    entry = wrapper.flows[key]
  } else {
    entry = data as RawEntry
  }

  const steps = Array.isArray(entry.steps) ? entry.steps : []
  const stepErrors = validateFlowSteps(steps)
  if (stepErrors.length > 0) {
    return { ok: false, errors: stepErrors.map((e) => `${e.step}: ${e.error}`) }
  }
  return {
    ok: true,
    patch: {
      description: typeof entry.description === "string" ? entry.description : "",
      inputs: entry.inputs && typeof entry.inputs === "object" ? entry.inputs : {},
      steps,
    },
  }
}
```

- [ ] **Step 4: Reemplazar `flowExport` en flow-manager**

En `components/console/flow-manager.tsx`: borrar la función local `flowExport` (líneas ~21-31) y su comentario; cambiar `const selectedJson = useMemo(() => JSON.stringify(selected ? flowExport(selected) : {}, null, 2), [selected])` por:

```ts
import { flowToEngineJson } from "@/lib/flow-json"
// ...
const selectedJson = useMemo(() => (selected ? flowToEngineJson(selected) : "{}"), [selected])
```

- [ ] **Step 5: Correr y ver pasar**

Run: `pnpm test && pnpm typecheck`
Expected: PASS todos los suites.

- [ ] **Step 6: Commit**

```bash
git add lib/flow-json.ts lib/__tests__/flow-json.test.ts components/console/flow-manager.tsx
git commit -m "feat(flows): engine-shape JSON serialize/parse with validation"
```

---

### Task 9: `lib/flow-graph.ts` — layout del grafo (TDD)

Convierte `FlowStep[]` en nodos/aristas con posiciones calculadas para React Flow. Los containers (`loop`/`retry_until` con body) son nodos padre; sus hijos usan posiciones relativas (modelo de subflows de React Flow). Sin persistencia de coordenadas.

**Files:**
- Create: `lib/flow-graph.ts`
- Test: `lib/__tests__/flow-graph.test.ts`

**Interfaces:**
- Consumes: `FlowStep` de `lib/types.ts`; `StepPath` y `getStepAt` de `lib/flow-steps.ts`.
- Produces:

```ts
export interface FlowGraphNode {
  id: string                    // "s" + path.join("-")  (ej: "s1-0")
  path: StepPath
  step: FlowStep
  parentId?: string
  position: { x: number; y: number }
  width: number
  height: number
  container: boolean
}
export interface FlowGraphEdge { id: string; source: string; target: string }
export function nodeId(path: StepPath): string
export function stepSummary(step: FlowStep): string
export function buildFlowGraph(steps: FlowStep[]): { nodes: FlowGraphNode[]; edges: FlowGraphEdge[] }
export const NODE_W: number   // 260
export const NODE_H: number   // 64
```

Layout: columna vertical. Constantes: `NODE_W=260`, `NODE_H=64`, `GAP=24`, `PAD=16`, `HEADER=36` (título del container). Un container mide `width = NODE_W + PAD*2`, `height = HEADER + PAD + sum(alturas hijos) + GAP*(n-1) + PAD` (mínimo un slot vacío `NODE_H` si el body está vacío). Los hijos van en `x=PAD`, `y=HEADER+PAD + offset acumulado`. Los hermanos de nivel superior se apilan en `x=0` con `GAP`. Aristas entre hermanos consecutivos de CADA nivel. Los nodos padre aparecen ANTES que sus hijos en el array (requisito de React Flow).

- [ ] **Step 1: Tests que fallan**

```ts
// lib/__tests__/flow-graph.test.ts
import { describe, expect, it } from "vitest"
import type { FlowStep } from "@/lib/types"
import { buildFlowGraph, NODE_H, NODE_W, nodeId, stepSummary } from "@/lib/flow-graph"

const steps: FlowStep[] = [
  { type: "command", command: "go build ./..." },
  {
    type: "loop",
    iterator: "{q}",
    as: "item",
    body: [
      { type: "agent", agent: "coder" },
      { type: "command", command: "go test ./..." },
    ],
  },
  { type: "eval", expression: "{pass}" },
]

describe("buildFlowGraph", () => {
  const { nodes, edges } = buildFlowGraph(steps)

  it("creates one node per step including nested ones", () => {
    expect(nodes.map((n) => n.id).sort()).toEqual(["s0", "s1", "s1-0", "s1-1", "s2"])
  })

  it("marks containers and parents children to them (parents first)", () => {
    const loop = nodes.find((n) => n.id === "s1")!
    expect(loop.container).toBe(true)
    const child = nodes.find((n) => n.id === "s1-0")!
    expect(child.parentId).toBe("s1")
    expect(nodes.findIndex((n) => n.id === "s1")).toBeLessThan(nodes.findIndex((n) => n.id === "s1-0"))
  })

  it("stacks top-level siblings vertically and children relative to the parent", () => {
    const [a, loop] = [nodes.find((n) => n.id === "s0")!, nodes.find((n) => n.id === "s1")!]
    expect(a.position).toEqual({ x: 0, y: 0 })
    expect(loop.position.y).toBeGreaterThan(a.position.y + a.height)
    const c0 = nodes.find((n) => n.id === "s1-0")!
    const c1 = nodes.find((n) => n.id === "s1-1")!
    expect(c0.position.x).toBeGreaterThan(0)
    expect(c1.position.y).toBeGreaterThan(c0.position.y)
  })

  it("sizes containers to hold their children", () => {
    const loop = nodes.find((n) => n.id === "s1")!
    expect(loop.width).toBeGreaterThan(NODE_W)
    expect(loop.height).toBeGreaterThan(2 * NODE_H)
  })

  it("draws sequential edges per nesting level", () => {
    const pairs = edges.map((e) => `${e.source}->${e.target}`).sort()
    expect(pairs).toEqual(["s0->s1", "s1->s2", "s1-0->s1-1"].sort())
  })

  it("gives an empty container a placeholder slot height", () => {
    const g = buildFlowGraph([{ type: "loop", iterator: "{q}", as: "i", body: [] }])
    expect(g.nodes[0].height).toBeGreaterThanOrEqual(NODE_H)
  })
})

describe("helpers", () => {
  it("nodeId encodes the path", () => {
    expect(nodeId([1, 0])).toBe("s1-0")
  })
  it("stepSummary shows the discriminating field", () => {
    expect(stepSummary({ type: "command", command: "go test ./..." })).toBe("go test ./...")
    expect(stepSummary({ type: "agent", agent: "coder" })).toBe("coder")
    expect(stepSummary({ type: "loop", iterator: "{q}", as: "i" })).toBe("{q} as i")
  })
})
```

- [ ] **Step 2: Correr y ver fallar**

Run: `pnpm test -- lib/__tests__/flow-graph.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```ts
// lib/flow-graph.ts
// Steps → grafo con layout calculado para React Flow. El orden de ejecución es
// el orden de la lista: las aristas se derivan, nunca se editan. Posiciones
// calculadas en cada render — no se persisten (flows.json es del engine).
import type { FlowStep } from "@/lib/types"
import type { StepPath } from "@/lib/flow-steps"

export const NODE_W = 260
export const NODE_H = 64
const GAP = 24
const PAD = 16
const HEADER = 36

export interface FlowGraphNode {
  id: string
  path: StepPath
  step: FlowStep
  parentId?: string
  position: { x: number; y: number }
  width: number
  height: number
  container: boolean
}

export interface FlowGraphEdge {
  id: string
  source: string
  target: string
}

export function nodeId(path: StepPath): string {
  return `s${path.join("-")}`
}

export function stepSummary(step: FlowStep): string {
  switch (step.type) {
    case "command":
      return step.command ?? (step.args ?? []).join(" ")
    case "agent":
      return step.agent ?? ""
    case "action":
      return step.action ?? ""
    case "loop":
      return `${step.iterator ?? "?"} as ${step.as ?? "?"}`
    case "retry_until":
      return step.condition ?? ""
    case "eval":
      return step.expression ?? ""
    default:
      return ""
  }
}

function isContainer(step: FlowStep): boolean {
  return step.type === "loop" || step.type === "retry_until"
}

interface Placed {
  nodes: FlowGraphNode[]
  width: number
  height: number
}

function placeStep(step: FlowStep, path: StepPath, parentId?: string): Placed {
  if (!isContainer(step)) {
    return {
      nodes: [{ id: nodeId(path), path, step, parentId, position: { x: 0, y: 0 }, width: NODE_W, height: NODE_H, container: false }],
      width: NODE_W,
      height: NODE_H,
    }
  }

  const id = nodeId(path)
  const children: FlowGraphNode[] = []
  let y = HEADER + PAD
  let innerWidth = NODE_W
  const body = step.body ?? []
  for (const [i, child] of body.entries()) {
    const placed = placeStep(child, [...path, i], id)
    // el primer nodo de placed es el hijo directo: posicionarlo relativo al padre
    placed.nodes[0] = { ...placed.nodes[0], position: { x: PAD, y } }
    children.push(...placed.nodes)
    y += placed.height + GAP
    innerWidth = Math.max(innerWidth, placed.width)
  }
  const contentHeight = body.length > 0 ? y - GAP : HEADER + PAD + NODE_H
  const height = contentHeight + PAD
  const width = innerWidth + PAD * 2

  const container: FlowGraphNode = {
    id,
    path,
    step,
    parentId,
    position: { x: 0, y: 0 },
    width,
    height,
    container: true,
  }
  return { nodes: [container, ...children], width, height }
}

export function buildFlowGraph(steps: FlowStep[]): { nodes: FlowGraphNode[]; edges: FlowGraphEdge[] } {
  const nodes: FlowGraphNode[] = []
  const edges: FlowGraphEdge[] = []
  let y = 0
  steps.forEach((step, i) => {
    const placed = placeStep(step, [i])
    placed.nodes[0] = { ...placed.nodes[0], position: { x: 0, y } }
    nodes.push(...placed.nodes)
    y += placed.height + GAP
  })

  // Aristas secuenciales por nivel: recorremos los nodos agrupando por parentId.
  const byParent = new Map<string | undefined, FlowGraphNode[]>()
  for (const node of nodes) {
    const list = byParent.get(node.parentId) ?? []
    list.push(node)
    byParent.set(node.parentId, list)
  }
  for (const siblings of byParent.values()) {
    const ordered = [...siblings].sort((a, b) => a.path[a.path.length - 1] - b.path[b.path.length - 1])
    for (let i = 0; i + 1 < ordered.length; i++) {
      edges.push({ id: `${ordered[i].id}->${ordered[i + 1].id}`, source: ordered[i].id, target: ordered[i + 1].id })
    }
  }
  return { nodes, edges }
}
```

- [ ] **Step 4: Correr y ver pasar**

Run: `pnpm test -- lib/__tests__/flow-graph.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/flow-graph.ts lib/__tests__/flow-graph.test.ts
git commit -m "feat(flows): computed vertical graph layout with nested containers"
```

---

### Task 10: Editor — dependencias, pestañas y extracción de step-fields

Reestructura `flow-manager.tsx` en el directorio `flow-editor/` sin cambiar comportamiento: la pestaña **Formulario** queda idéntica a la UI actual. Las pestañas Grafo/JSON se agregan en Tasks 11-12 (acá quedan como placeholders deshabilitados NO — se agregan directamente en sus tasks; esta task solo deja el switcher con la pestaña Formulario activa).

**Files:**
- Modify: `package.json` (deps nuevas)
- Create: `components/console/flow-editor/step-fields.tsx`
- Create: `components/console/flow-editor/form-view.tsx`
- Modify: `components/console/flow-manager.tsx`

**Interfaces:**
- Produces: `<StepFields step={FlowStep} onChange={(patch: Partial<FlowStep>) => void} />` — los campos específicos por tipo (command/args, agent, action, iterator/as, condition/max_retries, expression) + selector de tipo + on_failure. Exactamente los mismos inputs/labels/clases que hoy viven inline en `flow-manager.tsx` líneas ~253-335.
- Produces: `<FormView steps={FlowStep[]} onChange={(steps: FlowStep[]) => void} />` — la lista actual de cards de steps (agregar/eliminar/editar) usando `StepFields` y las ops de `lib/flow-steps.ts`.
- Produces en flow-manager: estado `tab: "graph" | "form" | "json"` (default `"graph"`, pero hasta Task 11 el default es `"form"`).

- [ ] **Step 1: Instalar dependencias**

Run: `pnpm add @xyflow/react @uiw/react-codemirror @codemirror/lang-json`
Expected: agrega las tres al `package.json` sin errores de peer deps (React 19 es soportado por ambas).

- [ ] **Step 2: Extraer `StepFields`**

Crear `components/console/flow-editor/step-fields.tsx` moviendo los bloques por tipo desde `flow-manager.tsx` (el `<select>` de type, el `<select>` de on_failure y los bloques condicionales `step.type === "command" | "agent" | "action" | "loop" | "retry_until" | "eval"`), parametrizados:

```tsx
"use client"

import type { FlowStep, FlowStepType } from "@/lib/types"

const stepTypes: FlowStepType[] = ["command", "agent", "action", "loop", "retry_until", "eval"]

const field = "rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm outline-none focus:border-primary/50"
const label = "font-mono text-[11px] uppercase tracking-wide text-muted-foreground"

export function StepFields({ step, onChange }: { step: FlowStep; onChange: (patch: Partial<FlowStep>) => void }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className={label}>Type</span>
          <select value={step.type} onChange={(e) => onChange({ type: e.target.value as FlowStepType })} className={field}>
            {stepTypes.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>On failure</span>
          <select value={step.on_failure ?? ""} onChange={(e) => onChange({ on_failure: e.target.value as "" | "continue" })} className={field}>
            <option value="">stop</option>
            <option value="continue">continue</option>
          </select>
        </label>
      </div>

      {step.type === "command" && (
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className={label}>Command (shell string)</span>
            <input value={step.command ?? ""} onChange={(e) => { const v = e.target.value; onChange({ command: v || undefined, args: v ? undefined : step.args }) }} placeholder="go test ./..." className={field} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>Args (argv, alternative to command)</span>
            <input value={(step.args ?? []).join(" ")} onChange={(e) => { const args = e.target.value.split(" ").filter(Boolean); onChange({ args: args.length > 0 ? args : undefined, command: args.length > 0 ? undefined : step.command }) }} placeholder="git push -u origin branch" className={field} />
          </label>
          <p className="col-span-full font-mono text-[11px] text-muted-foreground">The engine requires exactly one of command / args — filling one clears the other.</p>
        </div>
      )}

      {step.type === "agent" && (
        <label className="flex flex-col gap-1">
          <span className={label}>Agent role</span>
          <input value={step.agent ?? ""} onChange={(e) => onChange({ agent: e.target.value })} placeholder="coder" className={field} />
        </label>
      )}

      {step.type === "action" && (
        <label className="flex flex-col gap-1">
          <span className={label}>Action</span>
          <input value={step.action ?? ""} onChange={(e) => onChange({ action: e.target.value })} placeholder="factory_extract_features" className={field} />
        </label>
      )}

      {step.type === "loop" && (
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className={label}>Iterator</span>
            <input value={step.iterator ?? ""} onChange={(e) => onChange({ iterator: e.target.value })} placeholder="{features_queue}" className={field} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>As</span>
            <input value={step.as ?? ""} onChange={(e) => onChange({ as: e.target.value })} placeholder="feature" className={field} />
          </label>
        </div>
      )}

      {step.type === "retry_until" && (
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_120px]">
          <label className="flex flex-col gap-1">
            <span className={label}>Condition</span>
            <input value={step.condition ?? ""} onChange={(e) => onChange({ condition: e.target.value })} placeholder="{task_verified} == true" className={field} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>Max retries</span>
            <input type="number" value={step.max_retries ?? 1} onChange={(e) => onChange({ max_retries: Number(e.target.value) })} className={field} />
          </label>
        </div>
      )}

      {step.type === "eval" && (
        <label className="flex flex-col gap-1">
          <span className={label}>Expression</span>
          <input value={step.expression ?? ""} onChange={(e) => onChange({ expression: e.target.value })} placeholder="{lint_res.pass} && {tester_res.pass}" className={field} />
        </label>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Crear `FormView`**

`components/console/flow-editor/form-view.tsx` — la lista de cards actual, ahora vía `StepFields` + ops:

```tsx
"use client"

import { ListPlus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { FlowStep } from "@/lib/types"
import { emptyStep, removeStepAt, updateStepAt } from "@/lib/flow-steps"
import { StepFields } from "./step-fields"

export function FormView({ steps, onChange }: { steps: FlowStep[]; onChange: (steps: FlowStep[]) => void }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-mono text-sm font-semibold uppercase tracking-wide text-muted-foreground">Steps</h2>
        <Button size="sm" variant="outline" className="font-mono text-xs" onClick={() => onChange([...steps, emptyStep()])}>
          <ListPlus />Step
        </Button>
      </div>
      <div className="space-y-3">
        {steps.map((step, index) => (
          <div key={index} className="rounded-lg border border-border bg-background p-4">
            <div className="mb-3 font-mono text-[11px] text-muted-foreground">step {index + 1} of {steps.length}</div>
            <StepFields step={step} onChange={(patch) => onChange(updateStepAt(steps, [index], patch))} />
            {(step.type === "loop" || step.type === "retry_until") && step.body && step.body.length > 0 && (
              <p className="mt-3 font-mono text-[11px] text-muted-foreground">
                {step.body.length} nested step{step.body.length === 1 ? "" : "s"} — editá el body desde la pestaña Grafo.
              </p>
            )}
            <div className="mt-3 flex justify-end">
              <Button size="icon-xs" variant="ghost" title="Remove step" onClick={() => onChange(removeStepAt(steps, [index]))}><X /></Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Convertir flow-manager a pestañas**

En `components/console/flow-manager.tsx`:
- Borrar: `stepTypes`, `emptyStep()` local (importarlo de `@/lib/flow-steps`), `updateStep`, el `useMemo` de `selectedJson`, y todo el bloque JSX de "Steps" (el `<div className="rounded-xl...">` con el map de steps) y el bloque "Export" de solo lectura (la pestaña JSON de Task 12 lo reemplaza).
- El indicador `message` hoy se renderiza dentro del bloque Export: moverlo fuera, como último elemento de la columna derecha, para que sobreviva al borrado:

```tsx
{message && (
  <p className="inline-flex items-center gap-2 font-mono text-xs text-muted-foreground">
    <Play className="h-3.5 w-3.5 text-primary" />{message}
  </p>
)}
```

- Agregar estado `const [tab, setTab] = useState<"graph" | "form" | "json">("form")` (default cambia a `"graph"` en Task 11).
- En el lugar del bloque Steps, renderizar el switcher + la vista activa:

```tsx
<div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1 font-mono text-xs">
  {(["graph", "form", "json"] as const).map((t) => (
    <button
      key={t}
      onClick={() => setTab(t)}
      className={cn(
        "rounded-md px-3 py-1.5 transition-colors",
        tab === t ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {t === "graph" ? "Grafo" : t === "form" ? "Formulario" : "JSON"}
    </button>
  ))}
</div>

{tab === "form" && <FormView steps={selected.steps} onChange={(steps) => updateSelected({ steps })} />}
{tab === "graph" && <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">Grafo — Task 11</p>}
{tab === "json" && <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">JSON — Task 12</p>}
```

(Los dos placeholders se reemplazan en las tasks siguientes; el header con id/entrypoint/CLI/Save/description/inputs y la columna izquierda quedan como están.)

- [ ] **Step 5: Verificar paridad**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: verde. En el browser (`/dashboard/flows`, con el control plane corriendo o con `ORQUESTA_DEMO=1`): la pestaña Formulario se comporta exactamente como la UI previa (editar type/command/etc., agregar/eliminar steps, Save).

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml components/console/flow-editor/step-fields.tsx components/console/flow-editor/form-view.tsx components/console/flow-manager.tsx
git commit -m "refactor(flows): tabbed editor shell with extracted step fields and form view"
```

---

### Task 11: Pestaña Grafo interactiva

**Files:**
- Create: `components/console/flow-editor/graph-view.tsx`
- Modify: `components/console/flow-manager.tsx` (montar GraphView, default tab `"graph"`)

**Interfaces:**
- Consumes: `buildFlowGraph`, `nodeId`, `stepSummary`, `NODE_W/NODE_H` (Task 9); ops de `lib/flow-steps.ts` (Task 6); `StepFields` (Task 10).
- Produces: `<GraphView steps={FlowStep[]} onChange={(steps: FlowStep[]) => void} invalidPaths={StepPath[]} />` — `invalidPaths` se usa en Task 13 (pasar `[]` hasta entonces).

- [ ] **Step 1: Implementar GraphView**

```tsx
// components/console/flow-editor/graph-view.tsx
"use client"

import { useMemo, useState } from "react"
import { ReactFlow, Background, Controls, type Node, type Edge, type NodeProps } from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { ArrowDown, ArrowUp, CornerDownRight, ListPlus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { FlowStep } from "@/lib/types"
import { buildFlowGraph, nodeId, stepSummary, type FlowGraphNode } from "@/lib/flow-graph"
import { appendToBody, emptyStep, getStepAt, insertStepAt, moveStep, removeStepAt, updateStepAt, type StepPath } from "@/lib/flow-steps"
import { StepFields } from "./step-fields"

const TYPE_COLORS: Record<string, string> = {
  command: "border-sky-500/50",
  agent: "border-violet-500/50",
  action: "border-emerald-500/50",
  loop: "border-amber-500/50",
  retry_until: "border-orange-500/50",
  eval: "border-pink-500/50",
}

type StepNodeData = { graph: FlowGraphNode; selected: boolean; invalid: boolean }

function StepNode({ data }: NodeProps<Node<StepNodeData>>) {
  const { graph, selected, invalid } = data
  return (
    <div
      className={cn(
        "h-full w-full rounded-lg border-2 bg-card px-3 py-2 text-left",
        TYPE_COLORS[graph.step.type] ?? "border-border",
        graph.container && "bg-card/40",
        selected && "ring-2 ring-primary",
        invalid && "border-red-500 ring-2 ring-red-500/50",
      )}
    >
      <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">{graph.step.type}</p>
      {!graph.container && <p className="truncate font-mono text-xs">{stepSummary(graph.step) || "—"}</p>}
      {graph.container && <p className="truncate font-mono text-[11px] text-muted-foreground">{stepSummary(graph.step)}</p>}
    </div>
  )
}

const nodeTypes = { step: StepNode }

export function GraphView({
  steps,
  onChange,
  invalidPaths,
}: {
  steps: FlowStep[]
  onChange: (steps: FlowStep[]) => void
  invalidPaths: StepPath[]
}) {
  const [selectedPath, setSelectedPath] = useState<StepPath | null>(null)
  const selectedStep = selectedPath ? getStepAt(steps, selectedPath) : undefined
  const invalidIds = useMemo(() => new Set(invalidPaths.map(nodeId)), [invalidPaths])

  const { nodes, edges } = useMemo(() => {
    const graph = buildFlowGraph(steps)
    const selectedId = selectedPath ? nodeId(selectedPath) : null
    const rfNodes: Node<StepNodeData>[] = graph.nodes.map((n) => ({
      id: n.id,
      type: "step",
      position: n.position,
      data: { graph: n, selected: n.id === selectedId, invalid: invalidIds.has(n.id) },
      parentId: n.parentId,
      extent: n.parentId ? ("parent" as const) : undefined,
      style: { width: n.width, height: n.height },
      draggable: false,
      connectable: false,
    }))
    const rfEdges: Edge[] = graph.edges.map((e) => ({ ...e, animated: false }))
    return { nodes: rfNodes, edges: rfEdges }
  }, [steps, selectedPath, invalidIds])

  function mutate(next: FlowStep[]) {
    onChange(next)
  }

  const isContainer = selectedStep && (selectedStep.type === "loop" || selectedStep.type === "retry_until")

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="h-[560px] rounded-xl border border-border bg-card">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={(_, node) => setSelectedPath((node.data as StepNodeData).graph.path)}
          onPaneClick={() => setSelectedPath(null)}
          fitView
          nodesDraggable={false}
          nodesConnectable={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={16} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

      <div className="space-y-3">
        <Button size="sm" variant="outline" className="w-full font-mono text-xs" onClick={() => mutate([...steps, emptyStep()])}>
          <ListPlus />Agregar step al final
        </Button>

        {selectedPath && selectedStep ? (
          <div className="space-y-4 rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
                step {selectedPath.map((i) => i + 1).join(".")}
              </p>
              <div className="flex items-center gap-1">
                <Button size="icon-xs" variant="ghost" title="Subir" onClick={() => mutate(moveStep(steps, selectedPath, -1))}><ArrowUp /></Button>
                <Button size="icon-xs" variant="ghost" title="Bajar" onClick={() => mutate(moveStep(steps, selectedPath, 1))}><ArrowDown /></Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  title="Eliminar"
                  onClick={() => {
                    mutate(removeStepAt(steps, selectedPath))
                    setSelectedPath(null)
                  }}
                >
                  <X />
                </Button>
              </div>
            </div>

            <StepFields step={selectedStep} onChange={(patch) => mutate(updateStepAt(steps, selectedPath, patch))} />

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="font-mono text-xs" onClick={() => mutate(insertStepAt(steps, selectedPath, emptyStep()))}>
                <ListPlus />Antes
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="font-mono text-xs"
                onClick={() => mutate(insertStepAt(steps, [...selectedPath.slice(0, -1), selectedPath[selectedPath.length - 1] + 1], emptyStep()))}
              >
                <ListPlus />Después
              </Button>
              {isContainer && (
                <Button size="sm" variant="outline" className="font-mono text-xs" onClick={() => mutate(appendToBody(steps, selectedPath, emptyStep()))}>
                  <CornerDownRight />Dentro del body
                </Button>
              )}
            </div>
          </div>
        ) : (
          <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
            Click en un nodo para editarlo. Los loops y retry_until son contenedores: sus steps anidados viven adentro.
          </p>
        )}
      </div>
    </div>
  )
}
```

Nota: al mutar steps, `selectedPath` puede quedar apuntando a otro step (p. ej. tras eliminar o mover) — es aceptable para esta iteración; `getStepAt` devuelve `undefined` si el path quedó fuera de rango y el panel se cierra solo.

- [ ] **Step 2: Montar en flow-manager**

Reemplazar el placeholder de la pestaña graph por:

```tsx
{tab === "graph" && (
  <GraphView steps={selected.steps} onChange={(steps) => updateSelected({ steps })} invalidPaths={[]} />
)}
```

y cambiar el default del estado a `useState<"graph" | "form" | "json">("graph")`.

- [ ] **Step 3: Verificar**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: verde.

Manual (`/dashboard/flows`): el flow `factory` (u otro con loop) se ve como cadena vertical con el loop como contenedor y sus steps adentro; click en un nodo abre el panel; editar un campo se refleja en el nodo; "Dentro del body" agrega un step anidado; ↑/↓ reordena; eliminar saca el nodo; Save persiste (verificar con GET al API o con la pestaña Formulario).

- [ ] **Step 4: Commit**

```bash
git add components/console/flow-editor/graph-view.tsx components/console/flow-manager.tsx
git commit -m "feat(flows): interactive graph editor with nested container bodies"
```

---

### Task 12: Pestaña JSON editable con Aplicar

**Files:**
- Create: `components/console/flow-editor/json-view.tsx`
- Modify: `components/console/flow-manager.tsx` (montar JsonView)

**Interfaces:**
- Consumes: `flowToEngineJson`, `parseFlowJson` (Task 8).
- Produces: `<JsonView flow={FlowDefinition} onApply={(patch: Pick<FlowDefinition, "description" | "inputs" | "steps">) => void} />`

- [ ] **Step 1: Implementar JsonView**

```tsx
// components/console/flow-editor/json-view.tsx
"use client"

import { useEffect, useState } from "react"
import CodeMirror from "@uiw/react-codemirror"
import { json } from "@codemirror/lang-json"
import { Check, Copy, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { FlowDefinition } from "@/lib/types"
import { flowToEngineJson, parseFlowJson } from "@/lib/flow-json"

export function JsonView({
  flow,
  onApply,
}: {
  flow: FlowDefinition
  onApply: (patch: Pick<FlowDefinition, "description" | "inputs" | "steps">) => void
}) {
  const canonical = flowToEngineJson(flow)
  const [text, setText] = useState(canonical)
  const [errors, setErrors] = useState<string[]>([])
  const [applied, setApplied] = useState(false)

  // Cuando el flow cambia desde afuera (otra pestaña, otro flow seleccionado),
  // re-sincronizar el editor SOLO si el usuario no tiene ediciones pendientes.
  useEffect(() => {
    setText((prev) => (prev === canonical || errors.length === 0 ? canonical : prev))
    setApplied(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canonical])

  const dirty = text !== canonical

  function apply() {
    const parsed = parseFlowJson(text, flow.id)
    if (!parsed.ok) {
      setErrors(parsed.errors)
      setApplied(false)
      return
    }
    setErrors([])
    setApplied(true)
    onApply(parsed.patch)
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
          {"{description, inputs, steps}"} — el shape exacto que parsea orq-lite
        </p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" className="font-mono text-xs" onClick={() => navigator.clipboard?.writeText(text)}>
            <Copy />Copy
          </Button>
          <Button size="sm" variant="outline" className="font-mono text-xs" disabled={!dirty} onClick={() => { setText(canonical); setErrors([]) }}>
            <RotateCcw />Descartar
          </Button>
          <Button size="sm" className="font-mono text-xs" disabled={!dirty} onClick={apply}>
            <Check />Aplicar
          </Button>
        </div>
      </div>

      <CodeMirror
        value={text}
        onChange={(value) => { setText(value); setApplied(false) }}
        extensions={[json()]}
        theme="dark"
        height="420px"
        basicSetup={{ lineNumbers: true, foldGutter: true }}
      />

      {errors.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-red-500/40 bg-red-500/10 p-3 font-mono text-xs text-red-400">
          {errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}
      {applied && errors.length === 0 && (
        <p className="font-mono text-xs text-emerald-500">Aplicado al editor — usá Save para escribirlo a flows.json.</p>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Montar en flow-manager**

Reemplazar el placeholder de la pestaña json por:

```tsx
{tab === "json" && (
  <JsonView
    flow={selected}
    onApply={(patch) => updateSelected(patch)}
  />
)}
```

- [ ] **Step 3: Verificar**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: verde.

Manual: en la pestaña JSON, editar la description y un step → Aplicar → cambiar a Grafo: el cambio está. Pegar JSON inválido (`{nope`) → error de sintaxis inline, no se aplica. Pegar un step sin campos requeridos → error con locator (`steps[0](agent): agent steps require 'agent'`). Un flow con `body` anidado editado por JSON se refleja en los contenedores del grafo.

- [ ] **Step 4: Commit**

```bash
git add components/console/flow-editor/json-view.tsx components/console/flow-manager.tsx
git commit -m "feat(flows): editable JSON tab with validate-and-apply"
```

---

### Task 13: Errores 422 del Save señalando el step ofensivo

**Files:**
- Modify: `components/console/flow-manager.tsx` (saveSelected + estado `invalidPaths`)

**Interfaces:**
- Consumes: `pathFromLocator`, `validateFlowSteps` (Task 7); prop `invalidPaths` de `GraphView` (Task 11).
- El backend responde 422 con `detail: [{step: "steps[0](command)", error: "..."}]` (de `validate_flow_steps`) — mismo formato que el espejo local.

- [ ] **Step 1: Pre-validar en Save y mapear el 422**

En `flow-manager.tsx`:

```ts
import { pathFromLocator, validateFlowSteps, type FlowStepError } from "@/lib/flow-validate"
import type { StepPath } from "@/lib/flow-steps"
// estado nuevo:
const [invalidPaths, setInvalidPaths] = useState<StepPath[]>([])
```

Reescribir `saveSelected`:

```ts
async function saveSelected() {
  if (!selected) return
  if (!projectId) {
    setMessage("Select a project first — flows are saved per project.")
    return
  }
  // Validación local (espejo del backend): feedback inmediato sin round-trip.
  const localErrors = validateFlowSteps(selected.steps)
  if (localErrors.length > 0) {
    applyStepErrors(localErrors)
    return
  }
  setInvalidPaths([])
  setMessage("Saving flow...")
  try {
    const res = await fetch(`/api/control-plane/projects/${projectId}/flows/${selected.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(selected),
    })
    if (res.ok) {
      setMessage("Saved to flows.json")
      return
    }
    const detail = await res.json().catch(() => null)
    if (Array.isArray(detail?.detail) && detail.detail.every((d: { step?: string }) => typeof d?.step === "string")) {
      applyStepErrors(detail.detail as FlowStepError[])
      return
    }
    const problems = Array.isArray(detail?.detail)
      ? detail.detail.map((d: { error?: string; msg?: string }) => d.error ?? d.msg ?? JSON.stringify(d)).join("; ")
      : (detail?.detail ?? `HTTP ${res.status}`)
    setMessage(`Save failed: ${problems}`)
  } catch (err) {
    setMessage(`Save failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function applyStepErrors(errors: FlowStepError[]) {
  setInvalidPaths(errors.map((e) => pathFromLocator(e.step)).filter((p) => p.length > 0))
  setMessage(`Save failed: ${errors.map((e) => `${e.step}: ${e.error}`).join("; ")}`)
}
```

Pasar el estado al grafo: `invalidPaths={invalidPaths}` en `<GraphView ...>`. Limpiar `invalidPaths` cuando el usuario edita steps (`updateSelected({ steps })` → `setInvalidPaths([])` en el mismo handler de onChange de Graph/Form).

- [ ] **Step 2: Verificar**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: verde.

Manual: en el grafo, dejar un step `agent` sin nombre de agente → Save: el nodo se pinta con borde rojo y el mensaje lista `steps[N](agent): agent steps require 'agent'`. Corregirlo → Save: "Saved to flows.json".

- [ ] **Step 3: Commit**

```bash
git add components/console/flow-manager.tsx
git commit -m "feat(flows): highlight offending steps in the graph on validation failure"
```

---

### Task 14: "Caído" ≠ "vacío" en el dashboard

**Files:**
- Modify: `app/dashboard/layout.tsx` (montar banner cliente)
- Create: `components/console/control-plane-banner.tsx`

**Interfaces:**
- Consumes: `useSystemStatus`, `BackendBanner` (Task 1).

- [ ] **Step 1: Banner de control plane**

```tsx
// components/console/control-plane-banner.tsx
"use client"

import { useSystemStatus } from "@/lib/use-system-status"
import { BackendBanner } from "@/components/console/system-status"

// Renderiza solo cuando el control plane está caído: distingue "no hay
// proyectos" (registro vacío legítimo) de "el backend no responde".
export function ControlPlaneBanner() {
  const { status, refresh } = useSystemStatus()
  if (status === null || status.api === "up") return null
  return (
    <div className="px-5 pt-4 md:px-7">
      <BackendBanner
        label="control plane no disponible"
        hint="El API FastAPI (ORQUESTA_API_URL) no responde: lo que ves puede estar vacío o desactualizado. En el contenedor revisá `docker logs`."
        onRetry={refresh}
      />
    </div>
  )
}
```

- [ ] **Step 2: Montarlo en el layout del dashboard**

En `app/dashboard/layout.tsx`:

```tsx
import { ControlPlaneBanner } from "@/components/console/control-plane-banner"
// dentro del div de contenido:
      <div className="flex min-w-0 flex-1 flex-col">
        <ControlPlaneBanner />
        {children}
      </div>
```

- [ ] **Step 3: Verificar**

Run: `pnpm typecheck && pnpm lint`
Expected: verde. Manual: con el API caído, todas las páginas del dashboard muestran el banner ámbar arriba; con el API arriba, el banner no existe y nada cambia.

- [ ] **Step 4: Commit**

```bash
git add components/console/control-plane-banner.tsx app/dashboard/layout.tsx
git commit -m "feat(console): explicit control-plane-down banner across the dashboard"
```

---

### Task 15: `deploy/smoke.sh` — criterio ejecutable del contenedor

**Files:**
- Create: `deploy/smoke.sh` (ejecutable)

**Interfaces:**
- Consumes: `GET /api/system-status` (Task 1), proxies existentes `/api/control-plane/*` y `/opencode/*`, endpoints del API (`GET /projects`, `GET /projects/{id}/flows`, `PUT .../flows/{id}`, `GET /events` SSE).
- Env: `SMOKE_BASE_URL` (default `http://127.0.0.1:3000`), `SMOKE_CHAT=1` (opcional: turno de chat real), `SMOKE_REPO_URL` (opcional: registra un proyecto de prueba).

- [ ] **Step 1: Escribir el script**

```bash
#!/usr/bin/env bash
# Smoke test del contenedor all-in-one. Corre DESPUÉS de `docker compose up -d`
# contra el único puerto expuesto (el frontend); todo pasa por los proxies
# same-origin, igual que un browser real.
#
#   ./smoke.sh                         # checks de infraestructura + flows
#   SMOKE_CHAT=1 ./smoke.sh            # + un turno de chat con el agente real
#   SMOKE_REPO_URL=https://... ./smoke.sh   # + registrar un proyecto de prueba
set -euo pipefail

BASE="${SMOKE_BASE_URL:-http://127.0.0.1:3000}"
FAILURES=0

say()  { printf '\033[1m== %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32mok\033[0m  %s\n' "$*"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$*"; FAILURES=$((FAILURES + 1)); }

wait_for() { # url name [tries]
  local url=$1 name=$2 tries=${3:-60}
  for _ in $(seq "$tries"); do
    if curl -fsS -m 3 "$url" >/dev/null 2>&1; then ok "$name responde"; return 0; fi
    sleep 2
  done
  fail "$name no respondió tras $((tries * 2))s ($url)"
  return 1
}

say "frontend"
wait_for "$BASE" "next" || exit 1

say "system status (api + opencode + mcp arriba)"
status=$(curl -fsS -m 5 "$BASE/api/system-status")
echo "  $status"
for svc in api opencode mcp; do
  if [ "$(echo "$status" | jq -r ".$svc")" = "up" ]; then ok "$svc up"; else fail "$svc down"; fi
done

say "control plane vía proxy"
projects=$(curl -fsS -m 5 "$BASE/api/control-plane/projects")
if echo "$projects" | jq -e 'type == "array"' >/dev/null; then
  ok "GET /projects → array de $(echo "$projects" | jq length)"
else
  fail "GET /projects no devolvió un array"
fi

say "opencode vía proxy"
if curl -fsS -m 5 "$BASE/opencode/config" >/dev/null; then ok "GET /opencode/config"; else fail "GET /opencode/config"; fi

say "eventos SSE (el stream abre y entrega al menos una línea o se mantiene)"
if timeout 5 curl -fsSN -m 5 "$BASE/api/control-plane/events" -o /dev/null 2>/dev/null; then
  ok "SSE abrió y cerró limpio"
else
  # timeout(1) corta la conexión abierta: exit 124 significa que el stream VIVE.
  rc=$?
  if [ "$rc" = "124" ]; then ok "SSE se mantiene abierto (timeout esperado)"; else fail "SSE no conecta (rc=$rc)"; fi
fi

say "round-trip de flows (si hay al menos un proyecto)"
first_project=$(echo "$projects" | jq -r '.[0].id // empty')
if [ -n "$first_project" ]; then
  flows=$(curl -fsS -m 5 "$BASE/api/control-plane/projects/$first_project/flows")
  first_flow=$(echo "$flows" | jq -c '.[0] // empty')
  if [ -n "$first_flow" ]; then
    flow_id=$(echo "$first_flow" | jq -r '.id')
    code=$(curl -fsS -m 10 -o /dev/null -w '%{http_code}' -X PUT \
      -H 'Content-Type: application/json' -d "$first_flow" \
      "$BASE/api/control-plane/projects/$first_project/flows/$flow_id")
    if [ "$code" = "200" ]; then ok "PUT flow '$flow_id' (round-trip sin cambios) → 200"; else fail "PUT flow → $code"; fi
  else
    ok "proyecto sin flows — salteado"
  fi
else
  ok "sin proyectos registrados — salteado (setear SMOKE_REPO_URL para probar registro)"
fi

if [ -n "${SMOKE_REPO_URL:-}" ]; then
  say "registro de proyecto de prueba"
  created=$(curl -fsS -m 60 -X POST -H 'Content-Type: application/json' \
    -d "{\"name\": \"smoke-$(date +%s)\", \"repo_url\": \"$SMOKE_REPO_URL\", \"base_branch\": \"main\"}" \
    "$BASE/api/control-plane/projects")
  pid=$(echo "$created" | jq -r '.id // empty')
  if [ -n "$pid" ]; then ok "proyecto registrado: $pid"; else fail "registro falló: $created"; fi
fi

if [ "${SMOKE_CHAT:-0}" = "1" ]; then
  say "turno de chat real (agente orquesta + tools MCP)"
  sid=$(curl -fsS -m 10 -X POST -H 'Content-Type: application/json' -d '{}' "$BASE/opencode/session" | jq -r '.id')
  reply=$(curl -fsS -m 120 -X POST -H 'Content-Type: application/json' \
    -d '{"agent": "orquesta", "parts": [{"type": "text", "text": "List my projects"}]}' \
    "$BASE/opencode/session/$sid/message")
  if echo "$reply" | jq -e '.parts | length > 0' >/dev/null 2>&1; then
    ok "el agente respondió ($(echo "$reply" | jq '[.parts[] | select(.type == "tool")] | length') tool calls)"
  else
    fail "el agente no respondió: $(echo "$reply" | head -c 200)"
  fi
fi

echo
if [ "$FAILURES" -gt 0 ]; then
  printf '\033[31m%d check(s) fallaron\033[0m\n' "$FAILURES"
  exit 1
fi
printf '\033[32mtodos los checks pasaron\033[0m\n'
```

Nota para el implementador: verificar el path real del endpoint de prompt de opencode para el bloque SMOKE_CHAT (`POST /session/{id}/message` en el SDK 1.17; confirmar contra `node_modules/@opencode-ai/sdk/dist/gen/sdk.gen.d.ts` — si difiere, ajustar el path del curl).

- [ ] **Step 2: Hacerlo ejecutable y probar sintaxis**

```bash
chmod +x deploy/smoke.sh
bash -n deploy/smoke.sh && echo "syntax OK"
```

- [ ] **Step 3: Correr contra el contenedor**

```bash
cd deploy
mkdir -p ../.tmp/logs/docker-build
ts=$(date +%Y-%m-%dT%H-%M-%S)
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 -p CPUQuota=400% \
  /usr/bin/time -v -o "../.tmp/logs/docker-build/${ts}_wall-stats.log" \
  docker compose build 2>&1 | tail -5
docker compose up -d
sleep 10
./smoke.sh
```

Expected: `todos los checks pasaron`. Este step también valida Task 5 (con `ORQUESTA_CHAT_MODEL` seteado en `deploy/.env`: `docker compose exec orquesta jq -r .agent.orquesta.model /data/opencode.json` imprime el override). Si hay credenciales de opencode en el host, correr también `SMOKE_CHAT=1 ./smoke.sh` — cierra el criterio 1e del spec (turno de chat real end-to-end).

- [ ] **Step 4: Commit**

```bash
git add deploy/smoke.sh
git commit -m "feat(deploy): executable smoke test for the all-in-one container"
```

---

### Task 16: Docs y gates finales

**Files:**
- Modify: `deploy/README.md`

- [ ] **Step 1: Documentar lo nuevo en deploy/README.md**

Agregar una sección tras "First-time setup":

```markdown
## Configuration knobs

| Env var (deploy/.env)   | Default                      | What it does |
|-------------------------|------------------------------|--------------|
| `ORQUESTA_CHAT_MODEL`   | el modelo de `opencode.json` | Modelo del agente de chat (ej. `anthropic/claude-sonnet-4-6`). Se aplica al arrancar el contenedor, sin rebuild. |
| `WEB_PORT`              | `3000`                       | Puerto host del frontend. |

## Smoke test

Después de `docker compose up -d`:

```bash
./smoke.sh                    # infraestructura + control plane + flows
SMOKE_CHAT=1 ./smoke.sh       # + un turno de chat real con tools MCP
```

El dashboard muestra el estado de los procesos internos (control plane /
opencode / mcp) al pie del sidebar; si algo está caído lo vas a ver ahí y
como banner en las páginas afectadas.
```

- [ ] **Step 2: Gates**

```bash
pnpm typecheck && pnpm lint && pnpm test
```
Expected: todo verde.

```bash
cd /home/lio/Projects/collectiveai/orquesta && .venv/bin/python -m pytest test/ -q
```
Expected: tests Python del API en verde (no tocamos backend; esto confirma que nada se rompió por accidente).

Build de producción del frontend (SIEMPRE capeado — ver Global Constraints):

```bash
cmd=next-build; ts=$(date +%Y-%m-%dT%H-%M-%S)
log=.tmp/logs/$cmd/${ts}_wall-stats.log; mkdir -p ".tmp/logs/$cmd"
systemd-run --user --scope -p MemoryMax=4G -p MemorySwapMax=0 -p CPUQuota=400% \
  /usr/bin/time -v -o "$log" pnpm build
```
Expected: build OK; revisar el log de stats.

- [ ] **Step 3: Verificación de criterios de aceptación del spec**

Repasar contra `docs/superpowers/specs/2026-07-10-orquesta-production-ready-design.md` §Criterios:
1. Chat renderiza con backends caídos + banner → Task 2/4 manual check.
2. Pedido por chat → run real + streaming + link → Task 4 Step 3 y Task 15 `SMOKE_CHAT=1`.
3. Recarga conserva conversación → Task 4 Step 3.
4. Loop anidado editable por grafo y por JSON, diff limitado → Tasks 11-12 manual checks + round-trip del smoke.
5. Strip refleja caídas en ~30s; caído ≠ vacío → Tasks 1/14.
6. `deploy/smoke.sh` pasa → Task 15 Step 3.

- [ ] **Step 4: Commit final**

```bash
git add deploy/README.md
git commit -m "docs(deploy): document ORQUESTA_CHAT_MODEL and the smoke test"
```
