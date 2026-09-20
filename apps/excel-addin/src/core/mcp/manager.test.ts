import { describe, expect, it, vi } from "vitest";
import { createToolRegistry, type ToolRegistry } from "../tools";
import { createInMemoryMcpServerStore } from "../storage/mcp-store";
import { createMcpManager, type McpServerStatus } from "./manager";
import type { McpClient, McpTool } from "./client";

function fakeClientFactory(
  opts: {
    tools?: McpTool[];
    initializeShouldThrow?: Error;
  } = {}
) {
  return ({ serverName, url }: { serverName: string; url: string }): McpClient => ({
    serverName,
    url,
    async initialize() {
      if (opts.initializeShouldThrow) throw opts.initializeShouldThrow;
    },
    async listTools() {
      return (
        opts.tools ?? [
          {
            name: "lookup",
            description: "look stuff up",
            inputSchema: { type: "object", properties: {} },
          },
        ]
      );
    },
    async callTool() {
      return { content: [{ type: "text", text: "ok" }] };
    },
  });
}

function newRegistry(): ToolRegistry {
  return createToolRegistry([]);
}

describe("McpManager", () => {
  it("addServer connects + registers tools in the registry under the namespaced names", async () => {
    const store = createInMemoryMcpServerStore();
    const registry = newRegistry();
    const manager = createMcpManager({
      store,
      registry,
      clientFactory: fakeClientFactory(),
    });

    await manager.addServer({ name: "acre", url: "https://example.com" });

    expect(registry.all().map((t) => t.name)).toEqual(["mcp_acre__lookup"]);
    const statuses = manager.getStatuses();
    expect(statuses).toHaveLength(1);
    expect(statuses[0].state.status).toBe("connected");
    if (statuses[0].state.status === "connected") {
      expect(statuses[0].state.toolCount).toBe(1);
    }
  });

  it("addServer persists the config so it's restored by initialize() on the next session", async () => {
    const store = createInMemoryMcpServerStore();
    const registry1 = newRegistry();
    const manager1 = createMcpManager({
      store,
      registry: registry1,
      clientFactory: fakeClientFactory(),
    });
    await manager1.addServer({ name: "acre", url: "https://example.com" });

    // Simulate a fresh session — new registry, new manager, same store.
    const registry2 = newRegistry();
    const manager2 = createMcpManager({
      store,
      registry: registry2,
      clientFactory: fakeClientFactory(),
    });
    await manager2.initialize();

    expect(registry2.all().map((t) => t.name)).toEqual(["mcp_acre__lookup"]);
    expect(manager2.getStatuses()).toHaveLength(1);
  });

  it("removeServer un-registers the server's tools + un-persists it", async () => {
    const store = createInMemoryMcpServerStore();
    const registry = newRegistry();
    const manager = createMcpManager({
      store,
      registry,
      clientFactory: fakeClientFactory(),
    });

    await manager.addServer({ name: "acre", url: "https://example.com" });
    expect(registry.all()).toHaveLength(1);

    const serverId = manager.getStatuses()[0].config.id;
    await manager.removeServer(serverId);

    expect(registry.all()).toHaveLength(0);
    expect(manager.getStatuses()).toHaveLength(0);
    expect(await store.list()).toEqual([]);
  });

  it("addServer rejects a duplicate name without persisting", async () => {
    const store = createInMemoryMcpServerStore();
    const registry = newRegistry();
    const manager = createMcpManager({
      store,
      registry,
      clientFactory: fakeClientFactory(),
    });

    await manager.addServer({ name: "acre", url: "https://example.com" });
    await expect(
      manager.addServer({ name: "acre", url: "https://other.example.com" })
    ).rejects.toThrow(/already exists/);
    // Still only one persisted server.
    expect(await store.list()).toHaveLength(1);
  });

  it("a server that fails to initialize lands in error state without crashing the manager", async () => {
    const store = createInMemoryMcpServerStore();
    const registry = newRegistry();
    const manager = createMcpManager({
      store,
      registry,
      clientFactory: fakeClientFactory({
        initializeShouldThrow: new Error("connection refused"),
      }),
    });

    await manager.addServer({ name: "broken", url: "https://example.com" });

    const statuses = manager.getStatuses();
    expect(statuses[0].state.status).toBe("error");
    if (statuses[0].state.status === "error") {
      expect(statuses[0].state.message).toMatch(/connection refused/);
    }
    // No tools registered when initialization failed.
    expect(registry.all()).toHaveLength(0);
    // But the server IS persisted — user can retry later.
    expect(await store.list()).toHaveLength(1);
  });

  it("passes a token getter to the client only for oauth servers, and persists auth + presetId", async () => {
    const store = createInMemoryMcpServerStore();
    const registry = newRegistry();
    const seenFactoryArgs: Array<{
      serverName: string;
      getAuthToken?: () => string | null;
    }> = [];
    const factory = fakeClientFactory();
    const manager = createMcpManager({
      store,
      registry,
      clientFactory: (args) => {
        seenFactoryArgs.push(args);
        return factory(args);
      },
    });

    await manager.addServer({
      name: "cre-agents",
      url: "https://app.example.com/api/mcp",
      auth: "oauth",
      oauth: {
        accessToken: "access-token",
        tokenEndpoint: "https://app.example.com/oauth/token",
        clientId: "excelente",
        resource: "https://app.example.com/api/mcp",
      },
      presetId: "cre-agents",
    });
    await manager.addServer({ name: "open", url: "https://mcp.example.com" });

    const authed = seenFactoryArgs.find((a) => a.serverName === "cre-agents");
    const anonymous = seenFactoryArgs.find((a) => a.serverName === "open");
    expect(authed?.getAuthToken?.()).toBe("access-token");
    expect(anonymous?.getAuthToken).toBeUndefined();

    const persisted = await store.list();
    const vic = persisted.find((c) => c.name === "cre-agents");
    expect(vic?.auth).toBe("oauth");
    expect(vic?.presetId).toBe("cre-agents");
    const open = persisted.find((c) => c.name === "open");
    expect(open?.auth).toBeUndefined();
    expect(open?.presetId).toBeUndefined();
  });

  it("oauth servers persist their tokens and send them via the client token getter", async () => {
    const store = createInMemoryMcpServerStore();
    const registry = newRegistry();
    const seenFactoryArgs: Array<{ getAuthToken?: () => string | null }> = [];
    const factory = fakeClientFactory();
    const manager = createMcpManager({
      store,
      registry,
      clientFactory: (args) => {
        seenFactoryArgs.push(args);
        return factory(args);
      },
    });

    const oauth = {
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAt: Date.now() + 3_600_000,
      tokenEndpoint: "https://auth.example.com/token",
      clientId: "client-123",
      resource: "https://app.creagents.com/api/mcp",
    };
    await manager.addServer({
      name: "cre-agents",
      url: "https://app.creagents.com/api/mcp",
      auth: "oauth",
      oauth,
      presetId: "cre-agents",
    });

    expect(seenFactoryArgs[0].getAuthToken?.()).toBe("access-1");
    const persisted = await store.list();
    expect(persisted[0].oauth?.accessToken).toBe("access-1");
    expect(manager.getStatuses()[0].state.status).toBe("connected");
  });

  it("refreshes an expired oauth token at connect time and persists the new one", async () => {
    const store = createInMemoryMcpServerStore();
    const fetchImpl = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ access_token: "access-2", expires_in: 3600 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );
    const seenFactoryArgs: Array<{ getAuthToken?: () => string | null }> = [];
    const factory = fakeClientFactory();
    const manager = createMcpManager({
      store,
      registry: newRegistry(),
      fetchImpl,
      clientFactory: (args) => {
        seenFactoryArgs.push(args);
        return factory(args);
      },
    });

    await manager.addServer({
      name: "cre-agents",
      url: "https://app.creagents.com/api/mcp",
      auth: "oauth",
      oauth: {
        accessToken: "stale",
        refreshToken: "refresh-1",
        expiresAt: Date.now() - 1000,
        tokenEndpoint: "https://auth.example.com/token",
        clientId: "client-123",
        resource: "https://app.creagents.com/api/mcp",
      },
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(seenFactoryArgs[0].getAuthToken?.()).toBe("access-2");
    expect((await store.list())[0].oauth?.accessToken).toBe("access-2");
    expect(manager.getStatuses()[0].state.status).toBe("connected");
  });

  it("an expired oauth server without a refresh token lands in error state", async () => {
    const store = createInMemoryMcpServerStore();
    const manager = createMcpManager({
      store,
      registry: newRegistry(),
      clientFactory: fakeClientFactory(),
    });

    await manager.addServer({
      name: "cre-agents",
      url: "https://app.creagents.com/api/mcp",
      auth: "oauth",
      oauth: {
        accessToken: "stale",
        expiresAt: Date.now() - 1000,
        tokenEndpoint: "https://auth.example.com/token",
        clientId: "client-123",
        resource: "https://app.creagents.com/api/mcp",
      },
    });

    const status = manager.getStatuses()[0];
    expect(status.state.status).toBe("error");
    if (status.state.status === "error") {
      expect(status.state.message).toMatch(/sign-in expired/i);
    }
    // Persisted — the user can remove + reconnect.
    expect(await store.list()).toHaveLength(1);
  });

  it("subscribers see status transitions: connecting → connected", async () => {
    const store = createInMemoryMcpServerStore();
    const registry = newRegistry();
    const manager = createMcpManager({
      store,
      registry,
      clientFactory: fakeClientFactory(),
    });

    const seen: McpServerStatus[][] = [];
    const unsub = manager.subscribe((s) => seen.push(s));

    await manager.addServer({ name: "acre", url: "https://example.com" });

    // Snapshot when subscribed (empty), then after add (connecting), then
    // after connect resolves (connected). Test for the connected end-state.
    expect(seen.length).toBeGreaterThanOrEqual(2);
    const final = seen[seen.length - 1];
    expect(final[0].state.status).toBe("connected");

    unsub();
  });
});
