import type { CliName } from "../../core/types";
import { argv as claudeArgv, parseLine as claudeParseLine } from "./claude";
import type { StreamLogEvent } from "./claude";
import { argv as codexArgv } from "./codex";
import { argv as geminiArgv } from "./gemini";

export const argvFor = (cli: CliName, model: string, extra: string[] = [], prompt?: string) => {
  if (cli === "claude") return claudeArgv(model, extra, prompt);
  if (cli === "codex") return codexArgv(model, extra, prompt);
  return geminiArgv(model, extra, prompt);
};

export const argvForResume = (cli: CliName, _model: string, sessionId: string): string[] => {
  if (cli === "claude") return ["claude", "--dangerously-skip-permissions", "--resume", sessionId];
  if (cli === "codex") return ["codex", "resume", sessionId];
  // Gemini's --resume takes a session index, not a stable id; resume by id is not supported.
  throw new Error(`resume is not supported for cli ${cli}`);
};

export const supportsResume = (cli: CliName): boolean => cli === "claude" || cli === "codex";

export const parseLineFor = (cli: CliName, line: string): Partial<StreamLogEvent> | null => {
  if (cli === "claude") return claudeParseLine(line);
  return null;
};

export type { StreamLogEvent };
