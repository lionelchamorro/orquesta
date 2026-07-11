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
