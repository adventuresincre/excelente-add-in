import { describe, expect, it, vi } from "vitest";
import {
  buildAuthorizationUrl,
  discoverAuthServer,
  generatePkceVerifier,
  mcpRequiresAuth,
  parseResourceMetadataUrl,
  pkceChallenge,
  refreshOAuthTokens,
  registerClient,
  runMcpOAuthFlow,
} from "./oauth";

const MCP_URL = "https://app.creagents.com/api/mcp";

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

/** Routes fetches by URL substring; 404s anything unrouted. */
function routedFetch(routes: Array<[match: string, respond: () => Response]>) {
  return vi.fn().mockImplementation((url: string) => {
    for (const [match, respond] of routes) {
      if (String(url).includes(match)) return Promise.resolve(respond());
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  });
}

describe("parseResourceMetadataUrl", () => {
  it("extracts the resource_metadata URL from WWW-Authenticate", () => {
    expect(
      parseResourceMetadataUrl(
        'Bearer realm="mcp", resource_metadata="https://x.example/.well-known/oauth-protected-resource"'
      )
    ).toBe("https://x.example/.well-known/oauth-protected-resource");
    expect(parseResourceMetadataUrl('Bearer realm="mcp"')).toBeNull();
    expect(parseResourceMetadataUrl(null)).toBeNull();
  });
});

describe("mcpRequiresAuth", () => {
  it("reports 401 endpoints as requiring auth, with the header captured", async () => {
    const fetchImpl = routedFetch([
      [
        "/api/mcp",
        () =>
          new Response("unauthorized", {
            status: 401,
            headers: { "WWW-Authenticate": 'Bearer resource_metadata="https://a.b/prm"' },
          }),
      ],
    ]);
    const result = await mcpRequiresAuth(MCP_URL, fetchImpl);
    expect(result.requiresAuth).toBe(true);
    expect(result.wwwAuthenticate).toContain("resource_metadata");
  });

  it("reports open endpoints as not requiring auth", async () => {
    const fetchImpl = routedFetch([
      ["/api/mcp", () => json({ jsonrpc: "2.0", id: 0, result: {} })],
    ]);
    const result = await mcpRequiresAuth(MCP_URL, fetchImpl);
    expect(result.requiresAuth).toBe(false);
  });
});

describe("discoverAuthServer", () => {
  it("follows protected-resource metadata to the authorization server metadata", async () => {
    const fetchImpl = routedFetch([
      [
        "/.well-known/oauth-protected-resource",
        () =>
          json({
            resource: MCP_URL,
            authorization_servers: ["https://auth.creagents.com"],
            scopes_supported: ["mcp:tools", "offline_access"],
          }),
      ],
      [
        "auth.creagents.com/.well-known/oauth-authorization-server",
        () =>
          json({
            authorization_endpoint: "https://auth.creagents.com/authorize",
            token_endpoint: "https://auth.creagents.com/token",
            registration_endpoint: "https://auth.creagents.com/register",
          }),
      ],
    ]);

    const server = await discoverAuthServer(MCP_URL, null, fetchImpl);
    expect(server.authorizationEndpoint).toBe("https://auth.creagents.com/authorize");
    expect(server.tokenEndpoint).toBe("https://auth.creagents.com/token");
    expect(server.registrationEndpoint).toBe("https://auth.creagents.com/register");
    expect(server.scopes).toBe("mcp:tools offline_access");
  });

  it("falls back to the MCP origin as issuer when resource metadata is missing", async () => {
    const fetchImpl = routedFetch([
      [
        "app.creagents.com/.well-known/oauth-authorization-server",
        () =>
          json({
            authorization_endpoint: "https://app.creagents.com/authorize",
            token_endpoint: "https://app.creagents.com/token",
          }),
      ],
    ]);

    const server = await discoverAuthServer(MCP_URL, null, fetchImpl);
    expect(server.authorizationEndpoint).toBe("https://app.creagents.com/authorize");
  });

  it("throws a discovery error when no metadata is reachable", async () => {
    const fetchImpl = routedFetch([]);
    await expect(discoverAuthServer(MCP_URL, null, fetchImpl)).rejects.toThrow(
      /could not discover/i
    );
  });
});

describe("registerClient", () => {
  it("registers a public client and returns the client_id", async () => {
    const fetchImpl = routedFetch([["/register", () => json({ client_id: "client-123" })]]);
    const clientId = await registerClient(
      "https://auth.creagents.com/register",
      "https://localhost:3000/auth-callback.html",
      fetchImpl
    );
    expect(clientId).toBe("client-123");
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(body.token_endpoint_auth_method).toBe("none");
    expect(body.redirect_uris).toEqual(["https://localhost:3000/auth-callback.html"]);
  });
});

describe("PKCE", () => {
  it("generates URL-safe verifiers and S256 challenges", async () => {
    const verifier = generatePkceVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    const challenge = await pkceChallenge(verifier);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).not.toBe(verifier);
  });
});

describe("buildAuthorizationUrl", () => {
  it("carries PKCE, state, and the RFC 8707 resource", () => {
    const url = new URL(
      buildAuthorizationUrl({
        authorizationEndpoint: "https://auth.creagents.com/authorize",
        clientId: "client-123",
        redirectUri: "https://localhost:3000/auth-callback.html",
        codeChallenge: "challenge",
        state: "state-1",
        resource: MCP_URL,
        scopes: "mcp:tools",
      })
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("resource")).toBe(MCP_URL);
    expect(url.searchParams.get("scope")).toBe("mcp:tools");
  });
});

