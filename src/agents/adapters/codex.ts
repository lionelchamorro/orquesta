export const argv = (model: string, extra: string[] = [], prompt?: string) => [
  "codex",
  "--model",
  model,
  "--dangerously-bypass-approvals-and-sandbox",
  ...extra,
  ...(prompt ? [prompt] : []),
];
