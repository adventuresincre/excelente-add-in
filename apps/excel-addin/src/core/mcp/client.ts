/**
 * Minimal MCP (Model Context Protocol) client for Excelente's needs.
 *
 * Transport: JSON-RPC 2.0 over HTTP POST (the "Streamable HTTP" simplified
 * variant). The user supplies a URL; we POST JSON-RPC requests there and
 * parse JSON-RPC responses back.
 *
 * Scope intentionally minimal — initialize, tools/list, tools/call. Adding
 * resources/prompts/sampling later is straightforward; this layer is the
 * foundation.
 *
 * Browser-friendly: no Node.js APIs, uses global fetch. Errors surface as
 * structured `McpClientError` instances so callers can distinguish network
 * failures from protocol-level errors.
 */

import { isCredentialSafeUrl } from "../storage/mcp-store";

/** Minimal shape of an MCP tool definition (per the spec). */
export interface McpTool {
  name: string;
  description?: string;
  /** JSON Schema for the tool's input. */
  inputSchema: Record<string, unknown>;
  /**
   * Optional behavior hints (per the MCP spec). `readOnlyHint: true` is the
   * server declaring the tool has no side effects — the bridge maps it to
   * Excelente's `Read` permission (silent execution). Anything else routes
   * through the Write-approval gate.
   */
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
    title?: string;
  };
}

/** Result of a tools/call invocation. */
export interface McpToolResult {
  /**
   * Array of content blocks (text, images, etc.) per the MCP spec. For our
   * needs we mostly care about text content; the bridge serializes the
   * array as the tool's stringified result.
   */
  content: Array<{ type: string; text?: string; [k: string]: unknown }>;
  /** True when the tool reports the call failed at the application layer. */
  isError?: boolean;
}

export class McpClientError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "network"
      | "protocol"
      | "tool"
      | "timeout"
      | "session-expired"
      | "uninitialized"
  ) {
    super(message);
    this.name = "McpClientError";
  }
}

export interface McpClient {
  /** Server name (from the config) — used for tool-name namespacing. */
  readonly serverName: string;
  /** Fully-qualified URL the client POSTs JSON-RPC to. */
  readonly url: string;
  /**
   * The server's `instructions` string from the initialize result — its own
   * guidance on how an agent should use its tools (MCP spec, optional).
   * null until initialize() completes or when the server sends none. This
   * is server-authored text; callers that put it in front of a model must
   * treat it as untrusted and cap its length.
   */
  readonly instructions?: string | null;
  /** Complete the MCP initialize handshake. Idempotent. */
  initialize(): Promise<void>;
  /** Discover the server's tools. Must be called after initialize(). */
  listTools(): Promise<McpTool[]>;
  /** Invoke a tool by name. Throws McpClientError on failure. */
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult>;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcSuccess<T = unknown> {
  jsonrpc: "2.0";
  id: number;
  result: T;
}

interface JsonRpcError {
  jsonrpc: "2.0";
  id: number | null;
  error: { code: number; message: string; data?: unknown };
}

type JsonRpcResponse<T = unknown> = JsonRpcSuccess<T> | JsonRpcError;

const PROTOCOL_VERSION = "2025-06-18";
const REQUEST_TIMEOUT_MS = 15_000;

/** Read a response body without throwing — used to enrich HTTP-error messages. */
async function safeReadBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

/**
 * Pull a human-readable message out of a JSON-RPC error envelope
 * (`{"error":{"code":-32004,"message":"…"}}`). MCP transports return their
 * 4xx reasons this way — surfacing it turns a bare "HTTP 400" into the
 * server's actual explanation (e.g. "no valid session ID"). Returns null
 * when the body isn't a JSON-RPC error.
 */
function parseJsonRpcErrorMessage(body: string): string | null {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body) as { error?: { code?: number; message?: string } };
    if (parsed.error && typeof parsed.error.message === "string") {
      const code = typeof parsed.error.code === "number" ? ` (${parsed.error.code})` : "";
      return `${parsed.error.message}${code}`;
    }
  } catch {
    // Not JSON — fall through to the raw-body snippet.
  }
  return null;
}

function truncateBody(s: string): string {
  const t = s.trim();
  return t.length > 300 ? `${t.slice(0, 300)}…` : t;
}

