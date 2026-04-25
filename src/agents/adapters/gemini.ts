export const argv = (model: string, extra: string[] = [], initialPrompt?: string) => [
  "gemini",
  "--model",
  model,
  ...extra,
  ...(initialPrompt ? [initialPrompt] : []),
];
