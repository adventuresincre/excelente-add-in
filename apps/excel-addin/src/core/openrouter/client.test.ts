import { describe, expect, it, vi } from "vitest";
import { createOpenRouterClient, OpenRouterError } from "./client";
import type { ChatEvent } from "./types";

function sseResponse(body: string): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function sseChunk(obj: Record<string, unknown>): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

async function collect(stream: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

describe("createOpenRouterClient.chat", () => {
  it("streams text deltas, usage, and finish reason in order", async () => {
    const body =
      sseChunk({
        choices: [{ index: 0, delta: { role: "assistant", content: "Hel" } }],
      }) +
      sseChunk({ choices: [{ index: 0, delta: { content: "lo" } }] }) +
      sseChunk({
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, cost: 0.00003 },
      }) +
      `data: [DONE]\n\n`;

    const fetch = vi.fn().mockResolvedValue(sseResponse(body));
    const client = createOpenRouterClient({ fetch });

    const events = await collect(
      client.chat({
        apiKey: "sk-test",
        model: "anthropic/claude-opus-4-7",
        messages: [{ role: "user", content: "hi" }],
      })
    );

    expect(events).toEqual([
      { type: "text-delta", text: "Hel" },
      { type: "text-delta", text: "lo" },
      { type: "done", finishReason: "stop" },
      {
        type: "usage",
        usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12, cost: 0.00003 },
      },
    ]);
  });

  it("emits reasoning deltas separately from text", async () => {
    const body =
      sseChunk({ choices: [{ index: 0, delta: { reasoning: "Let me think" } }] }) +
      sseChunk({ choices: [{ index: 0, delta: { content: "answer" } }] }) +
      sseChunk({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }) +
      `data: [DONE]\n\n`;

    const fetch = vi.fn().mockResolvedValue(sseResponse(body));
    const client = createOpenRouterClient({ fetch });
    const events = await collect(
      client.chat({
        apiKey: "k",
        model: "openai/o3",
        messages: [{ role: "user", content: "hi" }],
        reasoning: "medium",
      })
    );

    expect(events).toEqual([
      { type: "reasoning-delta", text: "Let me think" },
      { type: "text-delta", text: "answer" },
      { type: "done", finishReason: "stop" },
    ]);

    // Verify reasoning param passed to OpenRouter
    const callBody = JSON.parse(fetch.mock.calls[0][1].body as string);
    expect(callBody.reasoning).toEqual({ effort: "medium" });
  });

  it("emits tool-call-start once per index, then tool-call-delta for each args chunk", async () => {
    const body =
      sseChunk({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_a",
                  type: "function",
                  function: { name: "read_range", arguments: `{"add` },
                },
              ],
            },
          },
        ],
      }) +
      sseChunk({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ index: 0, function: { arguments: `ress":"A1"}` } }],
            },
          },
        ],
      }) +
      sseChunk({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }) +
      `data: [DONE]\n\n`;

    const fetch = vi.fn().mockResolvedValue(sseResponse(body));
    const client = createOpenRouterClient({ fetch });
    const events = await collect(
      client.chat({
        apiKey: "k",
        model: "anthropic/claude-opus-4-7",
        messages: [{ role: "user", content: "x" }],
      })
    );

    expect(events).toEqual([
      { type: "tool-call-start", index: 0, id: "call_a", name: "read_range" },
      { type: "tool-call-delta", index: 0, argumentsDelta: `{"add` },
      { type: "tool-call-delta", index: 0, argumentsDelta: `ress":"A1"}` },
      { type: "done", finishReason: "tool_calls" },
    ]);
  });

  it("serializes object-form tool-call arguments (non-conformant providers)", async () => {
    // Some providers behind OpenRouter emit the parsed arguments OBJECT in
    // a single delta instead of streaming JSON string fragments. Dropping
    // it (the old behavior) yielded tool calls with empty arguments that
    // the model could never fix from its side.
    const body =
      sseChunk({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_obj",
                  function: {
                    name: "write_range",
                    arguments: { sheetName: "dcf", address: "B2:K2", formulas: [["a"]] },
                  },
                },
              ],
            },
          },
        ],
      }) +
      sseChunk({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }) +
      `data: [DONE]\n\n`;

    const fetch = vi.fn().mockResolvedValue(sseResponse(body));
    const client = createOpenRouterClient({ fetch });
    const events = await collect(
      client.chat({
        apiKey: "k",
        model: "z-ai/glm-5.2",
        messages: [{ role: "user", content: "x" }],
      })
    );

    expect(events).toEqual([
      { type: "tool-call-start", index: 0, id: "call_obj", name: "write_range" },
      {
        type: "tool-call-delta",
        index: 0,
        argumentsDelta: JSON.stringify({ sheetName: "dcf", address: "B2:K2", formulas: [["a"]] }),
      },
      { type: "done", finishReason: "tool_calls" },
    ]);
  });

  it("throws OpenRouterError on non-2xx response", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "Invalid key" } }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })
    );
    const client = createOpenRouterClient({ fetch });

    await expect(
      collect(
        client.chat({
          apiKey: "bad",
          model: "x",
          messages: [{ role: "user", content: "hi" }],
        })
      )
    ).rejects.toBeInstanceOf(OpenRouterError);
  });

  it("recovers Kimi-format tool calls when finish_reason is tool_calls but no structured calls came through", async () => {
    // Kimi K2 emits tool calls inside delta.content using special tokens
    // instead of the OpenAI-standard delta.tool_calls field. The translator
    // synthesizes structured events from those tokens before yielding 'done'.
    const kimiContent = `Let me check this.
<|tool_calls_section_begin|>
<|tool_call_begin|>functions.list_sheets:0<|tool_call_argument_begin|>{}<|tool_call_end|>
<|tool_calls_section_end|>`;
    const body =
      sseChunk({ choices: [{ index: 0, delta: { content: kimiContent } }] }) +
      sseChunk({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }) +
      `data: [DONE]\n\n`;
    const fetch = vi.fn().mockResolvedValue(sseResponse(body));
    const client = createOpenRouterClient({ fetch });
    const events = await collect(
      client.chat({
        apiKey: "k",
        model: "moonshotai/kimi-latest",
        messages: [{ role: "user", content: "x" }],
      })
    );

    const startEvent = events.find((e) => e.type === "tool-call-start");
    const deltaEvent = events.find((e) => e.type === "tool-call-delta");
    expect(startEvent).toMatchObject({
      type: "tool-call-start",
      index: 0,
      name: "list_sheets",
    });
    expect(deltaEvent).toMatchObject({
      type: "tool-call-delta",
      index: 0,
      argumentsDelta: "{}",
    });
    expect(events[events.length - 1]).toMatchObject({
      type: "done",
      finishReason: "tool_calls",
    });
  });

  it("propagates an in-stream error chunk", async () => {
    const body =
      sseChunk({ choices: [{ index: 0, delta: { content: "ok" } }] }) +
      sseChunk({ error: { message: "rate limited" } }) +
      `data: [DONE]\n\n`;
    const fetch = vi.fn().mockResolvedValue(sseResponse(body));
    const client = createOpenRouterClient({ fetch });

    await expect(
      collect(
        client.chat({
          apiKey: "k",
          model: "x",
          messages: [{ role: "user", content: "hi" }],
        })
      )
    ).rejects.toThrow(/rate limited/);
  });

  // A model that makes reasoning mandatory answers `enabled:false` with
  // HTTP 400 — and so would any model whose ladder we did not know. A
  // reasoning preference must never cost the user a turn: retry once with
  // the parameter omitted, which yields the model's default.
  it("retries once without `reasoning` when a 400 blames the reasoning parameter", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message: "Reasoning is mandatory for this endpoint and cannot be disabled",
            },
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        sseResponse(
          sseChunk({ choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }] }) +
            `data: [DONE]\n\n`
        )
      );
    const client = createOpenRouterClient({ fetch });

    const events = await collect(
      client.chat({
        apiKey: "k",
        model: "z-ai/glm-5.3-flash",
        messages: [{ role: "user", content: "hi" }],
        reasoning: "off",
        reasoningPolicy: { mandatory: false },
      })
    );

    expect(fetch).toHaveBeenCalledTimes(2);
    const first = JSON.parse(fetch.mock.calls[0][1].body as string);
    const second = JSON.parse(fetch.mock.calls[1][1].body as string);
    expect(first.reasoning).toEqual({ enabled: false });
    expect(second).not.toHaveProperty("reasoning");
    expect(events.some((e) => e.type === "text-delta" && e.text === "ok")).toBe(true);
  });

  it("does not retry a 400 that is about something else", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "messages: must not be empty" } }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })
    );
    const client = createOpenRouterClient({ fetch });

    await expect(
      collect(
        client.chat({
          apiKey: "k",
          model: "x",
          messages: [{ role: "user", content: "hi" }],
          reasoning: "low",
          reasoningPolicy: { mandatory: false },
        })
      )
    ).rejects.toThrow(/must not be empty/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("attaches cache_control to the last tool and last message for prompt caching", async () => {
    const fetch = vi.fn().mockResolvedValue(sseResponse(`data: [DONE]\n\n`));
    const client = createOpenRouterClient({ fetch });
    await collect(
      client.chat({
        apiKey: "k",
        model: "anthropic/claude-sonnet-4-6",
        tools: [
          {
            type: "function",
            function: {
              name: "read_range",
              description: "read",
              parameters: { type: "object", properties: {} },
            },
          },
          {
            type: "function",
            function: {
              name: "write_range",
              description: "write",
              parameters: { type: "object", properties: {} },
            },
          },
        ],
        messages: [
          { role: "user", content: "first" },
          { role: "assistant", content: "ack" },
          { role: "user", content: "follow-up" },
        ],
      })
    );

    const body = JSON.parse(fetch.mock.calls[0][1].body as string);
    // Last tool gets cache_control.
    expect(body.tools[0].cache_control).toBeUndefined();
    expect(body.tools[1].cache_control).toEqual({ type: "ephemeral" });
    // Last message (string content) gets widened to a content array with
    // cache_control on the text part.
    expect(body.messages[0].content).toBe("first"); // untouched
    expect(body.messages[2].content).toEqual([
      { type: "text", text: "follow-up", cache_control: { type: "ephemeral" } },
    ]);
  });

  it("Wave 10b: also attaches cache_control to the system message (3rd breakpoint)", async () => {
    const fetch = vi.fn().mockResolvedValue(sseResponse(`data: [DONE]\n\n`));
    const client = createOpenRouterClient({ fetch });
    await collect(
      client.chat({
        apiKey: "k",
        model: "anthropic/claude-sonnet-4-6",
        messages: [
          { role: "system", content: "You are Excelente." },
          { role: "user", content: "hi" },
        ],
      })
    );
    const body = JSON.parse(fetch.mock.calls[0][1].body as string);
    // System message widened to content-array with cache_control on the
    // text part — caches system independently of tools.
    expect(body.messages[0].content).toEqual([
      { type: "text", text: "You are Excelente.", cache_control: { type: "ephemeral" } },
    ]);
  });

  it("Wave 10b: no-op when there's no system message", async () => {
    const fetch = vi.fn().mockResolvedValue(sseResponse(`data: [DONE]\n\n`));
    const client = createOpenRouterClient({ fetch });
    await collect(
      client.chat({
        apiKey: "k",
        model: "anthropic/claude-sonnet-4-6",
        messages: [{ role: "user", content: "hi" }],
      })
    );
    const body = JSON.parse(fetch.mock.calls[0][1].body as string);
    // Only the last-message breakpoint fires; nothing wedged in a phantom
    // system slot.
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe("user");
  });

  it("preserves multi-part content and marks only the last part with cache_control", async () => {
    const fetch = vi.fn().mockResolvedValue(sseResponse(`data: [DONE]\n\n`));
    const client = createOpenRouterClient({ fetch });
    await collect(
      client.chat({
        apiKey: "k",
        model: "anthropic/claude-sonnet-4-6",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "describe this:" },
              { type: "image_url", image_url: { url: "data:image/png;base64,X" } },
            ],
          },
        ],
      })
    );
    const body = JSON.parse(fetch.mock.calls[0][1].body as string);
    expect(body.messages[0].content).toEqual([
      { type: "text", text: "describe this:" },
      {
        type: "image_url",
        image_url: { url: "data:image/png;base64,X" },
        cache_control: { type: "ephemeral" },
      },
    ]);
  });

  it("parses Anthropic-style cache_read_input_tokens + cache_creation_input_tokens", async () => {
    const body =
      sseChunk({ choices: [{ index: 0, delta: { content: "ok" } }] }) +
      sseChunk({
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: {
          prompt_tokens: 6000,
          completion_tokens: 30,
          total_tokens: 6030,
          cache_read_input_tokens: 4500,
          cache_creation_input_tokens: 0,
          cost: 0.0009,
        },
      }) +
      `data: [DONE]\n\n`;
    const fetch = vi.fn().mockResolvedValue(sseResponse(body));
    const client = createOpenRouterClient({ fetch });
    const events = await collect(
      client.chat({
        apiKey: "k",
        model: "anthropic/claude-sonnet-4-6",
        messages: [{ role: "user", content: "hi" }],
      })
    );
    const usage = events.find((e) => e.type === "usage");
    expect(usage).toMatchObject({
      type: "usage",
      usage: {
        promptTokens: 6000,
        cacheReadTokens: 4500,
        cacheCreationTokens: 0,
      },
    });
  });

  it("parses OpenAI-style prompt_tokens_details.cached_tokens", async () => {
    const body =
      sseChunk({ choices: [{ index: 0, delta: { content: "ok" } }] }) +
      sseChunk({
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: {
          prompt_tokens: 5000,
          completion_tokens: 20,
          total_tokens: 5020,
          prompt_tokens_details: { cached_tokens: 3200 },
          cost: 0.0007,
        },
      }) +
      `data: [DONE]\n\n`;
    const fetch = vi.fn().mockResolvedValue(sseResponse(body));
    const client = createOpenRouterClient({ fetch });
    const events = await collect(
      client.chat({
        apiKey: "k",
        model: "openai/gpt-5",
        messages: [{ role: "user", content: "hi" }],
      })
    );
    const usage = events.find((e) => e.type === "usage");
    expect(usage).toMatchObject({
      type: "usage",
      usage: { cacheReadTokens: 3200 },
    });
  });

  it("parses the relay's credits_remaining extension into usage", async () => {
    const body =
      sseChunk({ choices: [{ index: 0, delta: { content: "ok" } }] }) +
      sseChunk({
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 10,
          total_tokens: 110,
          cost: 0.0123,
          credits_remaining: 9876,
        },
      }) +
      `data: [DONE]\n\n`;
    const fetch = vi.fn().mockResolvedValue(sseResponse(body));
    const client = createOpenRouterClient({ fetch });
    const events = await collect(
      client.chat({
        apiKey: "k",
        model: "anthropic/claude-sonnet-4-6",
        messages: [{ role: "user", content: "hi" }],
      })
    );
    const usage = events.find((e) => e.type === "usage");
    expect(usage).toMatchObject({ type: "usage", usage: { creditsRemaining: 9876 } });
  });

  it("leaves creditsRemaining undefined on the direct (BYOK) path", async () => {
    const body =
      sseChunk({ choices: [{ index: 0, delta: { content: "ok" } }] }) +
      sseChunk({
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105, cost: 0.001 },
      }) +
      `data: [DONE]\n\n`;
    const fetch = vi.fn().mockResolvedValue(sseResponse(body));
    const client = createOpenRouterClient({ fetch });
    const events = await collect(
      client.chat({
        apiKey: "k",
        model: "anthropic/claude-sonnet-4-6",
        messages: [{ role: "user", content: "hi" }],
      })
    );
    const usage = events.find((e) => e.type === "usage");
    expect(
      (usage as { usage?: { creditsRemaining?: number } }).usage?.creditsRemaining
    ).toBeUndefined();
  });

  it("leaves cacheReadTokens undefined when the provider doesn't report it", async () => {
    const body =
      sseChunk({ choices: [{ index: 0, delta: { content: "ok" } }] }) +
      sseChunk({
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 },
      }) +
      `data: [DONE]\n\n`;
    const fetch = vi.fn().mockResolvedValue(sseResponse(body));
    const client = createOpenRouterClient({ fetch });
    const events = await collect(
      client.chat({
        apiKey: "k",
        model: "qwen/qwen-3-7-max",
        messages: [{ role: "user", content: "hi" }],
      })
    );
    const usage = events.find((e) => e.type === "usage");
    expect(
      (usage as { usage?: { cacheReadTokens?: number } }).usage?.cacheReadTokens
    ).toBeUndefined();
  });

  it("sends Authorization header, Excelente branding headers, and stream:true", async () => {
    const fetch = vi.fn().mockResolvedValue(sseResponse(`data: [DONE]\n\n`));
    const client = createOpenRouterClient({ fetch });
    await collect(
      client.chat({
        apiKey: "sk-or-abc",
        model: "x",
        messages: [{ role: "user", content: "hi" }],
      })
    );

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer sk-or-abc");
    expect(init.headers["X-Title"]).toBe("Excelente");
    const body = JSON.parse(init.body as string);
    expect(body.stream).toBe(true);
    expect(body.usage).toEqual({ include: true });
    expect(body.reasoning).toBeUndefined();
  });
});

