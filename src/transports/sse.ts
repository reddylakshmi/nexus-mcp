import http, { IncomingMessage, ServerResponse } from "node:http";
import type { Logger } from "../logger.js";

type McpServerLike = { connect(transport: unknown): Promise<void> };

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(typeof c === "string" ? Buffer.from(c) : c);
  const body = Buffer.concat(chunks).toString("utf8");
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

export async function startSseTransport(params: {
  serverFactory: () => McpServerLike;
  host: string;
  port: number;
  logger: Logger;
  publicBaseUrl?: string;
}) {
  const { SSEServerTransport } = await import("@modelcontextprotocol/sdk/server/sse.js");

  const transports = new Map<string, any>();

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

      if (req.method === "GET" && url.pathname === "/sse") {
        const messageEndpoint = (params.publicBaseUrl ?? "").replace(/\/+$/, "") + "/message";
        const transport = new SSEServerTransport(messageEndpoint || "/message", res as ServerResponse);
        const sessionId = String((transport as any).sessionId ?? "");
        if (sessionId) transports.set(sessionId, transport);

        const mcp = params.serverFactory();
        await mcp.connect(transport);

        params.logger.info({ transport: "sse", sessionId }, "sse.connected");

        req.on("close", () => {
          if (sessionId) transports.delete(sessionId);
          params.logger.info({ transport: "sse", sessionId }, "sse.disconnected");
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/message") {
        const sessionId = url.searchParams.get("sessionId") ?? url.searchParams.get("session_id") ?? "";
        const transport =
          (sessionId && transports.get(sessionId)) ||
          (transports.size === 1 ? [...transports.values()][0] : undefined);
        if (!transport) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "No active SSE session. Connect to GET /sse first." }));
          return;
        }

        // SDK variants typically expect `req.body` (Express-style). We emulate that here.
        const body = await readJson(req);
        (req as any).body = body;
        (req as any).rawBody = body;
        if (typeof (transport as any).handlePostMessage === "function") {
          await (transport as any).handlePostMessage(req, res);
          return;
        }

        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "SSE transport does not support POST message handling in this SDK version." }));
        return;
      }

      if (req.method === "GET" && url.pathname === "/healthz") {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Not found" }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      params.logger.error({ transport: "sse", error: message }, "sse.request_error");
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(params.port, params.host, () => resolve());
  });

  params.logger.info({ transport: "sse", host: params.host, port: params.port }, "Nexus MCP SSE transport started");
}
