import type { ToolRegistry } from "../tools";
import type { McpOAuthTokens, McpServerConfig, McpServerStore } from "../storage/mcp-store";
import { bridgeMcpClient, mcpSourceTag } from "./tool-bridge";
import { createMcpClient, McpClientError, type McpClient } from "./client";
import { refreshOAuthTokens } from "./oauth";

export type McpConnectionState =
  | { status: "connecting"; serverId: string }
  | {
      status: "connected";
      serverId: string;
      toolCount: number;
      /** Server-authored usage guidance from the initialize handshake, when sent. */
      instructions?: string;
    }
  | { status: "error"; serverId: string; message: string };

export interface McpServerStatus {
  /** Config the status applies to. */
  config: McpServerConfig;
  state: McpConnectionState;
}

/**
 * Higher-level manager that owns the lifecycle of MCP server connections
 * and keeps the tool registry in sync. Created once per AppProvider; the
 * Settings UI calls `addServer` / `removeServer` and subscribes to status
 * changes.
 *
 * Failure semantics: an unreachable server doesn't crash anything — its
 * status moves to `error` with a human-readable message. The UI surfaces
 * the error; the user can retry by removing + re-adding (or refresh the
 * page once the server is back).
 */
export interface McpManager {
  /** Connect to every persisted server. Safe to call once on app startup. */
  initialize(): Promise<void>;
  /** Returns the current status for every known server, newest-first by
   * addedAt. */
  getStatuses(): McpServerStatus[];
  /** Subscribe to status changes. Returns an unsubscribe function. */
  subscribe(listener: (statuses: McpServerStatus[]) => void): () => void;
  /** Add + persist a new server, then connect to it. Rejects on duplicate
   * name. `auth: "member-token"` attaches the member session token (from
   * the manager's `getAuthToken`) to every request; `auth: "oauth"` sends
   * the server's own tokens (pass them in `oauth` — obtained via
   * `runMcpOAuthFlow`); `presetId` records that the server came from a
   * one-click A.CRE preset. */
  addServer(args: {
    name: string;
    url: string;
    auth?: "member-token" | "oauth";
    oauth?: McpOAuthTokens;
    presetId?: string;
  }): Promise<void>;
  /** Disconnect + un-persist a server. */
  removeServer(serverId: string): Promise<void>;
}

interface ServerSlot {
  config: McpServerConfig;
  state: McpConnectionState;
  client: McpClient | null;
}

