"use client"

import { useEffect } from "react"
import { Button } from "@/components/ui/button"

export default function ProjectError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-7 text-center">
      <p className="font-mono text-sm text-err">Could not load this project.</p>
      <p className="max-w-md font-mono text-xs text-muted-foreground">{error.message}</p>
      <Button size="sm" variant="outline" className="font-mono text-xs" onClick={reset}>
        Try again
      </Button>
    </div>
  )
}
