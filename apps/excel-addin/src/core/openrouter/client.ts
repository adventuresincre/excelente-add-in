import type { ChatEvent, ChatRequest, FinishReason, ModelInfo, Usage } from "./types";
import { parseSseLines } from "./sse";
import { reasoningParamFor } from "./reasoning";
import { familyOf, isFreeTierModel, isSupportedFreeVendor } from "./model-families";
import { describeOpenRouterError } from "./error-message";
import { parseKimiToolCalls } from "./tool-call-formats";

const OPENROUTER_API = "https://openrouter.ai/api/v1";
const REFERER = "https://excelente.aiedge.ac";
const TITLE = "Excelente";
const MODEL_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export class OpenRouterError extends Error {
  /**
   * Set by proxies that know whether their refusal is final (a monthly cap)
   * or transient (a rate limit). Undefined means "classify by status", the
   * behaviour for OpenRouter's own responses.
   */
  readonly retryable: boolean | undefined;

  constructor(
    public readonly status: number,
    public readonly responseBody: string,
    opts: { message?: string; retryable?: boolean } = {}
  ) {
    // Default message comes from the envelope parser, which keeps the
    // provider's own text and the fix URL instead of truncating both away
    // at 200 characters. Callers with better context still override it.
    super(opts.message ?? describeOpenRouterError(status, responseBody));
    this.name = "OpenRouterError";
    this.retryable = opts.retryable;
  }
}

export interface OpenRouterClient {
  chat(req: ChatRequest): AsyncIterable<ChatEvent>;
  listModels(apiKey: string, opts?: { force?: boolean }): Promise<ModelInfo[]>;
}

export interface ClientOptions {
  /** Override fetch (tests). Defaults to globalThis.fetch. */
  fetch?: typeof fetch;
  /**
   * API base URL. Defaults to OpenRouter. The A.CRE member relay points this
   * at its own OpenRouter-compatible endpoint so member calls are metered
   * server-side while reusing this exact wire logic.
   */
  baseUrl?: string;
  /**
   * Builds the auth headers from the per-request credential (`req.apiKey` /
   * the `apiKey` arg to listModels). Defaults to OpenRouter's
   * Bearer + branding headers. The relay reinterprets the opaque bearer as a
   * session token and omits the OpenRouter-specific `HTTP-Referer`.
   */
  buildAuthHeaders?: (credential: string) => Record<string, string>;
}

export function createOpenRouterClient(opts: ClientOptions = {}): OpenRouterClient {
  const fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const baseUrl = opts.baseUrl ?? OPENROUTER_API;
  const buildAuthHeaders = opts.buildAuthHeaders ?? authHeaders;
  let modelsCache: { data: ModelInfo[]; expiresAt: number } | null = null;

  return {
    chat(req) {
      return chatStream(fetchImpl, baseUrl, buildAuthHeaders, req);
    },

    async listModels(apiKey, listOpts = {}) {
      const force = listOpts.force ?? false;
      const now = Date.now();
      if (!force && modelsCache && modelsCache.expiresAt > now) {
        return modelsCache.data;
      }

      const response = await fetchImpl(`${baseUrl}/models`, {
        headers: buildAuthHeaders(apiKey),
      });
      if (!response.ok) {
        throw new OpenRouterError(response.status, await safeText(response));
      }
      const json = (await response.json()) as { data?: unknown };
      const raw = Array.isArray(json.data) ? json.data : [];
      const data = raw
        .map(toModelInfo)
        .filter((m): m is ModelInfo => m !== null)
        // Excelente only surfaces models from nine targeted families
        // (Claude, GPT, Gemini, Qwen, DeepSeek, Grok, Kimi, GLM).
        // Everything else is filtered out so the picker only shows
        // models we can guarantee work end-to-end.
        //
        // FREE models are the exception, and they have to be: none of the
        // free models OpenRouter lists are in those families, so the
        // allowlist alone left the picker with no free option at all. They
        // pass a narrower vendor gate instead — see
        // `isSupportedFreeVendor`.
        .filter((m) => m.family !== null || (isFreeTierModel(m) && isSupportedFreeVendor(m.id)))
        // Newest first — sort by OpenRouter's `created` timestamp.
        .sort((a, b) => b.created - a.created);
      modelsCache = { data, expiresAt: now + MODEL_CACHE_TTL_MS };
      return data;
    },
  };
}

