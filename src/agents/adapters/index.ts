import type { CliName } from "../../core/types";
import { argv as claudeArgv, parseLine as claudeParseLine } from "./claude";
import type { StreamLogEvent } from "./claude";
import { argv as codexArgv } from "./codex";
import { argv as geminiArgv } from "./gemini";

export const argvFor = (cli: CliName, model: string, extra: string[] = [], initialPrompt?: string) => {
  if (cli === "claude") return claudeArgv(model, extra, initialPrompt);
  if (cli === "codex") return codexArgv(model, extra, initialPrompt);
  return geminiArgv(model, extra, initialPrompt);
};

export const parseLineFor = (cli: CliName, line: string): Partial<StreamLogEvent> | null => {
  if (cli === "claude") return claudeParseLine(line);
  return null;
};

export type { StreamLogEvent };
