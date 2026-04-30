export const argv = (model: string, extra: string[] = [], prompt?: string) => [
  "claude",
  ...(prompt ? ["--print", "--output-format", "stream-json", "--verbose"] : []),
  "--permission-mode",
  "bypassPermissions",
  "--dangerously-skip-permissions",
  "--model",
  model,
  ...extra,
  ...(prompt ? [prompt] : []),
];

export interface StreamLogEvent {
  session_id?: string;
  stop_reason?: string;
  total_cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
  final_text?: string;
  is_error?: boolean;
}

export const parseLine = (line: string): Partial<StreamLogEvent> | null => {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
  const type = obj.type;
  if (type === "system" && obj.subtype === "init" && typeof obj.session_id === "string") {
    return { session_id: obj.session_id };
  }
  if (type === "result") {
    return {
      session_id: typeof obj.session_id === "string" ? obj.session_id : undefined,
      stop_reason: typeof obj.stop_reason === "string" ? obj.stop_reason : undefined,
      total_cost_usd: typeof obj.total_cost_usd === "number" ? obj.total_cost_usd : undefined,
      duration_ms: typeof obj.duration_ms === "number" ? obj.duration_ms : undefined,
      num_turns: typeof obj.num_turns === "number" ? obj.num_turns : undefined,
      final_text: typeof obj.result === "string" ? obj.result : undefined,
      is_error: typeof obj.is_error === "boolean" ? obj.is_error : undefined,
    };
  }
  return null;
};
