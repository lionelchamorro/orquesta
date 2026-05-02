import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { Journal } from "../bus/journal";
import { gitAvailable, isGitRepo, safeGitOutput } from "../core/git";
import { PlanStore } from "../core/plan-store";
import { installBuildDagSkill, uninstallBuildDagSkill, type SkillTarget } from "./skill-install";
import { checkCrewCompatibility, migrateCrew } from "../daemon/compatibility";
import { ingestRun, readRunSource } from "../daemon/run-ingest";

const root = process.cwd();

function resolveDaemonEntry(): string | null {
  const fromSource = path.resolve(import.meta.dir, "..", "daemon", "index.ts");
  if (existsSync(fromSource)) return fromSource;
  const binDir = path.dirname(realpathSync(process.execPath));
  const fromCompiledBin = path.join(binDir, "..", "src", "daemon", "index.ts");
  return existsSync(fromCompiledBin) ? fromCompiledBin : null;
}

const templatesDir = path.resolve(import.meta.dir, "..", "..", "templates");
const store = new PlanStore(root);

const parseSkillTarget = (args: string[]): SkillTarget => {
  const index = args.indexOf("--target");
  const raw = index >= 0 ? args[index + 1] : "all";
  if (raw === "claude" || raw === "codex" || raw === "gemini" || raw === "all") return raw;
  throw new Error(`Invalid skill target: ${raw}`);
};

const printStatus = async () => {
  const plan = await store.loadPlan();
  const tasks = await store.loadTasks();
  console.log(`Run ${plan.runId} - ${plan.status} - iteration ${plan.current_iteration}/${plan.max_iterations}`);
  for (const task of tasks) {
    console.log(`${task.id} [${task.status}] ${task.title}`);
  }
};

