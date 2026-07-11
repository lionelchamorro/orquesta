function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-muted/40 ${className ?? ""}`}
    />
  )
}

export default function ProjectLoading() {
  return (
    <>
      {/* header */}
      <div className="flex h-16 items-center justify-between border-b border-border px-5 md:px-7">
        <div className="space-y-1.5">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-64" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-20" />
        </div>
      </div>

      <div className="p-5 md:p-7">
        {/* tab bar */}
        <div className="mb-6 flex gap-1 border-b border-border pb-0">
          {["Factory", "Tasks", "Reviews", "Runs", "Chat"].map((tab) => (
            <Skeleton key={tab} className="mb-[-1px] h-9 w-20 rounded-b-none rounded-t-lg" />
          ))}
        </div>

        {/* launcher row */}
        <div className="mb-6 flex items-center gap-2">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-8 w-16" />
        </div>

        {/* task rows */}
        <div className="rounded-xl border border-border">
          <div className="border-b border-border bg-card/50 p-3">
            <div className="flex gap-4">
              {["ID", "Work", "Verify", "Title"].map((col) => (
                <Skeleton key={col} className="h-3 w-12" />
              ))}
            </div>
          </div>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 border-b border-border/50 px-4 py-3 last:border-0">
              <Skeleton className="h-3 w-8" />
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-3 w-48" />
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
