"use client"

import type { ReactNode } from "react"
import { ToastProvider, ToastHost } from "@/lib/toast"

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      {children}
      <ToastHost />
    </ToastProvider>
  )
}