/**
 * Status for a mid-stream error chunk. Uses the code the provider sent when
 * it looks like an HTTP status; otherwise 503, because an error arriving
 * mid-stream with no code is a provider fault, and provider faults are
 * retryable. Capacity errors ("ResourceExhausted", "limit reached") map to
 * 429 so they pick up the rate-limit backoff.
 */
function streamErrorStatus(err: { code?: number | string; message?: string } | string): number {
  if (typeof err === "string") return 503;
  const code = typeof err.code === "number" ? err.code : Number(err.code);
  if (Number.isFinite(code) && code >= 400 && code <= 599) return code;
  const text = (err.message ?? "").toLowerCase();
  if (text.includes("resourceexhausted") || text.includes("limit reached")) return 429;
  return 503;
}

/**
 * Does a 400 body blame the `reasoning` parameter? Provider wording varies
 * ("Reasoning is mandatory for this endpoint and cannot be disabled",
 * "Invalid reasoning effort", "thinking budget …"), so match the concept
 * rather than any one message.
 */
function isReasoningRejection(responseBody: string): boolean {
  return /reasoning|effort|thinking/i.test(responseBody);
}

async function* chatStream(
  fetchImpl: typeof fetch,
  baseUrl: string,
  buildAuthHeaders: (credential: string) => Record<string, string>,
  req: ChatRequest
): AsyncIterable<ChatEvent> {
  // Prompt caching: attach `cache_control: { type: "ephemeral" }` markers
  // at THREE breakpoints to let Anthropic / Qwen / Gemini cache the
  // request prefix maximally (their explicit-cache APIs); OpenAI / Kimi
  // / DeepSeek / Grok ignore the markers but auto-cache via implicit
  // prefix matching, which works the same way for the user — we still
  // record the cache hits via `cacheReadTokens` in usage.
  //
  //   1. System message  → caches just the system prompt. Stable for the
  //      entire session. Works even when tools is empty (e.g. summary
  //      meta-call).
  //   2. Last tool def   → caches system + tools. Tools rarely change so
  //      this is the biggest single win.
  //   3. Last message    → caches the full conversation prefix, which
  //      grows turn-over-turn. Each turn pays a small write surcharge on
  //      the new tail; subsequent turns read the prefix at ~10% of full
  //      input cost.
  //
  // Anthropic allows up to 4 cache_control breakpoints per request; we
  // use 3 and leave headroom for a future static-context breakpoint
  // (e.g., a long skill body loaded inline).
  const body: Record<string, unknown> = {
    model: req.model,
    messages: addCacheBreakpointToLastMessage(addCacheBreakpointToSystemMessage(req.messages)),
    stream: true,
    usage: { include: true },
  };
  if (req.tools && req.tools.length > 0) {
    body.tools = addCacheBreakpointToLastTool(req.tools);
  }
  if (req.temperature !== undefined) body.temperature = req.temperature;
  // Note the absence of a truthiness guard on `req.reasoning`: "off" is a
  // real instruction that has to reach the wire as `enabled: false`, and the
  // old `if (req.reasoning)` swallowed it because "off" is not falsy but the
  // mapper returned undefined for it. Both halves are now explicit.
  if (req.reasoning) {
    const reasoning = reasoningParamFor(req.reasoning, req.reasoningPolicy);
    if (reasoning) body.reasoning = reasoning;
  }

  const post = (payload: Record<string, unknown>) =>
    fetchImpl(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildAuthHeaders(req.apiKey),
      },
      body: JSON.stringify(payload),
      signal: req.signal,
    });

  let response = await post(body);

  if (response.status === 400 && body.reasoning !== undefined) {
    // A 400 that blames the reasoning parameter is a fact about the MODEL —
    // it makes reasoning mandatory, or it rejects an effort name we sent
    // because its policy was unknown or changed under the hour-old
    // catalogue cache — not a fault in the user's request. A reasoning
    // preference must never cost a turn, so retry exactly once with the
    // parameter omitted, which yields the model's own default. A 400 about
    // anything else, and any failure of the retry itself, surface normally.
    const text = await safeText(response);
    if (!isReasoningRejection(text)) throw new OpenRouterError(400, text);
    const withoutReasoning = { ...body };
    delete withoutReasoning.reasoning;
    response = await post(withoutReasoning);
  }

  if (!response.ok) {
    throw new OpenRouterError(response.status, await safeText(response));
  }
  if (!response.body) {
    throw new Error("OpenRouter response had no body");
  }

  yield* translateStream(parseSseLines(response.body));
}

