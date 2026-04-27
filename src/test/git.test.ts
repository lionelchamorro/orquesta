import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  autoCommitAll,
  createTaskWorktree,
  ensureRepoReady,
  hasUncommittedChanges,
  isGitRepo,
  mergeBranch,
  removeWorktree,
  worktreeBranchName,
} from "../core/git";

const run = (cwd: string, args: string[]) => {
  const proc = Bun.spawnSync(args, { cwd, stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) {
    throw new Error(proc.stderr.toString() || `failed: ${args.join(" ")}`);
  }
  return proc.stdout.toString().trim();
};

const initRepo = () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "orq-git-"));
  run(root, ["git", "init", "-b", "main"]);
  run(root, ["git", "config", "user.email", "test@example.com"]);
  run(root, ["git", "config", "user.name", "Orquesta Test"]);
  writeFileSync(path.join(root, "README.md"), "base\n");
  run(root, ["git", "add", "."]);
  run(root, ["git", "commit", "-m", "init"]);
  return root;
};

test("git helpers create worktree and merge changes", () => {
  const root = initRepo();
  expect(isGitRepo(root)).toBeTrue();
  expect(ensureRepoReady(root, "main")).toBeTrue();
  const workspace = createTaskWorktree(root, "task-1", "main");
  writeFileSync(path.join(workspace.worktreePath, "feature.txt"), "hello\n");
  expect(hasUncommittedChanges(workspace.worktreePath)).toBeTrue();
  expect(autoCommitAll(workspace.worktreePath, "auto")).toBeString();
  const mergeSha = mergeBranch(root, workspace.branch, "main", "task-1");
  expect(mergeSha.length).toBeGreaterThan(5);
  expect(existsSync(path.join(root, "feature.txt"))).toBeTrue();
  removeWorktree(root, workspace.worktreePath);
  expect(existsSync(workspace.worktreePath)).toBeFalse();
  rmSync(root, { recursive: true, force: true });
});

test("git helpers use run-scoped branches and protect unowned worktrees", () => {
  const root = initRepo();
  expect(worktreeBranchName("task-1", "run-abc")).toBe("orq/run-abc/task-1");
  const workspace = createTaskWorktree(root, "task-1", "main", "run-abc");
  expect(workspace.branch).toBe("orq/run-abc/task-1");
  removeWorktree(root, workspace.worktreePath);
  mkdirSync(workspace.worktreePath, { recursive: true });
  writeFileSync(path.join(workspace.worktreePath, "user-file.txt"), "do not remove\n");
  expect(() => createTaskWorktree(root, "task-1", "main", "run-abc")).toThrow("Refusing to remove");
  rmSync(root, { recursive: true, force: true });
});