export const main = async () => {
  const [command, ...rest] = Bun.argv.slice(2);
  if (!command) {
    console.log("Usage: orq <run|import|skill|migrate|start|status|logs|doctor>");
    return;
  }

  const startRunFromFile = async (file: string, options: { deprecatedImport?: boolean } = {}) => {
    if (!file) {
      console.log(options.deprecatedImport ? "Usage: orq import <file>" : "Usage: orq run start <file>");
      return;
    }
    if (options.deprecatedImport) {
      console.warn("orq import is deprecated; use `orq run start <file>`.");
    }
    const filePath = path.resolve(root, file);
    const fileHandle = Bun.file(filePath);
    if (!(await fileHandle.exists())) {
      console.error(`Import file not found: ${filePath}`);
      process.exitCode = 1;
      return;
    }
    const payload = await fileHandle.json().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to parse ${filePath}: ${message}`);
      process.exitCode = 1;
      return null;
    });
    if (payload === null) return;

    const daemonPort = Number(Bun.env.ORQ_PORT ?? 8000);
    const sessionToken = await Bun.file(store.crewPath("session.token")).text().then((text) => text.trim()).catch(() => "");
    try {
      const response = await fetch(`http://localhost:${daemonPort}/api/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(sessionToken ? { "X-Orquesta-Token": sessionToken } : {}) },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok) {
        console.log(`Run started via daemon: runId=${body.runId}`);
        return;
      }
      console.error(`Daemon rejected run start (${response.status}): ${body.error?.message ?? body.error ?? "unknown error"}`);
      process.exitCode = 1;
      return;
    } catch {
      console.log(`Daemon not reachable on :${daemonPort}. Starting run in-process...`);
      const result = await ingestRun(store, payload);
      if (!result.ok) {
        console.error(`Run start failed (${result.error.code}): ${result.error.message}`);
        process.exitCode = 1;
        return;
      }
      console.log(`Run started in-process: runId=${result.runId}`);
      return;
    }
  };

  if (command === "run") {
    const [subcommand, ...runRest] = rest;
    if (subcommand === "start") {
      await startRunFromFile(runRest[0]);
      return;
    }
    if (subcommand === "cancel") {
      const daemonPort = Number(Bun.env.ORQ_PORT ?? 8000);
      const sessionToken = await Bun.file(store.crewPath("session.token")).text().then((text) => text.trim()).catch(() => "");
      const runId = runRest[0] ?? (await store.loadPlan()).runId;
      try {
        const response = await fetch(`http://localhost:${daemonPort}/api/runs/${runId}/cancel`, {
          method: "POST",
          headers: sessionToken ? { "X-Orquesta-Token": sessionToken } : {},
        });
        const body = await response.json().catch(() => ({}));
        if (response.ok) {
          console.log(`Run cancelled: runId=${runId} archive=${body.archive_path}`);
          return;
        }
        console.error(`Daemon rejected run cancel (${response.status}): ${body.error ?? "unknown error"}`);
        process.exitCode = 1;
        return;
      } catch {
      const archivePath = await store.archiveRun("cancelled");
        console.log(`Run cancelled in-process: runId=${runId} archive=${archivePath}`);
        return;
      }
    }
    console.log("Usage: orq run <start|cancel> ...");
    return;
  }

  if (command === "skill") {
    const [subcommand, ...skillRest] = rest;
    try {
      const target = parseSkillTarget(skillRest);
      if (subcommand === "install") {
        installBuildDagSkill(root, templatesDir, target);
        console.log(`Installed orquesta-build-dag skill for ${target}.`);
        return;
      }
      if (subcommand === "uninstall") {
        uninstallBuildDagSkill(root, target);
        console.log(`Uninstalled orquesta-build-dag skill for ${target}.`);
        return;
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
      return;
    }
    console.log("Usage: orq skill <install|uninstall> [--target claude|codex|gemini|all]");
    return;
  }

  if (command === "import") {
    await startRunFromFile(rest[0], { deprecatedImport: true });
    return;
  }

  if (command === "start") {
    const daemonEntry = resolveDaemonEntry();
    if (!daemonEntry) {
      console.error("Unable to locate daemon entrypoint. Run from the source checkout or rebuild with `bun run build`.");
      process.exitCode = 1;
      return;
    }
    const proc = Bun.spawn(["bun", "run", daemonEntry], { stdout: "inherit", stderr: "inherit", stdin: "inherit" });
    const exitCode = await proc.exited;
    process.exitCode = exitCode;
    return;
  }

  if (command === "status") {
    await printStatus();
    return;
  }

  if (command === "logs") {
    const journal = new Journal(store.crewPath("journal.sqlite"));
    for (const event of journal.query({ limit: 25 })) {
      console.log(`${event.ts} ${event.payload.type} ${event.tags.join(",")}`);
    }
    journal.close();
    return;
  }

  if (command === "doctor") {
    const plan = await store.loadPlan();
    const tasks = await store.loadTasks();
    const tokenExists = await Bun.file(store.crewPath("session.token")).exists();
    console.log(`Bun: ${Bun.version}`);
    console.log(`Git available: ${gitAvailable() ? "yes" : "no"}`);
    console.log(`Git repo: ${isGitRepo(root) ? "yes" : "no"}`);
    console.log(`Branch: ${safeGitOutput(root, ["branch", "--show-current"]).trim() || "-"}`);
    console.log(`Dirty: ${safeGitOutput(root, ["status", "--porcelain"]).trim() ? "yes" : "no"}`);
    console.log(`CLIs: claude=${Bun.which("claude") ? "yes" : "no"} codex=${Bun.which("codex") ? "yes" : "no"} gemini=${Bun.which("gemini") ? "yes" : "no"}`);
    console.log(`Session token: ${tokenExists ? "present" : "missing"}`);
    console.log(`Crew dir: ${store.crewPath()}`);
    console.log(`Plan: ${plan.runId} ${plan.status} tasks=${tasks.length} completed=${tasks.filter((task) => task.status === "done").length}`);
    console.log(`Imported-run support: ok`);
    console.log(`Run source: ${await readRunSource(store)}`);
    return;
  }

  if (command === "migrate") {
    const issues = checkCrewCompatibility(store);
    if (issues.length === 0) {
      console.log("No crew migration needed.");
      return;
    }
    const archivePath = migrateCrew(store);
    console.log(`Migrated incompatible crew state to ${archivePath}`);
    return;
  }

  if (!command) {
    console.log("Usage: orq <run|import|skill|migrate|start|status|logs|doctor>");
    return;
  }

  console.log(`Unknown command: ${command}`);
};

if (import.meta.main) {
  await main();
}
