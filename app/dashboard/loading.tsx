function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-muted/40 ${className ?? ""}`}
    />
  )
}

export default function DashboardLoading() {
  return (
    <>
      {/* header */}
      <div className="flex h-16 items-center justify-between border-b border-border px-5 md:px-7">
        <div className="space-y-1.5">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-3 w-56" />
        </div>
        <Skeleton className="h-8 w-28" />
      </div>

      <div className="grid flex-1 gap-0 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 p-5 md:p-7">
          {/* stat cards */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-4 w-4 rounded-full" />
                </div>
                <Skeleton className="mt-2 h-7 w-12" />
              </div>
            ))}
          </div>

          {/* attention section placeholder */}
          <div className="mt-8 space-y-3">
            <Skeleton className="h-4 w-28" />
            <div className="rounded-xl border border-border bg-card p-5">
              <Skeleton className="h-4 w-48" />
            </div>
          </div>

          {/* projects grid */}
          <div className="mb-3 mt-8 flex items-center justify-between">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-7 w-28" />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-start justify-between">
                  <div className="space-y-2">
                    <Skeleton className="h-5 w-36" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
                <div className="mt-4 flex gap-2">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* right panel — hidden below xl */}
        <div className="hidden border-l border-border xl:block">
          <div className="p-5 space-y-3">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        </div>
      </div>
    </>
  )
}
