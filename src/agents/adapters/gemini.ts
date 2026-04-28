export const argv = (model: string, extra: string[] = [], prompt?: string) => [
  "gemini",
  "--model",
  model,
  "--yolo",
  ...extra,
  ...(prompt ? [prompt] : []),
];
