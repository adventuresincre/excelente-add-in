import { createOpenRouterClient, type ClientOptions, type OpenRouterClient } from "../openrouter";

const TITLE = "Excelente";

/**
 * Auth headers for the A.CRE member relay. The bearer is the member *session
 * token* (not an OpenRouter key) — the relay validates it, injects A.CRE's
 * server-side provider key, meters credits, and echoes `credits_remaining` in
 * the usage chunk. `HTTP-Referer` is intentionally omitted (it's
 * OpenRouter-specific); we keep `X-Title` for parity.
 */
export function relayAuthHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "X-Title": TITLE,
  };
}

/**
 * An OpenRouter-compatible client pointed at the member relay. Because it
 * reuses `createOpenRouterClient`, the entire streaming / caching / usage
 * pipeline is identical to the direct path — only the base URL and auth
 * headers differ. The session token is supplied per request as the request's
 * `apiKey`, so token refreshes are picked up automatically without recreating
 * the client. `baseUrl` is captured here, so recreate the client if
 * `member.relay.baseUrl` changes (i.e. on a config version bump).
 */
export function createRelayClient(
  baseUrl: string,
  opts: { fetch?: ClientOptions["fetch"] } = {}
): OpenRouterClient {
  return createOpenRouterClient({
    fetch: opts.fetch,
    baseUrl,
    buildAuthHeaders: relayAuthHeaders,
  });
}
