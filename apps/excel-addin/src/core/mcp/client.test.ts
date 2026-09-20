import { describe, expect, it, vi } from "vitest";
import { createMcpClient, McpClientError } from "./client";

function rpcResponse(result: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
    status: 200,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

/** A JSON-RPC error envelope returned with a real HTTP status (transport-layer error). */
function httpError(status: number, code: number, message: string): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("createMcpClient auth", () => {
  it("attaches Authorization: Bearer on every request when getAuthToken returns a token", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(rpcResponse({ protocolVersion: "2025-06-18" }));
    const client = createMcpClient({
      serverName: "acre",
      url: "https://hub.example.com/mcp",
      getAuthToken: () => "access-token",
      fetchImpl,
    });

    await client.initialize();
    fetchImpl.mockResolvedValue(rpcResponse({ tools: [] }));
    await client.listTools();

    // initialize + notifications/initialized + tools/list
    expect(fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const [, init] of fetchImpl.mock.calls) {
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer access-token");
    }
  });

  it("refuses to send a bearer token over plaintext http to a remote host", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(rpcResponse({}));
    const client = createMcpClient({
      serverName: "acre",
      url: "http://hub.example.com/mcp",
      getAuthToken: () => "access-token",
      fetchImpl,
    });

    await expect(client.initialize()).rejects.toThrow(/insecure connection/i);
    // Fails closed: the request is never made at all, so the credential
    // never reaches the wire.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("allows plaintext http on loopback for local MCP development", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(rpcResponse({ protocolVersion: "2025-06-18" }));
    const client = createMcpClient({
      serverName: "local",
      url: "http://localhost:9000/mcp",
      getAuthToken: () => "dev-token",
      fetchImpl,
    });

    await expect(client.initialize()).resolves.not.toThrow();
    const [, init] = fetchImpl.mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer dev-token");
  });

  it("still serves unauthenticated http servers (no token, nothing to leak)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(rpcResponse({ protocolVersion: "2025-06-18" }));
    const client = createMcpClient({
      serverName: "open",
      url: "http://insecure.example.com/mcp",
      fetchImpl,
    });

    await expect(client.initialize()).resolves.not.toThrow();
  });

  it("picks up a refreshed token without reconnecting", async () => {
    let token = "first-token";
    const fetchImpl = vi.fn().mockResolvedValue(rpcResponse({}));
    const client = createMcpClient({
      serverName: "acre",
      url: "https://hub.example.com/mcp",
      getAuthToken: () => token,
      fetchImpl,
    });

    await client.initialize();
    token = "second-token";
    fetchImpl.mockClear();
    fetchImpl.mockResolvedValue(rpcResponse({ tools: [] }));
    await client.listTools();

    const [, init] = fetchImpl.mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer second-token");
  });

  it("sends no Authorization header when getAuthToken is absent or returns null", async () => {
    // Fresh Response per call — a body can only be consumed once.
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(rpcResponse({})));
    const anonymous = createMcpClient({
      serverName: "open",
      url: "https://mcp.example.com",
      fetchImpl,
    });
    await anonymous.initialize();

    const signedOut = createMcpClient({
      serverName: "hub",
      url: "https://hub.example.com/mcp",
      getAuthToken: () => null,
      fetchImpl,
    });
    await signedOut.initialize();

    for (const [, init] of fetchImpl.mock.calls) {
      expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    }
  });
});

describe("createMcpClient server instructions", () => {
  it("exposes the initialize result's instructions and nulls blank or missing ones", async () => {
    const withText = createMcpClient({
      serverName: "vic",
      url: "https://vic.example/mcp",
      fetchImpl: vi
        .fn()
        .mockResolvedValue(
          rpcResponse({ protocolVersion: "2025-06-18", instructions: "Call discover_tasks first." })
        ),
    });
    expect(withText.instructions).toBeNull();
    await withText.initialize();
    expect(withText.instructions).toBe("Call discover_tasks first.");

    const blank = createMcpClient({
      serverName: "quiet",
      url: "https://quiet.example/mcp",
      fetchImpl: vi
        .fn()
        .mockResolvedValue(rpcResponse({ protocolVersion: "2025-06-18", instructions: "  " })),
    });
    await blank.initialize();
    expect(blank.instructions).toBeNull();

    const missing = createMcpClient({
      serverName: "none",
      url: "https://none.example/mcp",
      fetchImpl: vi.fn().mockResolvedValue(rpcResponse({ protocolVersion: "2025-06-18" })),
    });
    await missing.initialize();
    expect(missing.instructions).toBeNull();
  });
});

