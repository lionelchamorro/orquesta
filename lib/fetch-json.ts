export async function fetchJSON<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store" })
    return res.ok ? ((await res.json()) as T) : null
  } catch {
    return null
  }
}
