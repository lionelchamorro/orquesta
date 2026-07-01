import Link from "next/link"
import { Button } from "@/components/ui/button"
import { BrandWordmark } from "@/components/brand-mark"

export function LandingNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Link href="/">
          <BrandWordmark />
        </Link>
        <nav className="hidden items-center gap-8 font-mono text-xs tracking-wide text-muted-foreground md:flex">
          <a href="#how" className="transition-colors hover:text-foreground">
            How it works
          </a>
          <a href="#roles" className="transition-colors hover:text-foreground">
            Agent roles
          </a>
          <a href="#factory" className="transition-colors hover:text-foreground">
            Factory
          </a>
        </nav>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm" className="hidden font-mono text-xs sm:inline-flex">
            <a href="https://github.com/lionelchamorro/orquestalite" target="_blank" rel="noreferrer">
              GitHub
            </a>
          </Button>
          <Button asChild size="sm" className="font-mono text-xs">
            <Link href="/dashboard">Open console</Link>
          </Button>
        </div>
      </div>
    </header>
  )
}
