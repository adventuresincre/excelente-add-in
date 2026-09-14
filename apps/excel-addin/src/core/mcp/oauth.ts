/**
 * MCP OAuth 2.1 client flow (authorization code + PKCE, public client) for
 * remote MCP servers that gate access behind their own hosted sign-in page
 * — e.g. CRE Agents at app.creagents.com, whose page does email + emailed
 * code, exactly like connecting the same server from Claude.
 *
 * The shape of the flow:
 *
 *   1. Probe the MCP endpoint unauthenticated. 200 → no auth needed (null).
 *   2. 401 → discover the authorization server (RFC 9728 protected-resource
 *      metadata via WWW-Authenticate or well-known fallbacks, then RFC 8414
 *      authorization-server metadata).
 *   3. Dynamically register Excelente as a public client (RFC 7591).
 *   4. Open the server's authorization page in a window the host UI
 *      controls (`openAuthWindow` — an Office dialog in production), wait
 *      for the redirect back to our callback with `?code&state`.
 *   5. Exchange the code (PKCE verifier, RFC 8707 `resource`) for tokens.
 *
 * Everything network is injectable for tests; everything browser-window is
 * behind `openAuthWindow` so this module stays Office-free.
 */

import type { McpOAuthTokens } from "../storage/mcp-store";

export class McpOAuthError extends Error {
  constructor(
    message: string,
    public readonly stage:
      | "probe"
      | "discovery"
      | "registration"
      | "authorization"
      | "exchange"
      | "refresh"
  ) {
    super(message);
    this.name = "McpOAuthError";
  }
}

/** What the auth window resolves with once the callback page reports back. */
export interface AuthWindowResult {
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
}

export type { McpOAuthTokens };

interface AuthServerMetadata {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  scopesSupported?: string[];
}

const PROBE_TIMEOUT_MS = 15_000;

/**
 * Returns true when the endpoint demands OAuth (responds 401 to an
 * unauthenticated initialize), false when it's open.
 */
export async function mcpRequiresAuth(
  mcpUrl: string,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)
): Promise<{ requiresAuth: boolean; wwwAuthenticate: string | null }> {
  let response: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      response = await fetchImpl(mcpUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 0,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "excelente", version: "0.1.0" },
          },
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (e) {
    throw new McpOAuthError(`Could not reach the MCP server: ${(e as Error).message}`, "probe");
  }
  if (response.status === 401 || response.status === 403) {
    return { requiresAuth: true, wwwAuthenticate: response.headers.get("WWW-Authenticate") };
  }
  return { requiresAuth: false, wwwAuthenticate: null };
}

/** Pulls `resource_metadata="…"` out of a WWW-Authenticate header. */
export function parseResourceMetadataUrl(header: string | null): string | null {
  if (!header) return null;
  const match = /resource_metadata\s*=\s*"([^"]+)"/i.exec(header);
  return match ? match[1] : null;
}

async function fetchJson(
  url: string,
  fetchImpl: typeof fetch
): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * RFC 9728 + RFC 8414 discovery with the well-known fallbacks remote MCP
 * servers in the wild actually need.
 */
export async function discoverAuthServer(
  mcpUrl: string,
  wwwAuthenticate: string | null,
  fetchImpl: typeof fetch
): Promise<AuthServerMetadata & { scopes?: string }> {
  const mcp = new URL(mcpUrl);

  // 1. Protected-resource metadata → issuer (+ scopes).
  const candidates: string[] = [];
  const fromHeader = parseResourceMetadataUrl(wwwAuthenticate);
  if (fromHeader) candidates.push(fromHeader);
  if (mcp.pathname !== "/") {
    candidates.push(`${mcp.origin}/.well-known/oauth-protected-resource${mcp.pathname}`);
  }
  candidates.push(`${mcp.origin}/.well-known/oauth-protected-resource`);

  let issuer = mcp.origin;
  let scopes: string | undefined;
  for (const url of candidates) {
    const meta = await fetchJson(url, fetchImpl);
    const servers = meta?.authorization_servers;
    if (Array.isArray(servers) && typeof servers[0] === "string") {
      issuer = servers[0].replace(/\/$/, "");
      const supported = meta?.scopes_supported;
      if (Array.isArray(supported) && supported.every((s) => typeof s === "string")) {
        scopes = (supported as string[]).join(" ");
      }
      break;
    }
  }

  // 2. Authorization-server metadata at the issuer.
  const issuerUrl = new URL(issuer);
  const metaCandidates: string[] = [];
  if (issuerUrl.pathname !== "/") {
    metaCandidates.push(
      `${issuerUrl.origin}/.well-known/oauth-authorization-server${issuerUrl.pathname}`
    );
  }
  metaCandidates.push(`${issuerUrl.origin}/.well-known/oauth-authorization-server`);
  metaCandidates.push(`${issuer}/.well-known/openid-configuration`);

  for (const url of metaCandidates) {
    const meta = await fetchJson(url, fetchImpl);
    const authorizationEndpoint = meta?.authorization_endpoint;
    const tokenEndpoint = meta?.token_endpoint;
    if (typeof authorizationEndpoint === "string" && typeof tokenEndpoint === "string") {
      const registrationEndpoint = meta?.registration_endpoint;
      return {
        authorizationEndpoint,
        tokenEndpoint,
        registrationEndpoint:
          typeof registrationEndpoint === "string" ? registrationEndpoint : undefined,
        scopes,
      };
    }
  }

  throw new McpOAuthError(
    `Could not discover the sign-in service for ${mcp.origin}. The server may not support standard MCP authorization.`,
    "discovery"
  );
}

