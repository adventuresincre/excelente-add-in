import {
  OpenRouterError,
  parseSseLines,
  translateStream,
  type ChatEvent,
  type ChatMessage,
} from "../openrouter";

/** Header carrying a stable per-install id so the concierge can rate-limit. */
export const ANON_ID_HEADER = "X-Excelente-Anon-Id";

export interface ConciergeRequest {
  messages: ChatMessage[];
  signal?: AbortSignal;
}

export interface ConciergeClient {
  chat(req: ConciergeRequest): AsyncIterable<ChatEvent>;
}

/**
 * Client for the A.CRE concierge — a free, guidance-only assistant for users
 * who haven't picked a path yet. It is deliberately minimal: **no auth, no
 * tools, no workbook access**. The server applies the guidance system prompt
 * (keyed by `concierge.systemPromptId`), so the client only sends the
 * conversation turns. The endpoint speaks OpenRouter SSE, so we reuse the
 * exact same stream translation as the main client.
 *
 * `anonId` is a stable random id minted once per install (not tied to a user)
 * so the server can rate-limit per install in addition to per IP.
 */
export function createConciergeClient(
  endpoint: string,
  anonId: string,
  opts: { fetch?: typeof fetch } = {}
): ConciergeClient {
  const fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
  return {
    chat(req) {
      return conciergeStream(fetchImpl, endpoint, anonId, req);
    },
  };
}

async function* conciergeStream(
  fetchImpl: typeof fetch,
  endpoint: string,
  anonId: string,
  req: ConciergeRequest
): AsyncIterable<ChatEvent> {
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [ANON_ID_HEADER]: anonId,
    },
    body: JSON.stringify({ messages: req.messages, stream: true }),
    signal: req.signal,
  });

  if (!response.ok) {
    throw new OpenRouterError(response.status, await safeText(response));
  }
  if (!response.body) {
    throw new Error("Concierge response had no body");
  }

  yield* translateStream(parseSseLines(response.body));
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