describe("createOpenRouterClient.listModels", () => {
  const apiResponse = {
    data: [
      {
        id: "anthropic/claude-opus-4-7",
        name: "Anthropic: Claude Opus 4.7",
        description: "Most capable",
        context_length: 1000000,
        created: 1750000000,
        pricing: { prompt: "0.000015", completion: "0.000075" },
        supported_parameters: ["tools", "reasoning", "temperature"],
        architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
      },
      {
        id: "qwen/qwen-3-7-max",
        name: "Qwen 3.7 Max",
        context_length: 262000,
        created: 1745000000,
        pricing: { prompt: "0.0000012", completion: "0.0000048" },
        supported_parameters: ["tools", "temperature"],
        architecture: { input_modalities: ["text"], output_modalities: ["text"] },
      },
      {
        id: "meta/muse-spark-1.3",
        context_length: 200000,
        created: 1748000000,
        pricing: { prompt: "0", completion: "0" },
        supported_parameters: ["tools"],
        architecture: { input_modalities: ["text"] },
      },
    ],
  };

  it("filters to allowed families and sorts newest-first", async () => {
    const fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify(apiResponse), {
          headers: { "Content-Type": "application/json" },
        })
      )
    );
    const client = createOpenRouterClient({ fetch });
    const models = await client.listModels("k");

    expect(models).toHaveLength(3);
    // Newest first: Claude > Meta Llama > Qwen.
    expect(models[0]).toMatchObject({
      id: "anthropic/claude-opus-4-7",
      name: "Anthropic: Claude Opus 4.7",
      contextLength: 1000000,
      supportsTools: true,
      supportsReasoning: true,
      supportsVision: true,
      family: "claude",
      created: 1750000000,
    });
    expect(models[1]).toMatchObject({
      id: "meta/muse-spark-1.3",
      family: "meta",
      created: 1748000000,
    });
    expect(models[0].pricing.prompt).toBeCloseTo(0.000015);
    expect(models[2]).toMatchObject({
      id: "qwen/qwen-3-7-max",
      name: "Qwen 3.7 Max",
      supportsTools: true,
      supportsReasoning: false,
      supportsVision: false,
      family: "qwen",
      created: 1745000000,
    });
  });

  it("caches /models for an hour", async () => {
    const fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify(apiResponse), {
          headers: { "Content-Type": "application/json" },
        })
      )
    );
    const client = createOpenRouterClient({ fetch });

    await client.listModels("k");
    await client.listModels("k");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("re-fetches when force: true", async () => {
    const fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify(apiResponse), {
          headers: { "Content-Type": "application/json" },
        })
      )
    );
    const client = createOpenRouterClient({ fetch });

    await client.listModels("k");
    await client.listModels("k", { force: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("throws OpenRouterError on non-2xx", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    const client = createOpenRouterClient({ fetch });
    await expect(client.listModels("k")).rejects.toBeInstanceOf(OpenRouterError);
  });
});

