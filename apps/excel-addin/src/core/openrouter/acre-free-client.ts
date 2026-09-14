import { ACRE_FREE_ENDPOINT } from "../config";
import { createOpenRouterClient, OpenRouterError, type OpenRouterClient } from "./client";
import type { ChatEvent, ChatRequest } from "./types";

/**
 * Client for the A.CRE Free tier.
 *
 * A.CRE funds this tier with its own OpenRouter key, and a task pane cannot
 * hold that key — the bundle is public. So the pane talks to A.CRE's proxy
 * (`server/acre-free/`), which attaches the key and pins the model
 * server-side. Same wire format as OpenRouter, so everything downstream of
 * `OpenRouterClient` is unchanged. No credential of any kind is sent.
 *
 * Distinct from the Intel Hub member relay in `core/relay/`: that one
 * authenticates a member session and meters credits. A.CRE Free has neither.
 */
export function createAcreFreeClient(
  opts: { fetch?: typeof fetch; baseUrl?: string } = {}
): OpenRouterClient {
  const client = createOpenRouterClient({
    fetch: opts.fetch,
    baseUrl: opts.baseUrl ?? ACRE_FREE_ENDPOINT,
    // Whatever key is on the ChatRequest belongs to BYOK and must not cross
    // this boundary. The proxy needs nothing from us.
    buildAuthHeaders: () => ({ "Content-Type": "application/json" }),
  });

  return {
    async *chat(req: ChatRequest): AsyncIterable<ChatEvent> {
      try {
        yield* client.chat(req);
      } catch (e) {
        throw translateProxyError(e);
      }
    },
    listModels() {
      // The proxy exposes /chat/completions only. Listing models is a picker
      // concern and needs the user's own key; A.CRE Free offers one model.
      return Promise.reject(new Error("A.CRE Free does not expose a model list."));
    },
  };
}

/** Codes the proxy attaches to its own refusals (server/acre-free/service.mjs). */
const FINAL_CODES = new Set([
  "monthly_cap",
  "disabled",
  "forbidden_origin",
  "too_large",
  "bad_request",
]);

/**
 * The proxy speaks in plain English with a machine-readable `code`. Surface
 * the sentence as-is instead of `OpenRouter 429: {…json…}`, and tell the
 * orchestrator which refusals are final so it does not retry a monthly cap
 * three times with backoff before showing it.
 */
function translateProxyError(e: unknown): unknown {
  if (!(e instanceof OpenRouterError)) return e;
  let message: string | undefined;
  let code: string | undefined;
  try {
    const body = JSON.parse(e.responseBody) as { error?: { message?: unknown; code?: unknown } };
    if (typeof body.error?.message === "string") message = body.error.message;
    if (typeof body.error?.code === "string") code = body.error.code;
  } catch {
    // Not our envelope (e.g. an HTML 413 from nginx) — fall through.
  }
  if (!message) {
    message =
      e.status === 413
        ? "That request is too large for A.CRE Free. Remove or shrink the attachment and try again."
        : `A.CRE Free request failed (${e.status}).`;
  }
  const retryable = code ? !FINAL_CODES.has(code) : e.status === 429 || e.status >= 500;
  return new OpenRouterError(e.status, e.responseBody, { message, retryable });
}
