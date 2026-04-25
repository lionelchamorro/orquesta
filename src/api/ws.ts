import type { Server } from "bun";
import type { Bus } from "../bus/bus";
import type { AgentPool } from "../agents/pool";
import type { Journal } from "../bus/journal";

type WsData = { kind: "events" | "tty"; agentId?: string; tags?: string[] };

export const createWebSocketHandlers = (bus: Bus, pool: AgentPool, journal?: Journal) => {
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
    upgrade(req: Request, server: Server) {
      const url = new URL(req.url);
      if (url.pathname === "/events") return server.upgrade(req, { data: { kind: "events" } });
      if (url.pathname.startsWith("/tty/")) {
        const agentId = url.pathname.split("/").at(-1);
        if (!agentId) return false;
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
