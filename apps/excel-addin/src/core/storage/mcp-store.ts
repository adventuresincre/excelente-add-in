import { createIndexedDbAccessor } from "./indexeddb";

/**
 * Persisted configuration for a single MCP server the user has connected.
 * Servers are added by the user via the Settings panel (name + URL) or via
 * a one-click A.CRE preset, the add-in connects on app startup + on every
 * add, and the server's tools register into the live tool registry under a
 * `mcp_${name}__${tool}` namespace.
 */
export interface McpServerConfig {
  /** Stable UUID minted on add. Used as the IndexedDB key. */
  id: string;
  /**
   * Human-readable name. Surfaced in the Settings list and used as the
   * tool-name prefix (`mcp_${name}__${toolName}`), so it must be a valid
   * identifier piece — lower-kebab or lower-snake.
   */
  name: string;
  /**
   * JSON-RPC endpoint URL. The add-in POSTs JSON-RPC messages here and
   * expects JSON-RPC responses back (Streamable HTTP transport). For MCP
   * servers using HTTP+SSE, the user should supply the SSE endpoint.
   */
  url: string;
  /** Epoch ms when the server was added. */
  addedAt: number;
  /**
   * How requests to this server authenticate. Absent (default) = no auth
   * headers (a personal MCP URL carries its credential in `url`). "oauth" =
   * the server runs its own MCP OAuth sign-in (e.g. CRE Agents); tokens live
   * in `oauth`. Rows persisted before this field existed parse as
   * unauthenticated, which matches their behavior at the time. (A
   * "member-token" mode for a never-shipped A.CRE sign-in was retired on
   * 2026-09-19; no persisted row ever carried it.)
   */
  auth?: "oauth";
  /**
   * OAuth tokens for `auth: "oauth"` servers. Stored alongside the config
   * — same sensitivity posture as a personal MCP URL with an embedded
   * credential, which lives in `url`.
   */
  oauth?: McpOAuthTokens;
  /**
   * Set when the server was added via a one-click A.CRE preset (see
   * `core/mcp/presets.ts`). Lets the Settings UI mark the preset as
   * already added and re-derive preset rows across sessions.
   */
  presetId?: string;
}

/**
 * Tokens + everything needed to refresh them later, persisted on the
 * server config row. Produced by `core/mcp/oauth.ts`.
 */
export interface McpOAuthTokens {
  accessToken: string;
  refreshToken?: string;
  /** Absolute epoch ms; absent when the server didn't say. */
  expiresAt?: number;
  tokenEndpoint: string;
  clientId: string;
  /** RFC 8707 resource indicator (the MCP endpoint), echoed on refresh. */
  resource: string;
}

/**
 * Validate that a name is safe to use as a tool-name prefix. Tool names
 * the model sees go through OpenRouter / OpenAI schemas which accept
 * `[a-zA-Z0-9_-]`; we keep the alphabet narrower (lower + digits + hyphen)
 * so prefixes are predictable and case-insensitive across providers.
 */
export function isValidMcpServerName(name: string): boolean {
  return /^[a-z][a-z0-9-]{0,30}$/.test(name);
}

/** Hosts where plaintext http is acceptable — local MCP development only. */
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * True when it is safe to attach a bearer credential to this URL: https
 * anywhere, or http on loopback (where there is no network to intercept).
 *
 * Shared by the store's validator and the MCP client's header builder so
 * "which URLs may carry a token" has exactly one definition. Personal-URL
 * presets embed the credential in the URL itself, so this covers those too.
 */
export function isCredentialSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:") return true;
    return parsed.protocol === "http:" && LOOPBACK_HOSTNAMES.has(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Quick sanity check on the URL. We don't ping the server here — that
 * happens at connect time. We just reject obviously-bad inputs so the
 * user sees the error before save.
 *
 * Plaintext `http://` to a remote host is rejected outright rather than
 * merely stripped of credentials: an MCP server sees the workbook data the
 * agent passes to its tools, and shipping that over cleartext is not
 * something to accept silently. Loopback stays allowed for local dev.
 */
export function isValidMcpServerUrl(url: string): boolean {
  return isCredentialSafeUrl(url);
}

export interface McpServerStore {
  list(): Promise<McpServerConfig[]>;
  add(config: McpServerConfig): Promise<void>;
  remove(id: string): Promise<void>;
}

const DB_NAME = "excelente-mcp-servers";
const DB_VERSION = 1;
const STORE_NAME = "servers";

/**
 * Production `McpServerStore` backed by IndexedDB. Object store `servers`
 * keyed by `id`. Throws if `indexedDB` isn't available — callers should
 * fall back to the in-memory impl in that case.
 */
export function createIndexedDbMcpServerStore(): McpServerStore {
  const db = createIndexedDbAccessor({
    name: DB_NAME,
    version: DB_VERSION,
    storeName: STORE_NAME,
    upgrade: (database) => {
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    },
    blockedMessage: "IndexedDB open blocked",
  });

  function tx(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    return db.objectStore(mode);
  }

  return {
    async list() {
      const store = await tx("readonly");
      return new Promise<McpServerConfig[]>((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => {
          const rows = (req.result as McpServerConfig[]) ?? [];
          rows.sort((a, b) => a.addedAt - b.addedAt);
          resolve(rows);
        };
        req.onerror = () => reject(req.error ?? new Error("getAll failed"));
      });
    },
    async add(config) {
      const store = await tx("readwrite");
      return new Promise<void>((resolve, reject) => {
        const req = store.put(config);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error ?? new Error("put failed"));
      });
    },
    async remove(id) {
      const store = await tx("readwrite");
      return new Promise<void>((resolve, reject) => {
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error ?? new Error("delete failed"));
      });
    },
  };
}

/**
 * In-memory impl for tests + environments without IndexedDB. Same
 * ordering (addedAt ascending) and same upsert-by-id semantics.
 */
export function createInMemoryMcpServerStore(): McpServerStore {
  const rows = new Map<string, McpServerConfig>();
  return {
    async list() {
      return Array.from(rows.values()).sort((a, b) => a.addedAt - b.addedAt);
    },
    async add(config) {
      rows.set(config.id, config);
    },
    async remove(id) {
      rows.delete(id);
    },
  };
}
