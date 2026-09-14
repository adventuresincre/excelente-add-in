import { describe, expect, it, vi } from "vitest";
import { createConciergeClient, ANON_ID_HEADER } from "./concierge-client";
import { OpenRouterError, type ChatEvent } from "../openrouter";

function sseResponse(body: string, status = 200): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
  return new Response(stream, { status });
}

function sseChunk(obj: Record<string, unknown>): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

async function collect(stream: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

const ENDPOINT = "https://intelligence.adventuresincre.com/api/v1/concierge";

describe("createConciergeClient", () => {
  it("posts conversation turns to the endpoint with the anon-id header, no auth", async () => {
    const fetch = vi.fn().mockResolvedValue(sseResponse(`data: [DONE]\n\n`));
    const client = createConciergeClient(ENDPOINT, "anon-123", { fetch });

    await collect(client.chat({ messages: [{ role: "user", content: "what is this?" }] }));

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(ENDPOINT);
    expect(init.method).toBe("POST");
    expect(init.headers[ANON_ID_HEADER]).toBe("anon-123");
    expect(init.headers.Authorization).toBeUndefined();
    const body = JSON.parse(init.body as string);
    expect(body.stream).toBe(true);
    expect(body.messages).toEqual([{ role: "user", content: "what is this?" }]);
    // Guidance-only: the client never sends tools.
    expect(body.tools).toBeUndefined();
  });

  it("translates OpenRouter-format SSE into ChatEvents", async () => {
    const body =
      sseChunk({ choices: [{ index: 0, delta: { content: "Hi" } }] }) +
      sseChunk({ choices: [{ index: 0, delta: { content: " there" } }] }) +
      sseChunk({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }) +
      `data: [DONE]\n\n`;
    const fetch = vi.fn().mockResolvedValue(sseResponse(body));
    const client = createConciergeClient(ENDPOINT, "anon-123", { fetch });

    const events = await collect(client.chat({ messages: [{ role: "user", content: "hi" }] }));
    expect(events).toEqual([
      { type: "text-delta", text: "Hi" },
      { type: "text-delta", text: " there" },
      { type: "done", finishReason: "stop" },
    ]);
  });

  it("throws OpenRouterError on a non-2xx (e.g. 429 rate limit)", async () => {
    const fetch = vi.fn().mockResolvedValue(sseResponse("rate limited", 429));
    const client = createConciergeClient(ENDPOINT, "anon-123", { fetch });
    await expect(
      collect(client.chat({ messages: [{ role: "user", content: "hi" }] }))
    ).rejects.toBeInstanceOf(OpenRouterError);
  });
});
