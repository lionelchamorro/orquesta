"use client"

import { useEffect, useState } from "react"
import { ChevronRight, File, Folder } from "lucide-react"
import { fetchJSON } from "@/lib/fetch-json"
import { cn } from "@/lib/utils"
import type { ArtifactContent, ArtifactEntry, ArtifactListing } from "@/lib/types"

function fmtBytes(n: number): string {
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${n} B`
}

/**
 * Expandable file browser for one orq-lite run's artifact directory tree.
 *
 * Paths are validated server-side; this component simply sends the path
 * from entry.path (relative to the run root) and never constructs paths itself.
 */
export function ArtifactsPane({
  projectId,
  runId,
  initialPath = "",
}: {
  projectId: string
  runId: string
  initialPath?: string
}) {
  const [currentPath, setCurrentPath] = useState(initialPath)
  const [fetched, setFetched] = useState<{ path: string; data: ArtifactListing } | null>(null)
  const [fileContent, setFileContent] = useState<ArtifactContent | null>(null)
  const [viewingFile, setViewingFile] = useState<string | null>(null)
  const [loadingFile, setLoadingFile] = useState(false)

  useEffect(() => {
    let cancelled = false
    const params = currentPath ? `?path=${encodeURIComponent(currentPath)}` : ""
    fetchJSON<ArtifactListing>(
      `/api/control-plane/projects/${projectId}/history/runs/${runId}/artifacts${params}`,
    ).then((data) => {
      if (!cancelled && data) setFetched({ path: currentPath, data })
    })
    return () => {
      cancelled = true
    }
  }, [projectId, runId, currentPath])

  // The listing for a stale path renders as loading instead of being reset in the effect.
  const listing = fetched && fetched.path === currentPath ? fetched.data : null

  const navigateTo = (path: string) => {
    setCurrentPath(path)
    setViewingFile(null)
    setFileContent(null)
  }

  const openFile = async (entry: ArtifactEntry) => {
    setViewingFile(entry.name)
    setLoadingFile(true)
    const data = await fetchJSON<ArtifactContent>(
      `/api/control-plane/projects/${projectId}/history/runs/${runId}/artifacts/file?path=${encodeURIComponent(entry.path)}`,
    )
    setFileContent(data)
    setLoadingFile(false)
  }

  const pathSegments = currentPath ? currentPath.split("/") : []

  return (
    <div className="space-y-2">
      {/* Breadcrumb navigation */}
      <nav className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
        <button className="hover:text-foreground" onClick={() => navigateTo("")}>
          {runId}
        </button>
        {pathSegments.map((seg, i) => {
          const segPath = pathSegments.slice(0, i + 1).join("/")
          return (
            <span key={segPath} className="flex items-center gap-1">
              <ChevronRight className="h-3 w-3 shrink-0" />
              {i === pathSegments.length - 1 ? (
                <span className="text-foreground">{seg}</span>
              ) : (
                <button className="hover:text-foreground" onClick={() => navigateTo(segPath)}>
                  {seg}
                </button>
              )}
            </span>
          )
        })}
        {viewingFile && (
          <span className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3 shrink-0" />
            <span className="text-foreground">{viewingFile}</span>
          </span>
        )}
      </nav>

      {/* File viewer */}
      {viewingFile && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <button
              className="font-mono text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                setViewingFile(null)
                setFileContent(null)
              }}
            >
              ← back to listing
            </button>
            {fileContent && (
              <span className="font-mono text-xs text-muted-foreground">
                {fmtBytes(fileContent.size)}
                {fileContent.truncated && " (truncated)"}
              </span>
            )}
          </div>
          {loadingFile && (
            <p className="font-mono text-xs text-muted-foreground">Loading…</p>
          )}
          {fileContent && (
            <pre className="max-h-80 overflow-auto rounded border border-border bg-muted/30 p-3 font-mono text-xs leading-relaxed text-foreground">
              {fileContent.content}
            </pre>
          )}
        </div>
      )}

      {/* Directory listing */}
      {!viewingFile && (
        <div>
          {listing === null && (
            <p className="font-mono text-xs text-muted-foreground">Loading…</p>
          )}
          {listing && listing.entries.length === 0 && (
            <p className="font-mono text-xs text-muted-foreground">Empty directory.</p>
          )}
          {listing && listing.entries.length > 0 && (
            <ul className="divide-y divide-border/40 rounded border border-border">
              {listing.entries.map((entry) => (
                <li key={entry.path}>
                  <button
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs transition-colors hover:bg-muted/40"
                    onClick={() => {
                      if (entry.is_dir) {
                        navigateTo(entry.path)
                      } else {
                        openFile(entry)
                      }
                    }}
                  >
                    {entry.is_dir ? (
                      <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className={cn(entry.is_dir && "text-primary")}>{entry.name}</span>
                    {!entry.is_dir && (
                      <span className="ml-auto text-muted-foreground">{fmtBytes(entry.size)}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
