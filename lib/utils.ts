import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// A random id for client-side keys/local records. `crypto.randomUUID` only
// exists in secure contexts (HTTPS or localhost), so it throws when the app is
// reached over plain HTTP by IP/domain — which crashed the chat. Fall back to
// `crypto.getRandomValues` (available in insecure contexts) and finally to a
// non-crypto id. These ids are not security-sensitive.
export function uid(): string {
  const c: Crypto | undefined = typeof crypto !== 'undefined' ? crypto : undefined
  if (c?.randomUUID) return c.randomUUID()
  if (c?.getRandomValues) {
    const b = c.getRandomValues(new Uint8Array(16))
    b[6] = (b[6] & 0x0f) | 0x40
    b[8] = (b[8] & 0x3f) | 0x80
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0'))
    return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