describe("parallel tool calls from providers that omit `index`", () => {
  it("keys calls by array position so neither call is lost", async () => {
    // Some OpenRouter-proxied providers send several complete tool calls in
    // one delta with no `index` field. Defaulting to 0 collapsed them onto
    // a single call: the second call's id/name were dropped and the two
    // argument payloads concatenated into unparseable JSON.
    const body =
      sseChunk({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  id: "call_a",
                  function: { name: "inspect_workbook", arguments: '{"scope":"workbook"}' },
                },
                {
                  id: "call_b",
                  function: { name: "read_workbook_memory", arguments: "{}" },
                },
              ],
            },
          },
        ],
      }) +
      sseChunk({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }) +
      `data: [DONE]\n\n`;

    const fetchImpl = vi.fn().mockResolvedValue(sseResponse(body));
    const client = createOpenRouterClient({ fetch: fetchImpl });
    const events = await collect(
      client.chat({ apiKey: "k", model: "m", messages: [{ role: "user", content: "hi" }] })
    );

    const starts = events.filter((e) => e.type === "tool-call-start");
    expect(starts).toEqual([
      { type: "tool-call-start", index: 0, id: "call_a", name: "inspect_workbook" },
      { type: "tool-call-start", index: 1, id: "call_b", name: "read_workbook_memory" },
    ]);

    // Each call's arguments stay on their own index and remain parseable.
    const argsByIndex = new Map<number, string>();
    for (const e of events) {
      if (e.type === "tool-call-delta") {
        argsByIndex.set(e.index, (argsByIndex.get(e.index) ?? "") + e.argumentsDelta);
      }
    }
    expect(JSON.parse(argsByIndex.get(0) as string)).toEqual({ scope: "workbook" });
    expect(JSON.parse(argsByIndex.get(1) as string)).toEqual({});
  });

  it("still honors an explicit index when the provider sends one", async () => {
    const body =
      sseChunk({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ index: 3, id: "call_x", function: { name: "undo", arguments: "{}" } }],
            },
          },
        ],
      }) +
      sseChunk({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }) +
      `data: [DONE]\n\n`;

    const fetchImpl = vi.fn().mockResolvedValue(sseResponse(body));
    const client = createOpenRouterClient({ fetch: fetchImpl });
    const events = await collect(
      client.chat({ apiKey: "k", model: "m", messages: [{ role: "user", content: "hi" }] })
    );
    const start = events.find((e) => e.type === "tool-call-start");
    expect(start).toMatchObject({ index: 3, id: "call_x" });
  });
});
