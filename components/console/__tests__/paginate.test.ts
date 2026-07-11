import { describe, expect, it } from "vitest"
import { PAGE_SIZE, paginationSlice } from "@/lib/paginate"

describe("paginationSlice", () => {
  it("shows all items when count is fewer than page size", () => {
    const items = Array.from({ length: 10 }, (_, i) => i)
    const { visible, hasMore } = paginationSlice(items, PAGE_SIZE)
    expect(visible).toEqual(items)
    expect(hasMore).toBe(false)
  })

  it("shows all items when count equals page size exactly", () => {
    const items = Array.from({ length: PAGE_SIZE }, (_, i) => i)
    const { visible, hasMore } = paginationSlice(items, PAGE_SIZE)
    expect(visible).toHaveLength(PAGE_SIZE)
    expect(hasMore).toBe(false)
  })

  it("shows first loaded items when count exceeds page size", () => {
    const items = Array.from({ length: 120 }, (_, i) => i)
    const { visible, hasMore } = paginationSlice(items, PAGE_SIZE)
    expect(visible).toHaveLength(PAGE_SIZE)
    expect(visible[0]).toBe(0)
    expect(visible[PAGE_SIZE - 1]).toBe(PAGE_SIZE - 1)
    expect(hasMore).toBe(true)
  })

  it("hasMore becomes false after loading all items", () => {
    const items = Array.from({ length: 120 }, (_, i) => i)
    const first = paginationSlice(items, PAGE_SIZE)
    expect(first.hasMore).toBe(true)

    // loaded = 200 covers all 120 items
    const second = paginationSlice(items, 200)
    expect(second.visible).toHaveLength(120)
    expect(second.hasMore).toBe(false)
  })

  it("incrementing loaded count exposes more items", () => {
    const items = Array.from({ length: 150 }, (_, i) => i)
    const step1 = paginationSlice(items, 50)
    expect(step1.visible).toHaveLength(50)
    expect(step1.hasMore).toBe(true)

    const step2 = paginationSlice(items, 100)
    expect(step2.visible).toHaveLength(100)
    expect(step2.hasMore).toBe(true)

    const step3 = paginationSlice(items, 150)
    expect(step3.visible).toHaveLength(150)
    expect(step3.hasMore).toBe(false)
  })
})