/**
 * Translate OpenRouter SSE JSON lines into ChatEvents. Exported so other
 * OpenRouter-compatible streaming endpoints (e.g. the A.CRE concierge) can
 * reuse the exact same chunk handling.
 */
export async function* translateStream(jsonLines: AsyncIterable<string>): AsyncIterable<ChatEvent> {
  const seenToolStarts = new Set<number>();
  // Accumulate assistant text so we can recover Kimi-format tool calls at
  // stream end when no structured tool_calls were emitted. Bounded by the
  // model's output budget — typically a few KB.
  let accumulatedContent = "";

  for await (const raw of jsonLines) {
    let chunk: ChatChunk;
    try {
      chunk = JSON.parse(raw) as ChatChunk;
    } catch {
      // skip malformed chunks; OpenRouter sometimes emits keep-alive comments
      continue;
    }

    if (chunk.error) {
      // An OpenRouterError, not a bare Error. A mid-stream provider failure
      // ("ResourceExhausted: Worker local total request limit reached
      // (16/16)") is as transient as the same failure before the stream
      // opens, but `isRetryableStreamError` only ever inspected
      // OpenRouterError and TypeError — so a bare Error was unretryable by
      // construction and ended a whole autonomous run. Carrying the status
      // also routes it through the envelope parser for a readable message.
      const status = streamErrorStatus(chunk.error);
      throw new OpenRouterError(status, JSON.stringify({ error: chunk.error }));
    }

    const choice = chunk.choices?.[0];
    if (choice) {
      const delta = choice.delta ?? {};

      if (typeof delta.content === "string" && delta.content.length > 0) {
        accumulatedContent += delta.content;
        yield { type: "text-delta", text: delta.content };
      }
      if (typeof delta.reasoning === "string" && delta.reasoning.length > 0) {
        yield { type: "reasoning-delta", text: delta.reasoning };
      }
      if (delta.tool_calls) {
        for (let position = 0; position < delta.tool_calls.length; position++) {
          const tc = delta.tool_calls[position];
          // Fall back to the call's POSITION in this delta, not 0. Providers
          // that omit `index` on parallel calls would otherwise collapse
          // every call in the array onto index 0: the first call's
          // tool-call-start wins, the rest are dropped, and all their
          // argument fragments concatenate into one unparseable blob
          // (`{"a":1}{"b":2}`). The orchestrator then reports a single
          // "Invalid JSON arguments" error and BOTH intended calls are lost.
          const index = tc.index ?? position;
          if (!seenToolStarts.has(index)) {
            seenToolStarts.add(index);
            yield {
              type: "tool-call-start",
              index,
              id: tc.id ?? "",
              name: tc.function?.name ?? "",
            };
          }
          const args = tc.function?.arguments;
          if (typeof args === "string" && args.length > 0) {
            yield { type: "tool-call-delta", index, argumentsDelta: args };
          } else if (args !== null && typeof args === "object") {
            // Non-conformant providers send the parsed arguments OBJECT in
            // one delta instead of JSON string fragments. Dropping it (the
            // old behavior) produced tool calls with empty arguments that
            // the model could never fix from its side — serialize it once.
            yield {
              type: "tool-call-delta",
              index,
              argumentsDelta: JSON.stringify(args),
            };
          }
        }
      }

      if (choice.finish_reason) {
        // Kimi recovery: if the model finished with tool_calls but no
        // structured calls came through deltas, scan accumulated content
        // for Kimi-format tokens and synthesize the missing events.
        if (
          choice.finish_reason === "tool_calls" &&
          seenToolStarts.size === 0 &&
          accumulatedContent.includes("<|tool_call_begin|>")
        ) {
          const recovered = parseKimiToolCalls(accumulatedContent);
          for (let i = 0; i < recovered.length; i++) {
            const call = recovered[i];
            yield {
              type: "tool-call-start",
              index: i,
              id: call.id,
              name: call.name,
            };
            if (call.arguments.length > 0) {
              yield {
                type: "tool-call-delta",
                index: i,
                argumentsDelta: call.arguments,
              };
            }
            seenToolStarts.add(i);
          }
        }
        yield { type: "done", finishReason: choice.finish_reason as FinishReason };
      }
    }

    if (chunk.usage) {
      yield { type: "usage", usage: normalizeUsage(chunk.usage) };
    }
  }
}

