import type { Server, ServerWebSocket } from "bun";
import type { Bus } from "../bus/bus";
import type { AgentPool } from "../agents/pool";
import type { Journal } from "../bus/journal";

type WsData = { kind: "events" | "tty"; agentId?: string; tags?: string[] };

const MAX_TTY_INPUT_BYTES = 16 * 1024;

const originAllowed = (req: Request) => {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const requestUrl = new URL(req.url);
  const originUrl = new URL(origin);
  return originUrl.host === requestUrl.host && ["http:", "https:"].includes(originUrl.protocol);
};

export const createWebSocketHandlers = (bus: Bus, pool: AgentPool, journal?: Journal, options: { sessionToken?: string } = {}) => {
  const eventClients = new Set<ServerWebSocket<WsData>>();
  const ttyClients = new Map<string, Set<ServerWebSocket<WsData>>>();

  bus.subscribe(() => true, (event) => {
    for (const client of eventClients) {
      if (client.data.tags && client.data.tags.length > 0 && !client.data.tags.some((tag: string) => event.tags.includes(tag))) {
        continue;
      }
      try {
        client.send(JSON.stringify(event));
      } catch {}
    }

    const payload = event.payload as { type?: string; chunk?: string } | undefined;
    if (payload?.type === "subtask_output" && typeof payload.chunk === "string") {
      for (const tag of event.tags) {
        const subscribers = ttyClients.get(tag);
        if (!subscribers) continue;
        for (const client of subscribers) {
          try {
            client.send(payload.chunk);
          } catch {}
        }
      }
    }
  });

  return {
    upgrade(req: Request, server: Server<WsData>) {
      if (!originAllowed(req)) return false;
      const url = new URL(req.url);
      if (url.pathname === "/events") return server.upgrade(req, { data: { kind: "events" } });
      if (url.pathname.startsWith("/tty/")) {
        const agentId = url.pathname.split("/").at(-1);
        if (!agentId) return false;
        const token =
          req.headers.get("x-orquesta-token") ??
          req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
          url.searchParams.get("token") ??
          req.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith("orquesta_token="))?.split("=")[1];
        if (options.sessionToken && decodeURIComponent(token ?? "") !== options.sessionToken) return false;
        return server.upgrade(req, { data: { kind: "tty", agentId } });
      }
      return false;
    },
    websocket: {
      open(ws: ServerWebSocket<WsData>) {
        if (ws.data.kind === "events") {
          eventClients.add(ws);
          if (journal) {
            for (const event of journal.query({ limit: 100 })) {
              ws.send(JSON.stringify(event));
            }
          }
        }
        if (ws.data.kind === "tty" && ws.data.agentId) {
          const agentId = ws.data.agentId;
          let subscribers = ttyClients.get(agentId);
          if (!subscribers) {
            subscribers = new Set();
            ttyClients.set(agentId, subscribers);
          }
          subscribers.add(ws);
          const buffer = pool.getOutputBuffer(agentId);
          if (buffer) ws.send(buffer);
        }
      },
      message(ws: ServerWebSocket<WsData>, message: string | Buffer) {
        if (ws.data.kind === "events") {
          try {
            const parsed = JSON.parse(String(message)) as { type?: string; tags?: string[] };
            if (parsed.type === "subscribe") ws.data.tags = parsed.tags ?? [];
          } catch {}
          return;
        }
        if (ws.data.kind !== "tty" || !ws.data.agentId) return;
        if (Buffer.byteLength(message) > MAX_TTY_INPUT_BYTES) {
          ws.close(1009, "terminal input too large");
          return;
        }
        try {
          const parsed = JSON.parse(String(message)) as { type?: string; cols?: number; rows?: number; data?: string };
          if (parsed.type === "resize" && parsed.cols && parsed.rows) {
            pool.resize(ws.data.agentId, parsed.cols, parsed.rows);
            return;
          }
          if (parsed.type === "stdin" && parsed.data) {
            pool.write(ws.data.agentId, parsed.data);
            return;
          }
        } catch {}
        pool.write(ws.data.agentId, message as string);
      },
      close(ws: ServerWebSocket<WsData>) {
        if (ws.data.kind === "events") eventClients.delete(ws);
        if (ws.data.kind === "tty" && ws.data.agentId) {
          const subscribers = ttyClients.get(ws.data.agentId);
          if (subscribers) {
            subscribers.delete(ws);
            if (subscribers.size === 0) ttyClients.delete(ws.data.agentId);
          }
        }
      },
    },
  };
};
