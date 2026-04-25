import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import path from "node:path";

type GitResult = { success: boolean; stdout: string; stderr: string };

const git = (cwd: string, args: string[]): GitResult => {
  const proc = Bun.spawnSync(["git", "-C", cwd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    success: proc.exitCode === 0,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
};

const requireGit = (cwd: string, args: string[]) => {
  const result = git(cwd, args);
  if (!result.success) {
    throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
  }
  return result.stdout.trim();
};

export const gitAvailable = () => Bun.which("git") !== null;
export const isGitRepo = (cwd: string) => gitAvailable() && git(cwd, ["rev-parse", "--is-inside-work-tree"]).success;
export const worktreeBranchName = (taskId: string) => `orq/${taskId}`;
export const worktreePathForTask = (root: string, taskId: string) => path.join(root, ".orquesta", "crew", "worktrees", taskId);
export const archivePathForTask = (root: string, taskId: string) => path.join(root, ".orquesta", "crew", "archive", taskId);

export const ensureRepoReady = (cwd: string, baseBranch: string) => {
  if (!gitAvailable()) return false;
  if (!isGitRepo(cwd)) return false;
  if (!git(cwd, ["rev-parse", "--verify", baseBranch]).success) return false;
  return true;
};

const branchExists = (root: string, branch: string) => git(root, ["show-ref", "--verify", `refs/heads/${branch}`]).success;

export const createTaskWorktree = (root: string, taskId: string, baseBranch: string) => {
  const branch = worktreeBranchName(taskId);
  const worktreePath = worktreePathForTask(root, taskId);
  rmSync(worktreePath, { recursive: true, force: true });
  mkdirSync(path.dirname(worktreePath), { recursive: true });
  if (branchExists(root, branch)) {
    requireGit(root, ["worktree", "add", worktreePath, branch]);
  } else {
    requireGit(root, ["worktree", "add", worktreePath, "-b", branch, baseBranch]);
  }
  const excludePath = requireGit(worktreePath, ["rev-parse", "--git-path", "info/exclude"]);
  const current = existsSync(excludePath) ? readFileSync(excludePath, "utf8") : "";
  const entries = [
    current,
    current.includes(".orq/") ? "" : ".orq/\n",
    current.includes(".mcp.json") ? "" : ".mcp.json\n",
  ].join("");
  Bun.write(excludePath, entries);
  return { worktreePath, branch, baseBranch };
};

export const hasUncommittedChanges = (cwd: string) => git(cwd, ["status", "--porcelain"]).stdout.trim().length > 0;

export const autoCommitAll = (cwd: string, message: string) => {
  if (!hasUncommittedChanges(cwd)) return null;
  requireGit(cwd, ["add", "-A"]);
  requireGit(cwd, ["commit", "-m", message]);
  return requireGit(cwd, ["rev-parse", "HEAD"]);
};

export const mergeBranch = (root: string, branch: string, baseBranch: string, title: string) => {
  requireGit(root, ["checkout", baseBranch]);
  const result = git(root, ["merge", "--no-ff", branch, "-m", `Merge ${title}`]);
  if (!result.success) {
    void git(root, ["merge", "--abort"]);
    throw new Error(result.stderr.trim() || `Failed to merge ${branch}`);
  }
  return requireGit(root, ["rev-parse", "HEAD"]);
};

export const diffStat = (cwd: string, fromRef: string, toRef: string) => requireGit(cwd, ["diff", "--stat", `${fromRef}..${toRef}`]);

export const safeGitOutput = (cwd: string, args: string[]): string => {
  try {
    const result = git(cwd, args);
    return result.success ? result.stdout : "";
  } catch {
    return "";
  }
};

export const removeWorktree = (root: string, worktreePath: string) => {
  const result = git(root, ["worktree", "remove", worktreePath, "--force"]);
  if (!result.success) {
    throw new Error(result.stderr.trim() || `Failed to remove worktree ${worktreePath}`);
  }
};

export const archiveSessionDir = (source: string, target: string) => {
  mkdirSync(path.dirname(target), { recursive: true });
  rmSync(target, { recursive: true, force: true });
  renameSync(source, target);
};
