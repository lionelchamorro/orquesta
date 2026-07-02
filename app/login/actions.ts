"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"

const SESSION_COOKIE = "orquesta_session"

export async function login(formData: FormData): Promise<void> {
  const password = String(formData.get("password") ?? "")
  const next = String(formData.get("next") ?? "/dashboard")
  const expected = process.env.ORQUESTA_UI_PASSWORD

  if (!expected || password !== expected) {
    redirect(`/login?error=1&next=${encodeURIComponent(next)}`)
  }

  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE, expected, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  })

  redirect(next)
}

export async function logout(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE)
  redirect("/login")
}
