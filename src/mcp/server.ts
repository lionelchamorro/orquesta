import { createToolHandlers, toolDefinitions } from "./tools";
import type { AskRouter } from "../daemon/ask-router";
import type { AgentPool } from "../agents/pool";
import type { Bus } from "../bus/bus";
import type { PlanStore } from "../core/plan-store";
import { requestHasSessionToken } from "../core/session-token";

type JsonRpcBody = {
  jsonrpc: string;
  id?: unknown;
  method: string;
  params?: unknown;
};

export const createMcpHandler = (deps: {
  store: PlanStore;
  bus: Bus;
  askRouter: AskRouter;
  agentPool: AgentPool;
  sessionToken?: string;
}) => {
  const handlers = createToolHandlers(deps);

  return async (req: Request) => {
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
    if (!requestHasSessionToken(req, deps.sessionToken)) {
      return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized" } }, { status: 401 });
    }
    const url = new URL(req.url);
    const agentId = url.pathname.split("/").at(-1);
    if (!agentId) return new Response("not found", { status: 404 });
    const agent = await deps.store.loadAgent(agentId);
    if (!agent) {
      return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Unknown agent" } });
    }

    let body: JsonRpcBody;
    try {
      body = (await req.json()) as JsonRpcBody;
    } catch {
      return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    }

    if (body.id === undefined) {
      return new Response(null, { status: 202 });
    }

    const id = body.id ?? null;
    if (body.method === "initialize") {
      return Response.json({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "orquesta", version: "0.1.0" },
        },
      });
    }
    if (body.method === "ping") return Response.json({ jsonrpc: "2.0", id, result: {} });
    if (body.method === "tools/list") {
      return Response.json({
        jsonrpc: "2.0",
        id,
        result: {
          tools: toolDefinitions.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        },
      });
    }
    if (body.method === "tools/call") {
      const params = body.params as { name?: keyof typeof handlers; arguments?: unknown };
      const handler = params?.name ? handlers[params.name] : undefined;
      if (!handler) {
        return Response.json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Unknown tool" } });
      }
      try {
        const result = await handler(agentId, params.arguments);
        return Response.json({ jsonrpc: "2.0", id, result });
      } catch (error) {
        return Response.json({
          jsonrpc: "2.0",
          id,
          error: { code: -32000, message: error instanceof Error ? error.message : "Tool error" },
        });
      }
    }
    return Response.json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
  };
};
