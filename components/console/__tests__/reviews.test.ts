import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ReviewsList } from "../project-view"
import type { ReviewRun } from "@/lib/types"

const githubReview: ReviewRun = {
  run_id: "r1",
  pr_number: 42,
  pr_url: "https://github.com/acme/atlas/pull/42",
  state: "succeeded",
  started_at: null,
  finished_at: null,
  duration_s: 90,
  cost_usd: 0.12,
}

const noUrlReview: ReviewRun = {
  run_id: "r2",
  pr_number: 7,
  pr_url: null,
  state: "failed",
  started_at: null,
  finished_at: null,
  duration_s: null,
  cost_usd: null,
}

describe("ReviewsList", () => {
  it("renders the empty state when no reviews exist", () => {
    const html = renderToStaticMarkup(
      React.createElement(ReviewsList, {
        reviews: [],
        rerunning: null,
        messages: {},
        onRerun: () => undefined,
      }),
    )

    expect(html).toContain("No PR reviews yet")
    expect(html).toContain("pr_review")
  })

  it("renders a linked PR number when pr_url is set", () => {
    const html = renderToStaticMarkup(
      React.createElement(ReviewsList, {
        reviews: [githubReview],
        rerunning: null,
        messages: {},
        onRerun: () => undefined,
      }),
    )

    expect(html).toContain("https://github.com/acme/atlas/pull/42")
    expect(html).toContain("#42")
    expect(html).toContain("Re-run review")
  })

  it("renders an unlinked PR number when pr_url is null", () => {
    const html = renderToStaticMarkup(
      React.createElement(ReviewsList, {
        reviews: [noUrlReview],
        rerunning: null,
        messages: {},
        onRerun: () => undefined,
      }),
    )

    expect(html).toContain("#7")
    expect(html).not.toContain('href="https://')
  })

  it("renders duration and cost when available", () => {
    const html = renderToStaticMarkup(
      React.createElement(ReviewsList, {
        reviews: [githubReview],
        rerunning: null,
        messages: {},
        onRerun: () => undefined,
      }),
    )

    expect(html).toContain("1m 30s")
    expect(html).toContain("$0.12")
  })

  it("renders a message for a run when provided", () => {
    const html = renderToStaticMarkup(
      React.createElement(ReviewsList, {
        reviews: [githubReview],
        rerunning: null,
        messages: { r1: "relaunched (queued)" },
        onRerun: () => undefined,
      }),
    )

    expect(html).toContain("relaunched (queued)")
  })
})
