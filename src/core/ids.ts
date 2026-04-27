const suffix = (value: string) => {
  const match = value.match(/-(\d+)$/);
  return match ? Number(match[1]) : 0;
};

const nextByPrefix = (existing: string[], prefix: string) => {
  const max = existing
    .filter((value) => value.startsWith(`${prefix}-`))
    .map(suffix)
    .reduce((acc, value) => Math.max(acc, value), 0);
  return `${prefix}-${max + 1}`;
};

export const nextTaskId = (existing: string[]) => nextByPrefix(existing, "task");
export const nextSubtaskId = (existing: string[]) => nextByPrefix(existing, "sub");
export const nextIterationId = (existing: string[]) => nextByPrefix(existing, "iter");
export const newRunId = () => `run-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
export const newAgentId = () => crypto.randomUUID();
export const newEventId = () => crypto.randomUUID();
