import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { AttentionSection, retryRequestInit } from "../needs-attention"
import type { AttentionItem } from "@/lib/types"

const runItem: AttentionItem = {
  kind: "run_failed",
  project_id: "proj1",
  project_name: "Project",
  ref: "run1",
  title: "pr_review failed",
  detail: "tests failed",
  ts: "2026-07-10T12:00:00",
}

const taskItem: AttentionItem = {
  kind: "task_needs_clarification",
  project_id: "proj1",
  project_name: "Project",
  ref: "task1",
  title: "Clarify scope",
  detail: "missing acceptance criteria",
  ts: "2026-07-10T12:01:00",
}

describe("AttentionSection", () => {
  it("renders all-clear empty state", () => {
    const html = renderToStaticMarkup(
      React.createElement(AttentionSection, {
        items: [],
        retrying: null,
        messages: {},
        onRetry: () => undefined,
      }),
    )

    expect(html).toContain("all clear")
  })

  it("renders retry for failed runs and view links to the matching tab", () => {
    const html = renderToStaticMarkup(
      React.createElement(AttentionSection, {
        items: [runItem, taskItem],
        retrying: null,
        messages: {},
        onRetry: () => undefined,
      }),
    )

    expect(html).toContain("pr_review failed")
    expect(html).toContain("Retry")
    expect(html).toContain("/projects/proj1?tab=Runs")
    expect(html).toContain("/projects/proj1?tab=Tasks")
  })

  it("builds retry requests with feedback from the attention detail", () => {
    expect(retryRequestInit(runItem)).toEqual({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: "tests failed" }),
    })
  })
})