export function createMcpManager(args: {
  store: McpServerStore;
  registry: ToolRegistry;
  /**
   * Member session-token supplier for servers configured with
   * `auth: "member-token"`. Consulted per request (via the client), so a
   * token refresh propagates without reconnecting. Unauthenticated
   * servers never see it.
   */
  getAuthToken?: () => string | null;
  /** Override fetch (OAuth token refresh) in tests. */
  fetchImpl?: typeof fetch;
  /** Override the client factory in tests. */
  clientFactory?: (args: {
    serverName: string;
    url: string;
    getAuthToken?: () => string | null;
  }) => McpClient;
}): McpManager {
  const { store, registry, getAuthToken } = args;
  const clientFactory = args.clientFactory ?? createMcpClient;
  const fetchImpl = args.fetchImpl ?? globalThis.fetch.bind(globalThis);

  const slots = new Map<string, ServerSlot>();
  const listeners = new Set<(statuses: McpServerStatus[]) => void>();

  function snapshot(): McpServerStatus[] {
    return Array.from(slots.values())
      .sort((a, b) => a.config.addedAt - b.config.addedAt)
      .map((slot) => ({ config: slot.config, state: slot.state }));
  }

  function notify() {
    const snap = snapshot();
    for (const l of listeners) l(snap);
  }

  function setSlotState(serverId: string, state: McpConnectionState) {
    const slot = slots.get(serverId);
    if (!slot) return;
    slot.state = state;
    notify();
  }

  /** Per-request token getter appropriate to the server's auth mode. */
  function authGetterFor(config: McpServerConfig): (() => string | null) | undefined {
    if (config.auth === "member-token") return getAuthToken;
    if (config.auth === "oauth") {
      const serverId = config.id;
      // Read through the slot so a refresh-at-connect is picked up.
      return () => slots.get(serverId)?.config.oauth?.accessToken ?? null;
    }
    return undefined;
  }

  /** Don't connect with a token about to lapse mid-handshake. */
  const OAUTH_EXPIRY_SKEW_MS = 30_000;

  /**
   * For `auth: "oauth"` servers: make sure we hold a usable access token,
   * refreshing (and re-persisting) if it's expired. Returns false — with
   * the slot already in error state — when the user has to reconnect.
   */
  async function ensureFreshOAuth(config: McpServerConfig): Promise<boolean> {
    const tokens = config.oauth;
    if (!tokens) {
      setSlotState(config.id, {
        status: "error",
        serverId: config.id,
        message: "Sign-in required — remove this server and connect again.",
      });
      return false;
    }
    const expired =
      typeof tokens.expiresAt === "number" && tokens.expiresAt <= Date.now() + OAUTH_EXPIRY_SKEW_MS;
    if (!expired) return true;
    try {
      const refreshed = await refreshOAuthTokens(tokens, fetchImpl);
      const updated: McpServerConfig = { ...config, oauth: refreshed };
      const slot = slots.get(config.id);
      if (slot) slot.config = updated;
      await store.add(updated); // upsert by id
      return true;
    } catch (e) {
      setSlotState(config.id, {
        status: "error",
        serverId: config.id,
        message: `Sign-in expired — remove this server and connect again. (${(e as Error).message})`,
      });
      return false;
    }
  }

  async function connect(config: McpServerConfig): Promise<void> {
    setSlotState(config.id, { status: "connecting", serverId: config.id });
    if (config.auth === "oauth" && !(await ensureFreshOAuth(config))) {
      return;
    }
    const client = clientFactory({
      serverName: config.name,
      url: config.url,
      getAuthToken: authGetterFor(config),
    });
    const slot = slots.get(config.id);
    if (slot) slot.client = client;

    try {
      await client.initialize();
      const tools = await bridgeMcpClient(client);
      // `initialize` and `bridgeMcpClient` are network round-trips, and the
      // user can remove this server while they're in flight. Without this
      // re-check, `removeServer`'s unregister has already run and the
      // `addAll` below silently re-registers a removed server's tools —
      // leaving them callable with no owning slot and no way to remove them
      // again. Verify the slot still exists AND still refers to this client.
      const current = slots.get(config.id);
      if (!current || current.client !== client) {
        registry.removeBySource(mcpSourceTag(config.name));
        return;
      }
      // Idempotent register: drop any previously-registered tools from this
      // source first (e.g. when reconnecting after a transient failure).
      registry.removeBySource(mcpSourceTag(config.name));
      registry.addAll(tools);
      setSlotState(config.id, {
        status: "connected",
        serverId: config.id,
        toolCount: tools.length,
        ...(client.instructions ? { instructions: client.instructions } : {}),
      });
    } catch (e) {
      const msg =
        e instanceof McpClientError ? e.message : `Failed to connect: ${(e as Error).message}`;
      // Make sure no half-registered tools linger.
      registry.removeBySource(mcpSourceTag(config.name));
      setSlotState(config.id, {
        status: "error",
        serverId: config.id,
        message: msg,
      });
    }
  }

  return {
    async initialize() {
      const configs = await store.list();
      for (const config of configs) {
        slots.set(config.id, {
          config,
          state: { status: "connecting", serverId: config.id },
          client: null,
        });
      }
      notify();
      // Connect in parallel; an offline server shouldn't block the others.
      await Promise.all(configs.map((c) => connect(c)));
    },

    getStatuses() {
      return snapshot();
    },

    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => {
        listeners.delete(listener);
      };
    },

    async addServer({ name, url, auth, oauth, presetId }) {
      // Name uniqueness is checked here so we fail fast (before persisting)
      // — the registry would also throw on namespace collision when tools
      // register, but a clean rejection at the storage layer is friendlier.
      for (const slot of slots.values()) {
        if (slot.config.name === name) {
          throw new Error(`An MCP server named "${name}" already exists.`);
        }
      }
      const config: McpServerConfig = {
        id: makeId(),
        name,
        url,
        addedAt: Date.now(),
        ...(auth ? { auth } : {}),
        ...(oauth ? { oauth } : {}),
        ...(presetId ? { presetId } : {}),
      };
      await store.add(config);
      slots.set(config.id, {
        config,
        state: { status: "connecting", serverId: config.id },
        client: null,
      });
      notify();
      await connect(config);
    },

    async removeServer(serverId) {
      const slot = slots.get(serverId);
      if (!slot) return;
      registry.removeBySource(mcpSourceTag(slot.config.name));
      slots.delete(serverId);
      await store.remove(serverId);
      notify();
    },
  };
}

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
