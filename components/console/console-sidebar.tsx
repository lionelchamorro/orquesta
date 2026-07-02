"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LayoutDashboard, Boxes, MessagesSquare, Users, Settings, Workflow, Gamepad2, LogOut } from "lucide-react"
import { cn } from "@/lib/utils"
import { BrandWordmark } from "@/components/brand-mark"
import type { Project } from "@/lib/types"
import { StateDot } from "@/components/status-badge"
import { logout } from "@/app/login/actions"

const nav = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/projects", label: "Projects", icon: Boxes },
  { href: "/dashboard/chat", label: "Global chat", icon: MessagesSquare },
  { href: "/dashboard/flows", label: "Flows", icon: Workflow },
  { href: "/dashboard/team", label: "Teams", icon: Users },
]

export function ConsoleSidebar({ projects }: { projects: Project[] }) {
  const pathname = usePathname()
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-sidebar lg:flex">
      <div className="flex h-16 items-center border-b border-border px-5">
        <Link href="/">
          <BrandWordmark />
        </Link>
      </div>
      <nav className="flex flex-col gap-1 p-3">
        {nav.map((item) => {
          const active =
            item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 font-mono text-sm transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground",
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          )
        })}
      </nav>
      <div className="mt-2 px-3">
        <p className="px-3 py-2 font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
          Projects
        </p>
        <div className="flex flex-col gap-0.5">
          {projects.map((p) => {
            const active = pathname === `/projects/${p.id}`
            const officeActive = pathname === `/projects/${p.id}/office`
            return (
              <div key={p.id} className="flex items-center gap-1">
                <Link
                  href={`/projects/${p.id}`}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-3 py-2 font-mono text-[13px] transition-colors",
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground",
                  )}
                >
                  <StateDot state={p.state} />
                  <span className="truncate">{p.name}</span>
                </Link>
                <Link
                  href={`/projects/${p.id}/office`}
                  title="Virtual office"
                  className={cn(
                    "shrink-0 rounded-lg p-2 transition-colors",
                    officeActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground",
                  )}
                >
                  <Gamepad2 className="h-3.5 w-3.5" />
                </Link>
              </div>
            )
          })}
        </div>
      </div>
      <div className="mt-auto border-t border-border p-3">
        <Link
          href="/dashboard/settings"
          className="flex items-center gap-3 rounded-lg px-3 py-2 font-mono text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent/50 hover:text-foreground"
        >
          <Settings className="h-4 w-4" />
          Settings
        </Link>
        <form action={logout}>
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 font-mono text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent/50 hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </form>
      </div>
    </aside>
  )
}
