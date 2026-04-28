import { expect, test } from "bun:test";
import { argvFor } from "../agents/adapters";

test("adapter argv matches cli (interactive mode)", () => {
  expect(argvFor("claude", "m")).toEqual([
    "claude",
    "--permission-mode",
    "bypassPermissions",
    "--dangerously-skip-permissions",
    "--model",
    "m",
  ]);
  expect(argvFor("codex", "m")).toEqual([
    "codex",
    "--model",
    "m",
    "--dangerously-bypass-approvals-and-sandbox",
  ]);
  expect(argvFor("gemini", "m")).toEqual(["gemini", "--model", "m", "--yolo"]);
});

test("adapter argv passes extra args through", () => {
  expect(argvFor("claude", "m", ["--foo"])).toEqual([
    "claude",
    "--permission-mode",
    "bypassPermissions",
    "--dangerously-skip-permissions",
    "--model",
    "m",
    "--foo",
  ]);
  expect(argvFor("codex", "m", ["--foo"])).toEqual([
    "codex",
    "--model",
    "m",
    "--dangerously-bypass-approvals-and-sandbox",
    "--foo",
  ]);
  expect(argvFor("gemini", "m", ["--foo"])).toEqual(["gemini", "--model", "m", "--yolo", "--foo"]);
});

test("adapter argv appends prompt as the last positional", () => {
  expect(argvFor("claude", "m", [], "hi there")).toEqual([
    "claude",
    "--permission-mode",
    "bypassPermissions",
    "--dangerously-skip-permissions",
    "--model",
    "m",
    "hi there",
  ]);
  expect(argvFor("codex", "m", [], "hi there")).toEqual([
    "codex",
    "--model",
    "m",
    "--dangerously-bypass-approvals-and-sandbox",
    "hi there",
  ]);
  expect(argvFor("gemini", "m", [], "hi there")).toEqual([
    "gemini",
    "--model",
    "m",
    "--yolo",
    "hi there",
  ]);
});

test("adapter argv places prompt after extra args", () => {
  expect(argvFor("codex", "m", ["--foo"], "hi")).toEqual([
    "codex",
    "--model",
    "m",
    "--dangerously-bypass-approvals-and-sandbox",
    "--foo",
    "hi",
  ]);
});

test("adapter argv omits prompt when empty", () => {
  expect(argvFor("codex", "m", [], "")).toEqual([
    "codex",
    "--model",
    "m",
    "--dangerously-bypass-approvals-and-sandbox",
  ]);
});
