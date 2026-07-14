"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { LayoutDashboard, Boxes, MessagesSquare, Users, Workflow, Gamepad2, LogOut, Menu, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { BrandWordmark } from "@/components/brand-mark"
import type { Project } from "@/lib/types"
import { StateDot } from "@/components/status-badge"
import { logout } from "@/app/login/actions"
import { SystemStatusStrip } from "@/components/console/system-status"

const nav = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/projects", label: "Projects", icon: Boxes },
  { href: "/dashboard/chat", label: "Global chat", icon: MessagesSquare },
  { href: "/dashboard/flows", label: "Flows", icon: Workflow },
  { href: "/dashboard/team", label: "Teams", icon: Users },
]

function NavContent({
  projects,
  pathname,
  onNavClick,
}: {
  projects: Project[]
  pathname: string
  onNavClick?: () => void
}) {
  return (
    <>
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
              onClick={onNavClick}
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
                  onClick={onNavClick}
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
                  onClick={onNavClick}
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
      <div className="mt-auto">
        <SystemStatusStrip />
        <div className="border-t border-border p-3">
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
      </div>
    </>
  )
}

function MobileDrawer({
  open,
  onClose,
  projects,
  pathname,
}: {
  open: boolean
  onClose: () => void
  projects: Project[]
  pathname: string
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open) {
      dialog.showModal()
      closeButtonRef.current?.focus()
    } else {
      dialog.close()
    }
  }, [open])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const handleCancel = (e: Event) => {
      e.preventDefault()
      onClose()
    }
    dialog.addEventListener("cancel", handleCancel)
    return () => dialog.removeEventListener("cancel", handleCancel)
  }, [onClose])

  return (
    <dialog
      ref={dialogRef}
      onClick={(e) => {
        // close on backdrop click
        if (e.target === e.currentTarget) onClose()
      }}
      className="m-0 h-full max-h-full w-72 max-w-full overflow-y-auto border-r border-border bg-sidebar p-0 backdrop:bg-black/50 open:flex open:flex-col"
    >
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-border px-5">
        <Link href="/" onClick={onClose}>
          <BrandWordmark />
        </Link>
        <button
          ref={closeButtonRef}
          onClick={onClose}
          aria-label="Close navigation"
          className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-sidebar-accent/50 hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex flex-1 flex-col overflow-y-auto">
        <NavContent projects={projects} pathname={pathname} onNavClick={onClose} />
      </div>
    </dialog>
  )
}

export function ConsoleSidebar({ projects }: { projects: Project[] }) {
  const pathname = usePathname()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const hamburgerRef = useRef<HTMLButtonElement>(null)

  function openDrawer() {
    setDrawerOpen(true)
  }

  function closeDrawer() {
    setDrawerOpen(false)
    hamburgerRef.current?.focus()
  }

  return (
    <>
      {/* Mobile header — visible below lg */}
      <div className="fixed inset-x-0 top-0 z-40 flex h-14 items-center border-b border-border bg-sidebar px-4 lg:hidden">
        <button
          ref={hamburgerRef}
          onClick={openDrawer}
          aria-label="Open navigation"
          aria-expanded={drawerOpen}
          className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-sidebar-accent/50 hover:text-foreground"
        >
          <Menu className="h-5 w-5" />
        </button>
        <Link href="/" className="ml-3">
          <BrandWordmark />
        </Link>
      </div>

      {/* Mobile drawer */}
      <MobileDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        projects={projects}
        pathname={pathname}
      />

      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-sidebar lg:flex">
        <div className="flex h-16 items-center border-b border-border px-5">
          <Link href="/">
            <BrandWordmark />
          </Link>
        </div>
        <NavContent projects={projects} pathname={pathname} />
      </aside>
    </>
  )
}
