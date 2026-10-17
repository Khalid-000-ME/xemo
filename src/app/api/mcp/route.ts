import { tools } from "@/lib/mcp/tools";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROTOCOL_VERSION = "2025-06-18";

type JsonRpcId = string | number | null;

/**
 * AppFactory's MCP server — the endpoint the PayBox plugin's `.mcp.json`
 * points at.
 *
 * The JSON-RPC envelope is handled directly rather than through a transport
 * adapter: streamable HTTP is a POST of one JSON-RPC message, and hand-rolling
 * it keeps the route free of Node req/res plumbing that does not exist in a
 * Next route handler.
 */
function result(id: JsonRpcId, value: unknown) {
  return Response.json({ jsonrpc: "2.0", id, result: value }, { headers: { "cache-control": "no-store" } });
}

function error(id: JsonRpcId, code: number, message: string, status = 200) {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } }, { status });
}

export async function GET() {
  // Discovery convenience: not part of MCP, but it makes the endpoint
  // inspectable with a browser or curl during a demo.
  return Response.json({
    name: "appfactory",
    protocolVersion: PROTOCOL_VERSION,
    transport: "streamable-http",
    endpoint: `${env.appUrl}/api/mcp`,
    tools: tools().map((t) => ({ name: t.name, title: t.title, description: t.description })),
  });
}

export async function POST(req: Request) {
  let message: { jsonrpc?: string; id?: JsonRpcId; method?: string; params?: Record<string, unknown> };
  try {
    message = await req.json();
  } catch {
    return error(null, -32700, "Parse error: body must be JSON", 400);
  }

  const id = message.id ?? null;
  const method = message.method;
  if (!method) return error(id, -32600, "Invalid request: `method` is required", 400);

  const registry = tools();

  switch (method) {
    case "initialize":
      return result(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "appfactory", title: "AppFactory", version: "1.0.0" },
        instructions:
          "AppFactory builds, deploys and monetizes a micro-SaaS from one prompt. Call `quote_app_build` " +
          "first to get x402 terms and the price, tell the user that price, then use PayBox `pay_x402` to " +
          "pay the returned resource and POST to it with the X-PAYMENT header. Use `get_build` to follow a " +
          "build and `list_apps` to see what has shipped.",
      });

    // Notifications carry no id and must not be answered with a result body.
    case "notifications/initialized":
    case "notifications/cancelled":
      return new Response(null, { status: 202 });

    case "ping":
      return result(id, {});

    case "tools/list":
      return result(id, {
        tools: registry.map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });

    case "tools/call": {
      const name = typeof message.params?.name === "string" ? message.params.name : undefined;
      const args = (message.params?.arguments ?? {}) as Record<string, unknown>;
      const tool = registry.find((t) => t.name === name);
      if (!tool) return error(id, -32602, `Unknown tool: ${name ?? "(none)"}`);

      try {
        const value = await tool.handler(args);
        return result(id, {
          content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
          structuredContent: value,
          isError: false,
        });
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err);
        // A tool-level failure is reported inside the result, not as a
        // protocol error, so the agent can read and recover from it.
        return result(id, { content: [{ type: "text", text }], isError: true });
      }
    }

    default:
      return error(id, -32601, `Method not found: ${method}`);
  }
}
