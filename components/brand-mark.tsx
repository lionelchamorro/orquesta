import { cn } from "@/lib/utils"

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      className={cn("h-7 w-7", className)}
      aria-hidden="true"
    >
      <rect x="1" y="1" width="46" height="46" rx="12" stroke="currentColor" strokeWidth="1.5" className="text-primary/60" />
      {/* gauge arc */}
      <path
        d="M14 30a10 10 0 1 1 17 4"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        className="text-foreground"
      />
      {/* needle */}
      <path d="M24 28 33 16" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" className="text-foreground" />
      <circle cx="24" cy="28" r="2.4" className="fill-foreground" />
      {/* crescent */}
      <path
        d="M15 13a3.6 3.6 0 1 0 3 5.6A4.4 4.4 0 0 1 15 13Z"
        className="fill-primary"
      />
      {/* equalizer bars */}
      <g className="fill-primary/70">
        <rect x="17" y="36" width="2" height="4" rx="1" />
        <rect x="21" y="34" width="2" height="6" rx="1" />
        <rect x="25" y="37" width="2" height="3" rx="1" />
        <rect x="29" y="35" width="2" height="5" rx="1" />
      </g>
    </svg>
  )
}

export function BrandWordmark({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <BrandMark />
      <span className="font-mono text-sm font-semibold tracking-[0.35em] text-foreground">
        ORQUESTA
      </span>
    </div>
  )
}
