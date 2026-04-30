import { expect, test } from "bun:test";
import { deriveScope, isFakeGreenSummary, requiresReviewableScope } from "../daemon/scope";

test("requiresReviewableScope is true only for tester and critic", () => {
  expect(requiresReviewableScope("tester")).toBe(true);
  expect(requiresReviewableScope("critic")).toBe(true);
  expect(requiresReviewableScope("coder")).toBe(false);
  expect(requiresReviewableScope("planner")).toBe(false);
});

test("deriveScope returns none when no worktree path", () => {
  const scope = deriveScope({}, () => ({ stat: "", body: "" }), () => []);
  expect(scope.kind).toBe("none");
});

test("deriveScope prefers git diff when stat or body is non-empty", () => {
  const scope = deriveScope(
    { worktree_path: "/wt", base_branch: "main" },
    () => ({ stat: " M file.go | 2 +-", body: "diff --git a/file.go ..." }),
    () => ["file.go"],
  );
  expect(scope.kind).toBe("diff");
  if (scope.kind !== "diff") throw new Error("unreachable");
  expect(scope.stat).toContain("file.go");
});

test("deriveScope falls back to files when worktree exists but diff is empty", () => {
  const scope = deriveScope(
    { worktree_path: "/wt", base_branch: "main" },
    () => ({ stat: "", body: "" }),
    () => ["go.mod", "main.go"],
  );
  expect(scope.kind).toBe("files");
  if (scope.kind !== "files") throw new Error("unreachable");
  expect(scope.files).toEqual(["go.mod", "main.go"]);
});

test("deriveScope falls back to files for non-git worktree (no base_branch)", () => {
  const scope = deriveScope(
    { worktree_path: "/wt" },
    () => ({ stat: "", body: "" }),
    () => ["main.go"],
  );
  expect(scope.kind).toBe("files");
});

test("deriveScope returns none when worktree exists but file listing is empty", () => {
  const scope = deriveScope(
    { worktree_path: "/wt", base_branch: "main" },
    () => ({ stat: "", body: "" }),
    () => [],
  );
  expect(scope.kind).toBe("none");
});

test("isFakeGreenSummary catches the 'no tests run' / 'nothing to review' family", () => {
  expect(isFakeGreenSummary("No tests run: the worktree contains no coder output")).toBe(true);
  expect(isFakeGreenSummary("Nothing to test")).toBe(true);
  expect(isFakeGreenSummary("Nothing to review")).toBe(true);
  expect(isFakeGreenSummary("Reviewed handler.go: looks correct")).toBe(false);
});