describe("createMcpClient session handling", () => {
  it("captures Mcp-Session-Id on initialize and echoes it on later requests", async () => {
    const fetchImpl = vi.fn();
    // initialize → returns a session id header; notifications/initialized; tools/list
    fetchImpl
      .mockResolvedValueOnce(
        rpcResponse({ protocolVersion: "2025-06-18" }, { "Mcp-Session-Id": "sess-abc" })
      )
      .mockResolvedValue(rpcResponse({ tools: [] }));

    const client = createMcpClient({
      serverName: "acre",
      url: "https://hub.example.com/mcp",
      fetchImpl,
    });
    await client.initialize();
    await client.listTools();

    // The tools/list call (last) must carry the captured session id.
    const lastCall = fetchImpl.mock.calls[fetchImpl.mock.calls.length - 1];
    expect((lastCall[1].headers as Record<string, string>)["Mcp-Session-Id"]).toBe("sess-abc");
  });

  it("surfaces the JSON-RPC error body on a 4xx instead of a bare HTTP status", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(rpcResponse({ protocolVersion: "2025-06-18" })) // initialize
      .mockResolvedValueOnce(rpcResponse({})) // notifications/initialized (fire-and-forget)
      .mockResolvedValueOnce(httpError(400, -32600, "Bad Request: no valid session ID")); // tools/list

    const client = createMcpClient({
      serverName: "acre",
      url: "https://hub.example.com/mcp",
      fetchImpl,
    });
    await client.initialize();

    await expect(client.listTools()).rejects.toThrow(/no valid session ID \(-32600\)/);
  });

  it("re-initializes and retries once when a call 404s (expired session)", async () => {
    const fetchImpl = vi.fn();
    // 1: initialize → sess-1
    // 2: notifications/initialized (fire-and-forget)
    // 3: tools/list → 404 (session expired)
    // 4: re-initialize → sess-2
    // 5: notifications/initialized
    // 6: tools/list retry → success
    fetchImpl
      .mockResolvedValueOnce(
        rpcResponse({ protocolVersion: "2025-06-18" }, { "Mcp-Session-Id": "sess-1" })
      )
      .mockResolvedValueOnce(rpcResponse({}))
      .mockResolvedValueOnce(httpError(404, -32004, "Session not found or expired"))
      .mockResolvedValueOnce(
        rpcResponse({ protocolVersion: "2025-06-18" }, { "Mcp-Session-Id": "sess-2" })
      )
      .mockResolvedValueOnce(rpcResponse({}))
      .mockResolvedValueOnce(rpcResponse({ tools: [{ name: "ping", inputSchema: {} }] }));

    const client = createMcpClient({
      serverName: "acre",
      url: "https://hub.example.com/mcp",
      fetchImpl,
    });
    await client.initialize();
    const tools = await client.listTools();

    expect(tools).toEqual([{ name: "ping", inputSchema: {} }]);
    // The retried tools/list (last call) carries the fresh session id.
    const lastCall = fetchImpl.mock.calls[fetchImpl.mock.calls.length - 1];
    expect((lastCall[1].headers as Record<string, string>)["Mcp-Session-Id"]).toBe("sess-2");
  });

  it("gives up after one retry if the server keeps 404ing", async () => {
    const fetchImpl = vi.fn();
    fetchImpl
      .mockResolvedValueOnce(
        rpcResponse({ protocolVersion: "2025-06-18" }, { "Mcp-Session-Id": "s1" })
      )
      .mockResolvedValueOnce(rpcResponse({})) // notifications/initialized
      .mockResolvedValueOnce(httpError(404, -32004, "Session not found")) // tools/list
      .mockResolvedValueOnce(
        rpcResponse({ protocolVersion: "2025-06-18" }, { "Mcp-Session-Id": "s2" })
      ) // re-init
      .mockResolvedValueOnce(rpcResponse({})) // notifications/initialized
      .mockResolvedValueOnce(httpError(404, -32004, "Session not found")) // tools/list retry still 404
      .mockResolvedValue(rpcResponse({}));

    const client = createMcpClient({
      serverName: "acre",
      url: "https://hub.example.com/mcp",
      fetchImpl,
    });
    await client.initialize();
    await expect(client.listTools()).rejects.toBeInstanceOf(McpClientError);
  });
});

describe("createMcpClient SSE responses", () => {
  it("skips leading notifications and returns the message matching the request id", async () => {
    const fetchImpl = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { id?: number; method: string };
      if (body.method === "initialize") {
        return rpcResponse({ protocolVersion: "2025-06-18" });
      }
      if (body.id === undefined) {
        return rpcResponse({}); // notifications/initialized
      }
      // Streamable HTTP lets servers emit notifications BEFORE the response
      // on the same SSE stream. The client must select by id, not take the
      // first data line.
      const sse = [
        'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":1,"progressToken":"t"}}',
        "",
        `data: {"jsonrpc":"2.0","id":${body.id},"result":{"tools":[{"name":"real","inputSchema":{"type":"object","properties":{}}}]}}`,
        "",
      ].join("\n");
      return new Response(sse, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    const client = createMcpClient({
      serverName: "acre",
      url: "https://hub.example.com/mcp",
      fetchImpl,
    });
    await client.initialize();
    const tools = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["real"]);
  });

  it("errors when the SSE stream carries no message for the request id", async () => {
    const fetchImpl = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { id?: number; method: string };
      if (body.method === "initialize") {
        return rpcResponse({ protocolVersion: "2025-06-18" });
      }
      if (body.id === undefined) {
        return rpcResponse({});
      }
      const sse =
        'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":1}}\n\n';
      return new Response(sse, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    const client = createMcpClient({
      serverName: "acre",
      url: "https://hub.example.com/mcp",
      fetchImpl,
    });
    await client.initialize();
    await expect(client.listTools()).rejects.toThrow(/no message for request id/);
  });
});
