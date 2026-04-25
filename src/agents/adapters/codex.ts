export const argv = (model: string, extra: string[] = [], initialPrompt?: string) => [
  "codex",
  "--model",
  model,
  "--approval-mode",
  "auto",
  ...extra,
  ...(initialPrompt ? [initialPrompt] : []),
];
