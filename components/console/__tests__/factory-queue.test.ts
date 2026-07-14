import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { FactoryQueue } from "../factory-queue"
import type { Feature } from "@/lib/types"

const pendingFeature: Feature = {
  id: "feat-1",
  status: "pending",
  branch: "feature/auth-refactor",
  tasks_done: 0,
  tasks_failed: 0,
  cost_usd: 0,
  title: "Auth refactor",
}

const doneFeature: Feature = {
  id: "feat-2",
  status: "done",
  branch: "feature/pagination",
  tasks_done: 3,
  tasks_failed: 0,
  cost_usd: 0.12,
  title: "Add pagination",
  pr_url: "https://github.com/acme/atlas/pull/7",
}

describe("FactoryQueue — empty state", () => {
  it("shows the Add feature button when the queue is empty", () => {
    const html = renderToStaticMarkup(
      React.createElement(FactoryQueue, {
        projectId: "prm",
        initialFeatures: [],
      }),
    )

    expect(html).toContain("Add feature")
    expect(html).toContain("Factory queue is empty")
  })

  it("mentions the project chat as an alternative path", () => {
    const html = renderToStaticMarkup(
      React.createElement(FactoryQueue, {
        projectId: "prm",
        initialFeatures: [],
      }),
    )

    expect(html).toContain("chat")
  })
})

describe("FactoryQueue — with features", () => {
  it("renders feature titles", () => {
    const html = renderToStaticMarkup(
      React.createElement(FactoryQueue, {
        projectId: "prm",
        initialFeatures: [pendingFeature],
      }),
    )

    expect(html).toContain("Auth refactor")
    expect(html).toContain("feature/auth-refactor")
  })

  it("renders the Add feature button below the list when features exist", () => {
    const html = renderToStaticMarkup(
      React.createElement(FactoryQueue, {
        projectId: "prm",
        initialFeatures: [pendingFeature],
      }),
    )

    expect(html).toContain("Add feature")
  })

  it("renders a PR link when pr_url is present", () => {
    const html = renderToStaticMarkup(
      React.createElement(FactoryQueue, {
        projectId: "prm",
        initialFeatures: [doneFeature],
      }),
    )

    expect(html).toContain("https://github.com/acme/atlas/pull/7")
  })

  it("renders cost when cost_usd is non-zero", () => {
    const html = renderToStaticMarkup(
      React.createElement(FactoryQueue, {
        projectId: "prm",
        initialFeatures: [doneFeature],
      }),
    )

    expect(html).toContain("$0.12")
  })

  it("does not render cost when cost_usd is zero", () => {
    const html = renderToStaticMarkup(
      React.createElement(FactoryQueue, {
        projectId: "prm",
        initialFeatures: [pendingFeature],
      }),
    )

    // $0.00 must not appear — zero cost is hidden.
    expect(html).not.toMatch(/\$0\.00/)
  })
})
