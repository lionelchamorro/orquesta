import { expect, test } from "bun:test";
import { argvFor } from "../agents/adapters";

test("adapter argv matches cli", () => {
  expect(argvFor("claude", "m")).toEqual(["claude", "--dangerously-skip-permissions", "--model", "m"]);
  expect(argvFor("codex", "m")).toEqual(["openai-codex", "--model", "m", "--approval-mode", "auto"]);
  expect(argvFor("gemini", "m")).toEqual(["gemini", "--model", "m"]);
});

test("adapter argv appends initial prompt as positional", () => {
  expect(argvFor("claude", "m", [], "hi")).toEqual(["claude", "--dangerously-skip-permissions", "--model", "m", "hi"]);
  expect(argvFor("codex", "m", [], "hi")).toEqual(["openai-codex", "--model", "m", "--approval-mode", "auto", "hi"]);
  expect(argvFor("gemini", "m", [], "hi")).toEqual(["gemini", "--model", "m", "hi"]);
});