export function createMcpClient(args: {
  serverName: string;
  url: string;
  /**
   * Bearer-token supplier consulted on EVERY request (not captured at
   * connect time), so a refreshed OAuth access token is picked up
   * without reconnecting — same philosophy as the relay client. Return
   * null to send the request unauthenticated.
   */
  getAuthToken?: () => string | null;
  /** Override fetch in tests. */
  fetchImpl?: typeof fetch;
}): McpClient {
  const { serverName, url, getAuthToken } = args;
  const fetchImpl = args.fetchImpl ?? globalThis.fetch.bind(globalThis);
  let initialized = false;
  let nextRequestId = 1;
  let sessionId: string | null = null;
  let negotiatedProtocolVersion: string = PROTOCOL_VERSION;
  let instructions: string | null = null;

  function buildHeaders(includeProtocolVersion: boolean): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    const token = getAuthToken?.() ?? null;
    if (token) {
      // Never put a bearer on the wire in cleartext. The token here is the
      // an MCP OAuth access token — either one is a
      // working credential to anyone on-path. A server configured with an
      // `http://` URL gets an unauthenticated request (and a clear failure)
      // rather than a leaked credential. Loopback is exempt so local MCP
      // development still works.
      if (!isCredentialSafeUrl(url)) {
        throw new Error(
          `Refusing to send credentials to ${url} over an insecure connection. ` +
            `MCP servers that require authentication must use https:// ` +
            `(http:// is allowed only for localhost during development).`
        );
      }
      headers["Authorization"] = `Bearer ${token}`;
    }
    if (sessionId) headers["Mcp-Session-Id"] = sessionId;
    if (includeProtocolVersion) {
      headers["MCP-Protocol-Version"] = negotiatedProtocolVersion;
    }
    return headers;
  }

  async function rpcOnce<T>(
    method: string,
    params?: unknown,
    opts?: { captureSessionId?: boolean }
  ): Promise<T> {
    const id = nextRequestId++;
    const body: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        // `initialize` is the only request that omits MCP-Protocol-Version —
        // negotiation hasn't happened yet.
        headers: buildHeaders(method !== "initialize"),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("aborted")) {
        throw new McpClientError(
          `MCP request "${method}" timed out after ${REQUEST_TIMEOUT_MS}ms`,
          "timeout"
        );
      }
      throw new McpClientError(`MCP fetch failed: ${msg}`, "network");
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const bodyText = await safeReadBody(response);
      const detail = parseJsonRpcErrorMessage(bodyText) ?? (bodyText ? truncateBody(bodyText) : "");
      const suffix = detail ? `: ${detail}` : "";
      // A 404 on anything but initialize means the server no longer recognizes
      // our session id — it expired or the server restarted (MCP transports
      // hold sessions in memory). Signal the retry wrapper to re-initialize
      // and replay the call once. Initialize itself never carries a session
      // id, so a 404 there is a genuine error, not an expiry.
      if (response.status === 404 && method !== "initialize") {
        throw new McpClientError(
          `MCP session no longer valid (HTTP 404)${suffix}`,
          "session-expired"
        );
      }
      throw new McpClientError(
        `MCP server returned HTTP ${response.status} ${response.statusText}${suffix}`,
        "protocol"
      );
    }

    if (opts?.captureSessionId) {
      const id = response.headers.get("Mcp-Session-Id");
      if (id) sessionId = id;
    }

    const contentType = response.headers.get("content-type") ?? "";
    let parsed: JsonRpcResponse<T>;
    try {
      if (contentType.includes("text/event-stream")) {
        // The Streamable HTTP spec lets the server emit JSON-RPC
        // notifications/requests (e.g. notifications/progress) on this
        // stream BEFORE the response to our request. Scan every data
        // line and pick the message whose id matches ours — taking the
        // first data line would hand a progress notification to the
        // caller as the "result".
        const text = await response.text();
        const match = text
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l.startsWith("data:"))
          .map((l) => {
            try {
              return JSON.parse(l.slice(5).trim()) as JsonRpcResponse<T> & {
                id?: number | string;
              };
            } catch {
              return null;
            }
          })
          .find((m) => m !== null && m.id === id && ("result" in m || "error" in m));
        if (!match) {
          throw new Error(`SSE response contained no message for request id ${id}`);
        }
        parsed = match;
      } else {
        parsed = (await response.json()) as JsonRpcResponse<T>;
      }
    } catch (e) {
      throw new McpClientError(
        `MCP server returned non-JSON response: ${(e as Error).message}`,
        "protocol"
      );
    }

    if ("error" in parsed) {
      throw new McpClientError(
        `MCP server error (${parsed.error.code}): ${parsed.error.message}`,
        "protocol"
      );
    }

    return parsed.result;
  }

  // The initialize handshake, factored out so the retry wrapper can re-run it
  // when a session expires mid-flight (see rpc()).
  async function performInitialize(): Promise<void> {
    // Per MCP spec, initialize exchanges protocol version + capabilities.
    // We declare minimal capabilities — just enough to use tools.
    const result = await rpcOnce<{ protocolVersion?: string; instructions?: unknown }>(
      "initialize",
      {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: "excelente",
          version: "0.1.0",
        },
      },
      { captureSessionId: true }
    );
    if (result?.protocolVersion) {
      negotiatedProtocolVersion = result.protocolVersion;
    }
    instructions =
      typeof result?.instructions === "string" && result.instructions.trim().length > 0
        ? result.instructions
        : null;
    // Servers expect a `notifications/initialized` notification after the
    // initialize handshake. Best-effort — we don't await a response.
    void fetchImpl(url, {
      method: "POST",
      headers: buildHeaders(true),
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    }).catch(() => {
      // Notification failures don't block — server may or may not require this.
    });
    initialized = true;
  }

  // Retry wrapper around rpcOnce: a "session-expired" (HTTP 404) means the
  // server forgot our session id, so we mint a fresh one via performInitialize
  // and replay the call exactly once. Bounded to a single retry — a server
  // that 404s persistently surfaces the error instead of looping.
  async function rpc<T>(
    method: string,
    params?: unknown,
    opts?: { captureSessionId?: boolean }
  ): Promise<T> {
    try {
      return await rpcOnce<T>(method, params, opts);
    } catch (e) {
      if (e instanceof McpClientError && e.code === "session-expired") {
        initialized = false;
        sessionId = null;
        await performInitialize();
        return await rpcOnce<T>(method, params, opts);
      }
      throw e;
    }
  }

  return {
    serverName,
    url,
    get instructions() {
      return instructions;
    },

    async initialize() {
      if (initialized) return;
      await performInitialize();
    },

    async listTools() {
      if (!initialized) {
        throw new McpClientError(
          `Client for "${serverName}" must be initialized before listing tools`,
          "uninitialized"
        );
      }
      const result = await rpc<{ tools?: McpTool[] }>("tools/list");
      return result.tools ?? [];
    },

    async callTool(name, args) {
      if (!initialized) {
        throw new McpClientError(
          `Client for "${serverName}" must be initialized before calling tools`,
          "uninitialized"
        );
      }
      return rpc<McpToolResult>("tools/call", { name, arguments: args });
    },
  };
}
