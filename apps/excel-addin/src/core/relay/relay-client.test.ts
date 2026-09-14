import { describe, expect, it, vi } from "vitest";
import { createRelayClient, relayAuthHeaders } from "./relay-client";
import type { ChatEvent } from "../openrouter";

function sseResponse(body: string): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

async function collect(stream: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

describe("relayAuthHeaders", () => {
  it("sends Bearer + X-Title and omits the OpenRouter HTTP-Referer", () => {
    const headers = relayAuthHeaders("session-token-xyz");
    expect(headers.Authorization).toBe("Bearer session-token-xyz");
    expect(headers["X-Title"]).toBe("Excelente");
    expect(headers["HTTP-Referer"]).toBeUndefined();
  });
});

describe("createRelayClient", () => {
  const RELAY = "https://relay.adventuresincre.com/v1";

  it("posts to the relay base URL with the session token as the bearer", async () => {
    const fetch = vi.fn().mockResolvedValue(sseResponse(`data: [DONE]\n\n`));
    const client = createRelayClient(RELAY, { fetch });

    await collect(
      client.chat({
        apiKey: "member-session-token",
        model: "anthropic/claude-opus-4-7",
        messages: [{ role: "user", content: "hi" }],
      })
    );

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`${RELAY}/chat/completions`);
    expect(init.headers.Authorization).toBe("Bearer member-session-token");
    expect(init.headers["X-Title"]).toBe("Excelente");
    expect(init.headers["HTTP-Referer"]).toBeUndefined();
    const body = JSON.parse(init.body as string);
    expect(body.stream).toBe(true);
    expect(body.usage).toEqual({ include: true });
  });

  it("surfaces the relay-reported credits_remaining via the usage event", async () => {
    const body =
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "ok" } }] })}\n\n` +
      `data: ${JSON.stringify({
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 10,
          total_tokens: 110,
          cost: 0.0123,
          credits_remaining: 842,
        },
      })}\n\n` +
      `data: [DONE]\n\n`;
    const fetch = vi.fn().mockResolvedValue(sseResponse(body));
    const client = createRelayClient(RELAY, { fetch });

    const events = await collect(
      client.chat({
        apiKey: "tok",
        model: "anthropic/claude-sonnet-4-6",
        messages: [{ role: "user", content: "hi" }],
      })
    );
    const usage = events.find((e) => e.type === "usage");
    expect(usage).toMatchObject({ type: "usage", usage: { creditsRemaining: 842 } });
  });

  it("lists models from the relay base URL", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), {
        headers: { "Content-Type": "application/json" },
      })
    );
    const client = createRelayClient(RELAY, { fetch });
    await client.listModels("tok");
    expect(fetch.mock.calls[0][0]).toBe(`${RELAY}/models`);
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer tok");
  });
});
