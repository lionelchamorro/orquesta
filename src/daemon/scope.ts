import type { Role, Task } from "../core/types";

export type Scope =
  | { kind: "none" }
  | { kind: "diff"; stat: string; body: string }
  | { kind: "files"; files: string[] };

const reviewerRoles: Role[] = ["tester", "critic"];

export const requiresReviewableScope = (role: Role): boolean => reviewerRoles.includes(role);

/**
 * deriveScope decides what scope a tester/critic should be given for a task.
 * The two readers are injected so this stays pure and testable.
 *
 * Order of preference:
 *  1. Git diff (worktree + base_branch present and the diff has any content).
 *  2. File listing (worktree present, even with no git or no diff).
 *  3. None — caller must abort the subtask.
 */
export const deriveScope = (
  task: Pick<Task, "worktree_path" | "base_branch">,
  readDiff: (worktreePath: string, baseBranch: string) => { stat: string; body: string },
  listFiles: (worktreePath: string) => string[],
): Scope => {
  if (!task.worktree_path) return { kind: "none" };
  if (task.base_branch) {
    const { stat, body } = readDiff(task.worktree_path, task.base_branch);
    if (stat.trim().length > 0 || body.trim().length > 0) {
      return { kind: "diff", stat, body };
    }
  }
  const files = listFiles(task.worktree_path);
  if (files.length > 0) return { kind: "files", files };
  return { kind: "none" };
};

/** A stale agent report claiming "nothing to test" with no derivable scope must
 * not be allowed to mark a task done. The pipeline calls this after the
 * subtask completes to decide whether to honour the agent's verdict. */
export const isFakeGreenSummary = (summary: string): boolean => {
  if (!summary) return true;
  const normalized = summary.toLowerCase();
  const phrases = [
    "no tests run",
    "nothing to test",
    "nothing to review",
    "no coder output",
    "the worktree contains no",
    "no changes to",
  ];
  return phrases.some((phrase) => normalized.includes(phrase));
};
