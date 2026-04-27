import { expect, test } from "bun:test";
import { argvFor } from "../agents/adapters";

test("adapter argv matches cli", () => {
  expect(argvFor("claude", "m")).toEqual([
    "claude",
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "bypassPermissions",
    "--dangerously-skip-permissions",
    "--model",
    "m",
  ]);
  expect(argvFor("codex", "m")).toEqual([
    "codex",
    "exec",
    "--model",
    "m",
    "--dangerously-bypass-approvals-and-sandbox",
  ]);
  expect(argvFor("gemini", "m")).toEqual(["gemini", "--model", "m"]);
});

test("adapter argv appends initial prompt as positional", () => {
  expect(argvFor("claude", "m", [], "hi")).toEqual([
    "claude",
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "bypassPermissions",
    "--dangerously-skip-permissions",
    "--model",
    "m",
    "hi",
  ]);
  expect(argvFor("codex", "m", [], "hi")).toEqual([
    "codex",
    "exec",
    "--model",
    "m",
    "--dangerously-bypass-approvals-and-sandbox",
    "hi",
  ]);
  expect(argvFor("gemini", "m", [], "hi")).toEqual(["gemini", "--model", "m", "hi"]);
});
