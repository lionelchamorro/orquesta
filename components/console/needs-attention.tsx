"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { AlertTriangle, ArrowUpRight, CheckCircle2, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/status-badge"
import type { AttentionItem, AttentionResponse, Run } from "@/lib/types"

type RetryMessages = Record<string, string>

async function fetchAttention(): Promise<AttentionItem[] | null> {
  try {
    const res = await fetch("/api/control-plane/attention", { cache: "no-store" })
    if (!res.ok) return null
    const payload = (await res.json()) as AttentionResponse
    return payload.items
  } catch {
    return null
  }
}

function viewHref(item: AttentionItem): string {
  const tab = item.kind === "run_failed" ? "Runs" : "Tasks"
  return `/projects/${item.project_id}?tab=${tab}`
}

function timeLabel(ts: string): string {
  if (!ts) return ""
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return ts
  return date.toLocaleString()
}

export function AttentionSection({
  items,
  retrying,
  messages,
  onRetry,
}: {
  items: AttentionItem[]
  retrying: string | null
  messages: RetryMessages
  onRetry: (item: AttentionItem) => void
}) {
  return (
    <section className="mt-6 rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border/50 px-4 py-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-warn" />
          <h2 className="font-mono text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Needs attention
          </h2>
        </div>
        <span className="font-mono text-xs text-muted-foreground">{items.length}</span>
      </div>

      {items.length === 0 ? (
        <div className="flex items-center gap-2 px-4 py-4 font-mono text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-ok" />
          all clear
        </div>
      ) : (
        <ul className="divide-y divide-border/50">
          {items.map((item) => (
            <li key={`${item.kind}:${item.project_id}:${item.ref}`} className="px-4 py-3">
              <div className="flex flex-wrap items-start gap-3">
                <StatusBadge status={item.kind} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <p className="font-mono text-sm font-semibold">{item.title}</p>
                    <span className="font-mono text-xs text-muted-foreground">
                      {item.project_name}
                    </span>
                  </div>
                  {item.detail && (
                    <p className="mt-1 line-clamp-2 whitespace-pre-line text-sm text-muted-foreground">
                      {item.detail}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground">
                    <span>{item.ref}</span>
                    {item.ts && <span>{timeLabel(item.ts)}</span>}
                    {messages[item.ref] && <span className="text-foreground">{messages[item.ref]}</span>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {item.kind === "run_failed" && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="font-mono text-xs"
                      disabled={retrying === item.ref}
                      onClick={() => onRetry(item)}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Retry
                    </Button>
                  )}
                  <Button asChild size="sm" variant="ghost" className="font-mono text-xs">
                    <Link href={viewHref(item)}>
                      View
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function NeedsAttention() {
  const [items, setItems] = useState<AttentionItem[] | null>(null)
  const [available, setAvailable] = useState(true)
  const [retrying, setRetrying] = useState<string | null>(null)
  const [messages, setMessages] = useState<RetryMessages>({})

  useEffect(() => {
    let cancelled = false
    fetchAttention().then((nextItems) => {
      if (cancelled) return
      if (nextItems === null) {
        setAvailable(false)
        return
      }
      setItems(nextItems)
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function retry(item: AttentionItem) {
    setRetrying(item.ref)
    try {
      const res = await fetch(`/api/control-plane/runs/${item.ref}/retry`, { method: "POST" })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        setMessages((current) => ({
          ...current,
          [item.ref]: `retry failed: ${detail?.detail ?? `HTTP ${res.status}`}`,
        }))
        return
      }
      const run = (await res.json()) as Run
      setMessages((current) => ({ ...current, [item.ref]: `retry ${run.state}` }))
    } catch (err) {
      setMessages((current) => ({
        ...current,
        [item.ref]: `retry failed: ${err instanceof Error ? err.message : String(err)}`,
      }))
    } finally {
      setRetrying(null)
    }
  }

  if (!available || items === null) return null
  return <AttentionSection items={items} retrying={retrying} messages={messages} onRetry={retry} />
}
