import Link from "next/link"
import {
  ArrowRight,
  GitPullRequest,
  Moon,
  Terminal,
  Users,
  ShieldCheck,
  Boxes,
  GitCommitHorizontal,
  CircuitBoard,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { LandingNav } from "@/components/landing/landing-nav"
import { BrandMark } from "@/components/brand-mark"
import { teamRoles } from "@/lib/mock-data"

export default function HomePage() {
  return (
    <div className="min-h-dvh">
      <LandingNav />
      <main>
        <Hero />
        <Capabilities />
        <HowItWorks />
        <Roles />
        <FactoryCallout />
        <CtaFooter />
      </main>
    </div>
  )
}

function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-border/60">
      <div className="glow-grid pointer-events-none absolute inset-0 opacity-60" aria-hidden="true" />
      <div
        className="pointer-events-none absolute left-1/2 top-0 h-[420px] w-[820px] -translate-x-1/2 rounded-full bg-primary/15 blur-[120px]"
        aria-hidden="true"
      />
      <div className="relative mx-auto flex max-w-4xl flex-col items-center px-5 py-24 text-center md:py-32">
        <div className="mb-8 flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 font-mono text-[11px] tracking-wide text-muted-foreground">
          <Moon className="h-3.5 w-3.5 text-primary" />
          night agent · single Go binary · file-based state
        </div>
        <h1 className="text-balance font-mono text-4xl font-semibold leading-[1.05] tracking-tight md:text-6xl">
          Orchestrate AI agents
          <br />
          <span className="text-primary">across every project</span>
        </h1>
        <p className="mt-6 max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground md:text-lg">
          Orquesta drives CLI-based AI agents through parser, coder, tester, critic and
          reviewer roles until your plan ships — task by task. Manage all your repos,
          teams and tasks from one console with a global chat.
        </p>
        <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row">
          <Button asChild size="lg" className="font-mono">
            <Link href="/dashboard">
              Open the console
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="font-mono">
            <Link href="/projects/orquestalite">View a live project</Link>
          </Button>
        </div>
        <div className="mt-12 flex flex-wrap items-center justify-center gap-x-7 gap-y-3 font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
          <span className="flex items-center gap-2">
            <Moon className="h-3.5 w-3.5 text-primary" /> Night agent
          </span>
          <span className="flex items-center gap-2">
            <Terminal className="h-3.5 w-3.5 text-primary" /> Autonomous
          </span>
          <span className="flex items-center gap-2">
            <Users className="h-3.5 w-3.5 text-primary" /> Multi-agent
          </span>
          <span className="flex items-center gap-2">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" /> Reliable
          </span>
        </div>
      </div>
    </section>
  )
}

const capabilities = [
  {
    icon: Boxes,
    title: "Multi-project registry",
    body: "A file-based projects.json holds every repo, workspace path and base branch. No database — each project keeps its own state under .orquestalite/.",
  },
  {
    icon: GitPullRequest,
    title: "Per-project watchers",
    body: "Toggle PR and issue daemons independently per project. The watcher polls only the streams you enable for each repo.",
  },
  {
    icon: CircuitBoard,
    title: "Nested review loops",
    body: "Tasks run through review and fix cycles. JSON result contracts written by each agent decide what happens next.",
  },
  {
    icon: GitCommitHorizontal,
    title: "Commit on success",
    body: "The orchestrator never edits files itself. It invokes agents as subprocesses, reads their results, and commits passing tasks.",
  },
]