function normalizeUsage(u: RawUsage): Usage {
  // Cached-token accounting comes in two shapes:
  //   - Anthropic style: top-level `cache_read_input_tokens` and
  //     `cache_creation_input_tokens` (returned via OpenRouter passthrough).
  //   - OpenAI style:    nested `prompt_tokens_details.cached_tokens`.
  // Coalesce both into a single `cacheReadTokens` value the UI can show.
  const cacheRead = u.cache_read_input_tokens ?? u.prompt_tokens_details?.cached_tokens;
  const cacheWrite = u.cache_creation_input_tokens;
  return {
    promptTokens: u.prompt_tokens ?? 0,
    completionTokens: u.completion_tokens ?? 0,
    totalTokens: u.total_tokens ?? 0,
    cost: typeof u.cost === "number" ? u.cost : undefined,
    cacheReadTokens: typeof cacheRead === "number" ? cacheRead : undefined,
    cacheCreationTokens: typeof cacheWrite === "number" ? cacheWrite : undefined,
    creditsRemaining: typeof u.credits_remaining === "number" ? u.credits_remaining : undefined,
  };
}

/**
 * Returns a copy of the tools array with `cache_control: { type: "ephemeral" }`
 * attached to the last entry. Anthropic interprets that marker as "cache the
 * prefix ending here" — i.e. system prompt + every tool definition before this
 * one are cached as a single block. Non-Anthropic providers ignore the field.
 */
function addCacheBreakpointToLastTool(
  tools: NonNullable<ChatRequest["tools"]>
): NonNullable<ChatRequest["tools"]> {
  if (tools.length === 0) return tools;
  const last = tools[tools.length - 1];
  return [
    ...tools.slice(0, -1),
    { ...last, cache_control: { type: "ephemeral" } } as (typeof tools)[number] & {
      cache_control: { type: "ephemeral" };
    },
  ];
}

/**
 * Attach `cache_control` to the last content part of the last message so the
 * full conversation-through-that-point becomes a cacheable prefix on the next
 * turn. Messages with string content are widened into a one-part array so the
 * marker has somewhere to attach.
 *
 * NOTE: marker attached to the LAST message — i.e. typically the most recent
 * tool_result or user message — because that's where the conversation prefix
 * for the NEXT turn ends. Each turn pays a small write surcharge on the new
 * tail; subsequent turns read the entire prefix at ~10% of full cost.
 */
function addCacheBreakpointToLastMessage(
  messages: ChatRequest["messages"]
): ChatRequest["messages"] {
  if (messages.length === 0) return messages;
  const last = messages[messages.length - 1];
  const updated: typeof last = { ...last };
  const marker = { cache_control: { type: "ephemeral" } } as const;

  if (typeof last.content === "string") {
    // Widen to multi-part so we have somewhere to attach the marker.
    updated.content = [
      {
        type: "text",
        text: last.content,
        ...marker,
      } as ChatRequest["messages"][number]["content"] extends infer C
        ? C extends Array<infer P>
          ? P & { cache_control: { type: "ephemeral" } }
          : never
        : never,
    ];
  } else if (Array.isArray(last.content) && last.content.length > 0) {
    const parts = [...last.content];
    const lastPart = parts[parts.length - 1];
    parts[parts.length - 1] = { ...lastPart, ...marker } as typeof lastPart;
    updated.content = parts;
  }
  return [...messages.slice(0, -1), updated];
}

/**
 * Attach `cache_control` to the first system message in the array. This
 * gives Anthropic / Qwen / Gemini a third cache breakpoint dedicated to
 * the (stable, session-long) system prompt — covering the case where
 * tools is empty (e.g. the conversation-summary meta-call has no tools)
 * so we'd otherwise miss caching the system prompt entirely.
 *
 * Idempotent: if there's no system message, the array is returned
 * untouched. String-content system messages get widened to a one-part
 * array so cache_control has somewhere to attach (same pattern as
 * addCacheBreakpointToLastMessage).
 */
