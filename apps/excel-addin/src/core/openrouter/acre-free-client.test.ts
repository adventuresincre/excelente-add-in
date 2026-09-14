import { describe, expect, it } from "vitest";
import { ACRE_FREE_ENDPOINT } from "../config";
import { createAcreFreeClient } from "./acre-free-client";
import { OpenRouterError } from "./client";

function sseResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

async function drain(events: AsyncIterable<unknown>): Promise<void> {
  for await (const _ of events) {
    // consume
  }
}

describe("A.CRE Free client", () => {
  it("posts to A.CRE's proxy, not to OpenRouter, with no credential", async () => {
    let seenUrl = "";
    let headers: Record<string, string> = {};
    const client = createAcreFreeClient({
      fetch: async (url, init) => {
        seenUrl = String(url);
        headers = (init?.headers ?? {}) as Record<string, string>;
        return sseResponse("data: [DONE]\n\n");
      },
    });

    await drain(
      client.chat({ apiKey: "sk-or-v1-should-not-be-sent", model: "acre-free", messages: [] })
    );

    expect(seenUrl).toBe(`${ACRE_FREE_ENDPOINT}/chat/completions`);
    expect(seenUrl).not.toContain("openrouter.ai");
    expect(headers.Authorization).toBeUndefined();
    expect(JSON.stringify(headers)).not.toContain("sk-or-v1");
  });

  it("surfaces the proxy's sentence and marks a monthly cap as final", async () => {
    const client = createAcreFreeClient({
      fetch: async () =>
        new Response(
          JSON.stringify({
            error: { code: "monthly_cap", message: "This network has used its $10." },
          }),
          { status: 429 }
        ),
    });
    const error = await drain(client.chat({ apiKey: "", model: "acre-free", messages: [] })).catch(
      (e) => e
    );
    expect(error).toBeInstanceOf(OpenRouterError);
    expect(error.message).toBe("This network has used its $10.");
    expect(error.retryable).toBe(false);
  });

  it("keeps a rate limit retryable", async () => {
    const client = createAcreFreeClient({
      fetch: async () =>
        new Response(
          JSON.stringify({ error: { code: "rate_limited", message: "Wait a moment." } }),
          {
            status: 429,
          }
        ),
    });
    const error = await drain(client.chat({ apiKey: "", model: "acre-free", messages: [] })).catch(
      (e) => e
    );
    expect(error.retryable).toBe(true);
  });

  it("gives an nginx 413 a human message instead of raw HTML", async () => {
    const client = createAcreFreeClient({
      fetch: async () => new Response("<html>413 Request Entity Too Large</html>", { status: 413 }),
    });
    const error = await drain(client.chat({ apiKey: "", model: "acre-free", messages: [] })).catch(
      (e) => e
    );
    expect(error.message).toMatch(/too large/i);
    expect(error.message).not.toContain("<html>");
    expect(error.retryable).toBe(false);
  });

  it("refuses to list models — that needs the user's own key", async () => {
    const client = createAcreFreeClient({ fetch: async () => sseResponse("") });
    await expect(client.listModels("")).rejects.toThrow(/does not expose a model list/);
  });
});
