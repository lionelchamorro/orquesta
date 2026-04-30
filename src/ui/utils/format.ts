export const taskDisplayId = (taskId: string): string =>
  taskId.replace(/^task-/i, "T").toUpperCase();