function addCacheBreakpointToSystemMessage(
  messages: ChatRequest["messages"]
): ChatRequest["messages"] {
  const sysIdx = messages.findIndex((m) => m.role === "system");
  if (sysIdx === -1) return messages;
  const sys = messages[sysIdx];
  const marker = { cache_control: { type: "ephemeral" } } as const;

  const updated: typeof sys = { ...sys };
  if (typeof sys.content === "string") {
    updated.content = [
      {
        type: "text",
        text: sys.content,
        ...marker,
      } as ChatRequest["messages"][number]["content"] extends infer C
        ? C extends Array<infer P>
          ? P & { cache_control: { type: "ephemeral" } }
          : never
        : never,
    ];
  } else if (Array.isArray(sys.content) && sys.content.length > 0) {
    const parts = [...sys.content];
    const lastPart = parts[parts.length - 1];
    parts[parts.length - 1] = { ...lastPart, ...marker } as typeof lastPart;
    updated.content = parts;
  } else {
    return messages;
  }

  return [...messages.slice(0, sysIdx), updated, ...messages.slice(sysIdx + 1)];
}

function toModelInfo(raw: unknown): ModelInfo | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id : null;
  if (!id) return null;

  const pricing = isObject(r.pricing) ? r.pricing : {};
  const supported = Array.isArray(r.supported_parameters) ? r.supported_parameters : [];
  const architecture = isObject(r.architecture) ? r.architecture : {};
  const inputModalities = Array.isArray(architecture.input_modalities)
    ? architecture.input_modalities
    : [];

  return {
    id,
    name: typeof r.name === "string" ? r.name : id,
    description: typeof r.description === "string" ? r.description : undefined,
    contextLength: toNumber(r.context_length, 0),
    pricing: {
      prompt: toNumber(pricing.prompt, 0),
      completion: toNumber(pricing.completion, 0),
    },
    supportsTools: supported.includes("tools"),
    supportsReasoning: supported.includes("reasoning"),
    supportsVision: inputModalities.includes("image"),
    reasoningPolicy: toReasoningPolicy(r.reasoning),
    created: toNumber(r.created, 0),
    family: familyOf(id),
  };
}

/**
 * Reads `/models`.`reasoning`. Returns undefined when the field is absent so
 * callers can distinguish "no policy published" from "not mandatory" — the
 * safe default for an unknown model is to leave reasoning alone rather than
 * to send a disable that might 400.
 */
function toReasoningPolicy(raw: unknown): ModelInfo["reasoningPolicy"] {
  if (!isObject(raw)) return undefined;
  const efforts = Array.isArray(raw.supported_efforts)
    ? raw.supported_efforts.filter((e): e is string => typeof e === "string")
    : undefined;
  return {
    mandatory: raw.mandatory === true,
    defaultEnabled: typeof raw.default_enabled === "boolean" ? raw.default_enabled : undefined,
    supportedEfforts: efforts && efforts.length > 0 ? efforts : undefined,
    defaultEffort: typeof raw.default_effort === "string" ? raw.default_effort : undefined,
  };
}

function authHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "HTTP-Referer": REFERER,
    "X-Title": TITLE,
  };
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function toNumber(v: unknown, fallback: number): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/* ------------------------------ Wire shapes ------------------------------- */

interface RawUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
  /** Anthropic prompt-caching shape. */
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  /** OpenAI implicit-caching shape. */
  prompt_tokens_details?: {
    cached_tokens?: number;
  };
  /** A.CRE relay extension: member balance after this call. */
  credits_remaining?: number;
}

interface ChatChunk {
  choices?: ChatChunkChoice[];
  usage?: RawUsage;
  error?: { message?: string; code?: number | string; metadata?: unknown } | string;
}

interface ChatChunkChoice {
  index?: number;
  delta?: {
    role?: string;
    content?: string;
    reasoning?: string;
    tool_calls?: ChatChunkToolCall[];
  };
  finish_reason?: string | null;
}

interface ChatChunkToolCall {
  index?: number;
  id?: string;
  type?: string;
  /**
   * OpenAI spec: `arguments` streams as JSON string fragments. Some
   * providers behind OpenRouter emit an already-parsed object in a single
   * delta instead — translateStream serializes that case.
   */
  function?: { name?: string; arguments?: string | Record<string, unknown> };
}