describe("runMcpOAuthFlow", () => {
  function fullServerFetch(opts: { tokenResponds?: () => Response } = {}) {
    return routedFetch([
      [
        "/api/mcp",
        () =>
          new Response("unauthorized", {
            status: 401,
            headers: {
              "WWW-Authenticate":
                'Bearer resource_metadata="https://app.creagents.com/.well-known/oauth-protected-resource"',
            },
          }),
      ],
      [
        "/.well-known/oauth-protected-resource",
        () => json({ authorization_servers: ["https://auth.creagents.com"] }),
      ],
      [
        "/.well-known/oauth-authorization-server",
        () =>
          json({
            authorization_endpoint: "https://auth.creagents.com/authorize",
            token_endpoint: "https://auth.creagents.com/token",
            registration_endpoint: "https://auth.creagents.com/register",
          }),
      ],
      ["/register", () => json({ client_id: "client-123" })],
      [
        "/token",
        opts.tokenResponds ??
          (() =>
            json({
              access_token: "access-1",
              refresh_token: "refresh-1",
              expires_in: 3600,
            })),
      ],
    ]);
  }

  it("runs discovery → registration → authorization → exchange and returns tokens", async () => {
    const fetchImpl = fullServerFetch();
    let openedUrl = "";
    const tokens = await runMcpOAuthFlow({
      mcpUrl: MCP_URL,
      redirectUri: "https://localhost:3000/auth-callback.html",
      openAuthWindow: (url) => {
        openedUrl = url;
        const state = new URL(url).searchParams.get("state")!;
        return Promise.resolve({ code: "auth-code", state });
      },
      fetchImpl,
    });

    expect(tokens?.accessToken).toBe("access-1");
    expect(tokens?.refreshToken).toBe("refresh-1");
    expect(tokens?.clientId).toBe("client-123");
    expect(tokens?.tokenEndpoint).toBe("https://auth.creagents.com/token");
    expect(tokens?.resource).toBe(MCP_URL);
    expect(tokens?.expiresAt).toBeGreaterThan(Date.now());
    expect(openedUrl).toContain("https://auth.creagents.com/authorize");

    // The exchange used the code + PKCE verifier as form encoding.
    const tokenCall = fetchImpl.mock.calls.find(([u]) => String(u).includes("/token"));
    const form = new URLSearchParams(tokenCall![1].body as string);
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("auth-code");
    expect(form.get("code_verifier")).toBeTruthy();
    expect(form.get("resource")).toBe(MCP_URL);
  });

  it("returns null for servers that turn out to be open", async () => {
    const fetchImpl = routedFetch([
      ["/api/mcp", () => json({ jsonrpc: "2.0", id: 0, result: {} })],
    ]);
    const tokens = await runMcpOAuthFlow({
      mcpUrl: MCP_URL,
      redirectUri: "https://localhost:3000/auth-callback.html",
      openAuthWindow: () => Promise.reject(new Error("should not be called")),
      fetchImpl,
    });
    expect(tokens).toBeNull();
  });

  it("rejects when the user closes the sign-in window", async () => {
    const fetchImpl = fullServerFetch();
    await expect(
      runMcpOAuthFlow({
        mcpUrl: MCP_URL,
        redirectUri: "https://localhost:3000/auth-callback.html",
        openAuthWindow: () =>
          Promise.resolve({ error: "window_closed", errorDescription: "closed" }),
        fetchImpl,
      })
    ).rejects.toThrow(/closed/);
  });

  it("rejects on a state mismatch", async () => {
    const fetchImpl = fullServerFetch();
    await expect(
      runMcpOAuthFlow({
        mcpUrl: MCP_URL,
        redirectUri: "https://localhost:3000/auth-callback.html",
        openAuthWindow: () => Promise.resolve({ code: "auth-code", state: "wrong" }),
        fetchImpl,
      })
    ).rejects.toThrow(/did not match/);
  });
});

describe("refreshOAuthTokens", () => {
  const TOKENS = {
    accessToken: "old-access",
    refreshToken: "refresh-1",
    expiresAt: Date.now() - 1000,
    tokenEndpoint: "https://auth.creagents.com/token",
    clientId: "client-123",
    resource: MCP_URL,
  };

  it("exchanges the refresh token and keeps the old one when not rotated", async () => {
    const fetchImpl = routedFetch([
      ["/token", () => json({ access_token: "new-access", expires_in: 3600 })],
    ]);
    const next = await refreshOAuthTokens(TOKENS, fetchImpl);
    expect(next.accessToken).toBe("new-access");
    expect(next.refreshToken).toBe("refresh-1");
    const form = new URLSearchParams(fetchImpl.mock.calls[0][1].body as string);
    expect(form.get("grant_type")).toBe("refresh_token");
  });

  it("throws a refresh error when there is no refresh token", async () => {
    await expect(refreshOAuthTokens({ ...TOKENS, refreshToken: undefined })).rejects.toThrow(
      /sign in again/i
    );
  });
});
