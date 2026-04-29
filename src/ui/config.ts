const base = (import.meta.env.VITE_DAEMON_URL as string | undefined) ?? "";

export const DAEMON_HTTP = base;
export const DAEMON_WS = base.replace(/^http/, "ws");