/** RFC 7591 dynamic registration as a public (no-secret) client. */
export async function registerClient(
  registrationEndpoint: string,
  redirectUri: string,
  fetchImpl: typeof fetch
): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(registrationEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Excelente",
        client_uri: "https://excelente.aiedge.ac/support",
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
    });
  } catch (e) {
    throw new McpOAuthError(`Client registration failed: ${(e as Error).message}`, "registration");
  }
  const json = response.ok ? ((await response.json()) as Record<string, unknown>) : null;
  const clientId = json?.client_id;
  if (typeof clientId !== "string" || !clientId) {
    throw new McpOAuthError(
      `The sign-in service rejected client registration (HTTP ${response.status}).`,
      "registration"
    );
  }
  return clientId;
}

/** 43–128 char URL-safe verifier per RFC 7636. */
export function generatePkceVerifier(): string {
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function buildAuthorizationUrl(args: {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
  resource: string;
  scopes?: string;
}): string {
  const url = new URL(args.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", args.clientId);
  url.searchParams.set("redirect_uri", args.redirectUri);
  url.searchParams.set("code_challenge", args.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", args.state);
  url.searchParams.set("resource", args.resource);
  if (args.scopes) url.searchParams.set("scope", args.scopes);
  return url.toString();
}

async function tokenRequest(
  tokenEndpoint: string,
  form: Record<string, string>,
  stage: "exchange" | "refresh",
  fetchImpl: typeof fetch
): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: number }> {
  let response: Response;
  try {
    response = await fetchImpl(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
    });
  } catch (e) {
    throw new McpOAuthError(`Token request failed: ${(e as Error).message}`, stage);
  }
  const json = response.ok ? ((await response.json()) as Record<string, unknown>) : null;
  const accessToken = json?.access_token;
  if (typeof accessToken !== "string" || !accessToken) {
    throw new McpOAuthError(
      `The sign-in service did not return a token (HTTP ${response.status}).`,
      stage
    );
  }
  const refreshToken = json?.refresh_token;
  const expiresIn = json?.expires_in;
  return {
    accessToken,
    refreshToken: typeof refreshToken === "string" ? refreshToken : undefined,
    expiresAt:
      typeof expiresIn === "number" && Number.isFinite(expiresIn)
        ? Date.now() + expiresIn * 1000
        : undefined,
  };
}

/** Refresh an expired access token. Throws `McpOAuthError("refresh")`. */
export async function refreshOAuthTokens(
  tokens: McpOAuthTokens,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)
): Promise<McpOAuthTokens> {
  if (!tokens.refreshToken) {
    throw new McpOAuthError("No refresh token — sign in again.", "refresh");
  }
  const next = await tokenRequest(
    tokens.tokenEndpoint,
    {
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
      client_id: tokens.clientId,
      resource: tokens.resource,
    },
    "refresh",
    fetchImpl
  );
  return {
    ...tokens,
    accessToken: next.accessToken,
    // Some servers rotate refresh tokens; keep the old one when they don't.
    refreshToken: next.refreshToken ?? tokens.refreshToken,
    expiresAt: next.expiresAt,
  };
}

/**
 * The whole dance. Returns null when the server turns out to be open (no
 * auth required), otherwise the tokens to persist on the server config.
 */
export async function runMcpOAuthFlow(args: {
  mcpUrl: string;
  redirectUri: string;
  /**
   * Open `url` in a user-visible window and resolve with the callback
   * params once the page redirects back (or the user closes it). In
   * production this is an Office dialog (`office-dialog.ts`).
   */
  openAuthWindow: (url: string) => Promise<AuthWindowResult>;
  fetchImpl?: typeof fetch;
}): Promise<McpOAuthTokens | null> {
  const fetchImpl = args.fetchImpl ?? globalThis.fetch.bind(globalThis);

  const probe = await mcpRequiresAuth(args.mcpUrl, fetchImpl);
  if (!probe.requiresAuth) return null;

  const server = await discoverAuthServer(args.mcpUrl, probe.wwwAuthenticate, fetchImpl);
  if (!server.registrationEndpoint) {
    throw new McpOAuthError(
      "The sign-in service does not accept new client registrations.",
      "registration"
    );
  }
  const clientId = await registerClient(server.registrationEndpoint, args.redirectUri, fetchImpl);

  const verifier = generatePkceVerifier();
  const state = generatePkceVerifier();
  const authorizationUrl = buildAuthorizationUrl({
    authorizationEndpoint: server.authorizationEndpoint,
    clientId,
    redirectUri: args.redirectUri,
    codeChallenge: await pkceChallenge(verifier),
    state,
    resource: args.mcpUrl,
    scopes: server.scopes,
  });

  const result = await args.openAuthWindow(authorizationUrl);
  if (result.error || !result.code) {
    throw new McpOAuthError(
      result.errorDescription || result.error || "Sign-in was cancelled.",
      "authorization"
    );
  }
  if (result.state !== state) {
    throw new McpOAuthError("Sign-in response did not match this request.", "authorization");
  }

  const tokens = await tokenRequest(
    server.tokenEndpoint,
    {
      grant_type: "authorization_code",
      code: result.code,
      redirect_uri: args.redirectUri,
      client_id: clientId,
      code_verifier: verifier,
      resource: args.mcpUrl,
    },
    "exchange",
    fetchImpl
  );

  return {
    ...tokens,
    tokenEndpoint: server.tokenEndpoint,
    clientId,
    resource: args.mcpUrl,
  };
}
