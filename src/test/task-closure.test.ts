import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Bus } from "../bus/bus";
import { createTaskWorktree } from "../core/git";
import { PlanStore } from "../core/plan-store";
import { closeTask } from "../daemon/task-closure";

const run = (cwd: string, args: string[]) => {
  const proc = Bun.spawnSync(args, { cwd, stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) {
    throw new Error(proc.stderr.toString() || `failed: ${args.join(" ")}`);
  }
  return proc.stdout.toString().trim();
};

const initRepo = () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "orq-close-"));
  mkdirSync(path.join(root, ".orquesta", "crew"), { recursive: true });
  run(root, ["git", "init", "-b", "main"]);
  run(root, ["git", "config", "user.email", "test@example.com"]);
  run(root, ["git", "config", "user.name", "Orquesta Test"]);
  writeFileSync(path.join(root, "README.md"), "base\n");
  run(root, ["git", "add", "."]);
  run(root, ["git", "commit", "-m", "init"]);
  return root;
};

test("task closure merges branch and archives sessions", async () => {
  const root = initRepo();
  const store = new PlanStore(root);
  const workspace = createTaskWorktree(root, "task-1", "main");
  const sessionDir = path.join(workspace.worktreePath, ".orq", "sub-1");
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(path.join(sessionDir, "CLAUDE.md"), "session");
  writeFileSync(path.join(workspace.worktreePath, "feature.txt"), "hello\n");
  await store.saveTask({
    id: "task-1",
    title: "Task",
    status: "running",
    depends_on: [],
    iteration: 1,
    worktree_path: workspace.worktreePath,
    branch: workspace.branch,
    base_branch: workspace.baseBranch,
    created_at: "a",
    updated_at: "a",
    attempt_count: 1,
    subtasks: ["sub-1"],
  });
  await store.saveSubtask({
    id: "sub-1",
    taskId: "task-1",
    type: "code",
    role: "coder",
    status: "done",
    prompt: "x",
    depends_on: [],
    created_at: "a",
    summary: "implemented",
  });
  await store.saveAgent({
    id: "agent-1",
    role: "coder",
    cli: "claude",
    model: "m",
    status: "dead",
    session_cwd: sessionDir,
    bound_subtask: "sub-1",
  });
  const bus = new Bus();
  const task = await closeTask({
    root,
    store,
    pool: { kill() {}, waitForExit() { return Promise.resolve(0); } } as never,
    bus,
    config: {
      dependencies: "strict",
      concurrency: { workers: 1, max: 1 },
      review: { enabled: true, maxIterations: 1 },
      work: { maxAttemptsPerTask: 1, maxWaves: 1, maxIterations: 1 },
      git: { enabled: true, baseBranch: "main", autoCommit: true, removeWorktreeOnArchive: true },
      team: [],
    },
    taskId: "task-1",
    closureReason: "critic_ok",
  });
  expect(task.merge_commit).toBeString();
  expect(task.archive_path).toBeString();
  expect(existsSync(path.join(root, "feature.txt"))).toBeTrue();
  expect(existsSync(task.archive_path!)).toBeTrue();
  expect(existsSync(workspace.worktreePath)).toBeFalse();
  rmSync(root, { recursive: true, force: true });
});