function Capabilities() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-20">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {capabilities.map((c) => (
          <div
            key={c.title}
            className="rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/40"
          >
            <c.icon className="h-5 w-5 text-primary" />
            <h3 className="mt-4 font-mono text-sm font-semibold">{c.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{c.body}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

const steps = [
  { n: "01", title: "Describe the feature", body: "Drop a free-form plan into the global chat or a project's feature.md." },
  { n: "02", title: "Parser decomposes it", body: "The plan becomes structured tasks tracked in .orquestalite/tasks.json." },
  { n: "03", title: "Agents run the loop", body: "Coder, tester and critic iterate through nested review/fix cycles." },
  { n: "04", title: "Reviewer commits", body: "Approved tasks are committed; failures escalate to needs_human." },
]

function HowItWorks() {
  return (
    <section id="how" className="border-y border-border/60 bg-card/30">
      <div className="mx-auto max-w-6xl px-5 py-20">
        <div className="mb-12 max-w-2xl">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">How it works</p>
          <h2 className="mt-3 text-balance font-mono text-3xl font-semibold tracking-tight">
            From a plan to merged commits
          </h2>
        </div>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {steps.map((s) => (
            <div key={s.n} className="relative">
              <span className="font-mono text-2xl font-semibold text-primary/40">{s.n}</span>
              <h3 className="mt-3 font-mono text-sm font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function Roles() {
  return (
    <section id="roles" className="mx-auto max-w-6xl px-5 py-20">
      <div className="mb-12 max-w-2xl">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Agent roles</p>
        <h2 className="mt-3 text-balance font-mono text-3xl font-semibold tracking-tight">
          A pipeline of specialized agents
        </h2>
      </div>
      <div className="flex flex-col gap-3 md:flex-row md:items-stretch">
        {teamRoles.map((r, i) => (
          <div key={r.role} className="flex flex-1 items-stretch">
            <div className="flex-1 rounded-xl border border-border bg-card p-5">
              <span className="font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="mt-2 font-mono text-base font-semibold text-foreground">{r.label}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{r.blurb}</p>
            </div>
            {i < teamRoles.length - 1 && (
              <div className="hidden items-center px-1 text-primary/50 md:flex">
                <ArrowRight className="h-4 w-4" />
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

function FactoryCallout() {
  return (
    <section id="factory" className="border-y border-border/60 bg-card/30">
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-20 lg:grid-cols-2">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">The factory</p>
          <h2 className="mt-3 text-balance font-mono text-3xl font-semibold tracking-tight">
            Queue features, watch them build live
          </h2>
          <p className="mt-5 text-pretty leading-relaxed text-muted-foreground">
            Each project ships with a factory: a queue of features that the orchestrator
            works through autonomously. Watch the live event stream, inspect per-task
            diffs, and track cost in real time — all from the console.
          </p>
          <Button asChild size="lg" className="mt-7 font-mono">
            <Link href="/dashboard">
              Explore the factory
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
        <div className="rounded-xl border border-border bg-background p-5 font-mono text-xs">
          <div className="mb-4 flex items-center gap-2 text-muted-foreground">
            <span className="h-2.5 w-2.5 rounded-full bg-err/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-warn/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-ok/70" />
            <span className="ml-2">orq-lite factory</span>
          </div>
          <pre className="overflow-x-auto leading-relaxed text-muted-foreground">
            <code>{`> orq-lite factory --project orquestalite
[parser]   plan -> 4 tasks
[coder]    t-2042  implementing... ok 47s
[tester]   t-2042  pnpm test       pass
[critic]   t-2042  review          approve
[reviewer] t-2042  commit a91b3c4d done
`}</code>
            <code className="text-ok">{`✓ feature f-204 · 3 done · $2.14`}</code>
          </pre>
        </div>
      </div>
    </section>
  )
}

function CtaFooter() {
  return (
    <footer className="mx-auto max-w-6xl px-5 py-20">
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-10 text-center md:p-16">
        <div
          className="pointer-events-none absolute left-1/2 top-0 h-64 w-[600px] -translate-x-1/2 rounded-full bg-primary/15 blur-[100px]"
          aria-hidden="true"
        />
        <div className="relative flex flex-col items-center">
          <BrandMark className="h-10 w-10" />
          <h2 className="mt-6 text-balance font-mono text-3xl font-semibold tracking-tight">
            Run your agents while you sleep
          </h2>
          <p className="mt-4 max-w-xl text-pretty leading-relaxed text-muted-foreground">
            One console for every project, team and task. Start orchestrating with Orquesta.
          </p>
          <Button asChild size="lg" className="mt-8 font-mono">
            <Link href="/dashboard">
              Open the console
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
      <div className="mt-10 flex flex-col items-center justify-between gap-4 border-t border-border/60 pt-8 font-mono text-xs text-muted-foreground sm:flex-row">
        <span>ORQUESTA — AI Agent Orchestration Framework</span>
        <span>github.com/lionelchamorro/orquestalite</span>
      </div>
    </footer>
  )
}
