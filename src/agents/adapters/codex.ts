export const argv = (model: string, extra: string[] = [], initialPrompt?: string) => [
  "codex",
  "exec",
  "--model",
  model,
  "--dangerously-bypass-approvals-and-sandbox",
  ...extra,
  ...(initialPrompt ? [initialPrompt] : []),
];
