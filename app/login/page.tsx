import { login } from "./actions"

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>
}) {
  const params = await searchParams
  const next = params.next ?? "/dashboard"

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-4">
      <form
        action={login}
        className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-card p-6"
      >
        <h1 className="font-mono text-lg font-semibold">orquesta</h1>
        <input type="hidden" name="next" value={next} />
        <label className="flex flex-col gap-1">
          <span className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
            Password
          </span>
          <input
            type="password"
            name="password"
            required
            autoFocus
            className="rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary/50"
          />
        </label>
        {params.error && <p className="font-mono text-xs text-err">Incorrect password.</p>}
        <button
          type="submit"
          className="w-full rounded-lg bg-primary px-3 py-2 font-mono text-sm text-primary-foreground transition-colors hover:bg-primary/80"
        >
          Sign in
        </button>
      </form>
    </div>
  )
}
