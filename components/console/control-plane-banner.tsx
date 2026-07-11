"use client"

import { useSystemStatus } from "@/lib/use-system-status"
import { BackendBanner } from "@/components/console/system-status"

// Renderiza solo cuando el control plane está caído: distingue "no hay
// proyectos" (registro vacío legítimo) de "el backend no responde".
export function ControlPlaneBanner() {
  const { status, refresh } = useSystemStatus()
  if (status === null || status.api === "up") return null
  return (
    <div className="px-5 pt-4 md:px-7">
      <BackendBanner
        label="control plane unavailable"
        hint="The FastAPI control plane (ORQUESTA_API_URL) is not responding: what you see may be empty or stale. In the container, check `docker logs`."
        onRetry={refresh}
      />
    </div>
  )
}
