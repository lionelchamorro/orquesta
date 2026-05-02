import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Bus } from "../bus/bus";
import { PlanStore } from "../core/plan-store";
import { TaskPipeline } from "../daemon/task-pipeline";

const run = (cwd: string, args: string[]) => {
  const proc = Bun.spawnSync(args, { cwd, stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) throw new Error(proc.stderr.toString() || `failed: ${args.join(" ")}`);
  return proc.stdout.toString().trim();
};

const initRepo = () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "orq-e2e-"));
  mkdirSync(path.join(root, ".orquesta", "crew"), { recursive: true });
  run(root, ["git", "init", "-b", "main"]);
  run(root, ["git", "config", "user.email", "test@example.com"]);
  run(root, ["git", "config", "user.name", "Orquesta Test"]);
  writeFileSync(path.join(root, "README.md"), "base\n");
  run(root, ["git", "add", "."]);
  run(root, ["git", "commit", "-m", "init"]);
  return root;
};

test("e2e happy path runs pipeline, merges and archives task", async () => {
  const root = initRepo();
  const store = new PlanStore(root);
  const bus = new Bus();

  await store.savePlan({
    runId: "run-1",
    prd: "(prompt)",
    prompt: "build feature",
    status: "running",
    created_at: "a",
    updated_at: "a",
    task_count: 1,
    completed_count: 0,
    current_iteration: 1,
    max_iterations: 1,
  });
  await store.saveTask({
    id: "task-1",
    title: "Build feature",
    description: "Implement feature",
    status: "pending",
    depends_on: [],
    iteration: 1,
    created_at: "a",
    updated_at: "a",
    attempt_count: 0,
    subtasks: [],
  });

  const exitResolvers = new Map<string, () => void>();
  const exitPromises = new Map<string, Promise<number>>();
  let agentCounter = 0;
  const pool = {
    async spawn(role: "coder" | "tester" | "critic", _cli: string, _model: string, _prompt: string, options: { taskId?: string; subtaskId?: string; sessionDir?: string }) {
      agentCounter += 1;
      const agentId = `agent-${agentCounter}`;
      const exitPromise = new Promise<number>((resolve) => exitResolvers.set(agentId, () => resolve(0)));
      exitPromises.set(agentId, exitPromise);
      await store.saveAgent({
        id: agentId,
        role,
        cli: "claude",
        model: "m",
        status: "live",
        session_cwd: options.sessionDir ?? ".",
        bound_subtask: options.subtaskId,
      });
      if (options.sessionDir) mkdirSync(options.sessionDir, { recursive: true });
      setTimeout(async () => {
        const task = await store.loadTask(options.taskId!);
        const subtask = await store.loadSubtask(task.id, options.subtaskId!);
        if (role === "coder" && task.worktree_path) {
          writeFileSync(path.join(task.worktree_path, `${subtask.id}.txt`), `${subtask.id}\n`);
        }
        await store.saveSubtask({
          ...subtask,
          status: "done",
          completed_at: new Date().toISOString(),
          summary: `${role} finished`,
          findings: role === "critic" ? [] : subtask.findings,
        });
        bus.publish({
          tags: [task.id, subtask.id, agentId],
          payload: { type: "subtask_completed", subtaskId: subtask.id, summary: `${role} finished` },
        });
      }, 5);
      return { id: agentId, exited: exitPromise };
    },
    kill(agentId: string) {
      exitResolvers.get(agentId)?.();
    },
    waitForExit(agentId: string) {
      return exitPromises.get(agentId) ?? Promise.resolve(0);
    },
    getRateLimit() {
      return null;
    },
  } as never;

  const pipeline = new TaskPipeline(store, bus, pool, {
    dependencies: "strict",
    concurrency: { workers: 1, max: 1 },
    review: { enabled: true, maxIterations: 1 },
    work: { maxAttemptsPerTask: 2, maxWaves: 1, maxIterations: 1, maxQuotaWaitMs: 7200000 },
    git: { enabled: true, baseBranch: "main", autoCommit: true, removeWorktreeOnArchive: true },
    team: [
      { role: "coder", cli: "claude", model: "m" },
      { role: "tester", cli: "claude", model: "m" },
      { role: "critic", cli: "claude", model: "m" },
    ],
  });

  await pipeline.run(await store.loadTask("task-1"));

  const task = await store.loadTask("task-1");
  expect(task.status).toBe("done");
  expect(task.merge_commit).toBeString();
  expect(task.archive_path).toBeString();
  expect(task.closure_reason).toBe("critic_ok");
  expect(run(root, ["git", "show", "--stat", "--oneline", "HEAD"])).toContain("sub-1.txt");
  rmSync(root, { recursive: true, force: true });
});
