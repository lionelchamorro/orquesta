import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
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
const sanitizeRefSegment = (value: string) => value.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^-+|-+$/g, "") || "run";
export const worktreeBranchName = (taskId: string, runId = "run-1") => `orq/${sanitizeRefSegment(runId)}/${sanitizeRefSegment(taskId)}`;
export const worktreePathForTask = (root: string, taskId: string, runId = "run-1") =>
  path.join(root, ".orquesta", "crew", "worktrees", sanitizeRefSegment(runId), sanitizeRefSegment(taskId));
export const isolatedWorkspacePathForTask = (root: string, taskId: string, runId = "run-1") =>
  path.join(root, ".orquesta", "crew", "workspaces", sanitizeRefSegment(runId), sanitizeRefSegment(taskId));
export const archivePathForTask = (root: string, taskId: string, runId = "run-1") =>
  path.join(root, ".orquesta", "crew", "archive", sanitizeRefSegment(runId), sanitizeRefSegment(taskId));

export const ensureRepoReady = (cwd: string, baseBranch: string) => {
  if (!gitAvailable()) return false;
  if (!isGitRepo(cwd)) return false;
  if (!git(cwd, ["rev-parse", "--verify", baseBranch]).success) return false;
  return true;
};

const branchExists = (root: string, branch: string) => git(root, ["show-ref", "--verify", `refs/heads/${branch}`]).success;

const ownedMarkerPath = (worktreePath: string) => path.join(worktreePath, ".orquesta-worktree");

export const isOrquestaOwnedWorktree = (worktreePath: string, taskId?: string, runId?: string) => {
  if (!existsSync(ownedMarkerPath(worktreePath))) return false;
  const marker = readFileSync(ownedMarkerPath(worktreePath), "utf8");
  if (taskId && !marker.includes(`taskId=${taskId}\n`)) return false;
  if (runId && !marker.includes(`runId=${runId}\n`)) return false;
  return true;
};

export const createTaskWorktree = (root: string, taskId: string, baseBranch: string, runId = "run-1") => {
  const branch = worktreeBranchName(taskId, runId);
  const worktreePath = worktreePathForTask(root, taskId, runId);
  if (existsSync(worktreePath)) {
    if (!isOrquestaOwnedWorktree(worktreePath, taskId, runId)) {
      throw new Error(`Refusing to remove non-Orquesta worktree path ${worktreePath}`);
    }
    rmSync(worktreePath, { recursive: true, force: true });
  }
  void git(root, ["worktree", "prune"]);
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
    current.includes(".orquesta-worktree") ? "" : ".orquesta-worktree\n",
  ].join("");
  Bun.write(excludePath, entries);
  writeFileSync(ownedMarkerPath(worktreePath), `runId=${runId}\ntaskId=${taskId}\nbranch=${branch}\n`);
  return { worktreePath, branch, baseBranch };
};

export const createIsolatedWorkspace = (root: string, taskId: string, runId = "run-1") => {
  const workspacePath = isolatedWorkspacePathForTask(root, taskId, runId);
  rmSync(workspacePath, { recursive: true, force: true });
  mkdirSync(workspacePath, { recursive: true });
  return { worktreePath: workspacePath };
};

export const hasUncommittedChanges = (cwd: string, options: { includeUntracked?: boolean } = { includeUntracked: true }) =>
  git(cwd, ["status", "--porcelain"]).stdout
    .split("\n")
    .filter(Boolean)
    .some((line) => {
      if (line.startsWith("??") && options.includeUntracked === false) return false;
      const file = line.slice(3);
      return !file.startsWith(".orquesta/");
    });

export const autoCommitAll = (cwd: string, message: string) => {
  if (!hasUncommittedChanges(cwd)) return null;
  requireGit(cwd, ["add", "-A"]);
  requireGit(cwd, ["commit", "-m", message]);
  return requireGit(cwd, ["rev-parse", "HEAD"]);
};

export const currentBranch = (root: string) => requireGit(root, ["branch", "--show-current"]);

export const mergeBranch = (root: string, branch: string, baseBranch: string, title: string) => {
  if (hasUncommittedChanges(root, { includeUntracked: false })) {
    throw new Error("Root checkout has uncommitted changes; refusing to merge task branch");
  }
  requireGit(root, ["checkout", baseBranch]);
  const result = git(root, ["merge", "--no-ff", branch, "-m", `Merge ${title}`]);
  if (!result.success) {
    void git(root, ["merge", "--abort"]);
    throw new Error(result.stderr.trim() || result.stdout.trim() || `Failed to merge ${branch}`);
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
  if (!isOrquestaOwnedWorktree(worktreePath)) {
    throw new Error(`Refusing to remove unowned worktree ${worktreePath}`);
  }
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
