import type { ReasoningLevel } from "../storage";

export type { ReasoningLevel };

/* --------------------------------- Messages -------------------------------- */

export type Role = "system" | "user" | "assistant" | "tool";

export interface TextPart {
  type: "text";
  text: string;
}

export interface ImagePart {
  type: "image_url";
  image_url: { url: string; detail?: "auto" | "low" | "high" };
}

export type ContentPart = TextPart | ImagePart;

export interface ChatMessage {
  role: Role;
  content: string | ContentPart[];
  /** Assistant turns that emitted tool calls. */
  tool_calls?: ToolCall[];
  /** Tool result turns reference the call they're answering. */
  tool_call_id?: string;
  /** Optional human-readable label for a `tool` role message. */
  name?: string;
}

/* ---------------------------------- Tools ---------------------------------- */

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    /** JSON Schema object. */
    parameters: Record<string, unknown>;
  };
}

/* ---------------------------------- Models --------------------------------- */

export interface ModelInfo {
  id: string;
  name: string;
  description?: string;
  /**
   * Set on a row the edition injects rather than one OpenRouter listed: a
   * model the distribution hosts itself, with its own client and a
   * server-side pin. `name` is final (no lab prefix to strip, no price or
   * rank to append), `lab` is the host, and the row sits in its own picker
   * group before every lab. Never sent to OpenRouter.
   */
  hosted?: { lab: string; groupKey: string; groupLabel: string };
  contextLength: number;
  pricing: {
    /** USD per 1 prompt token. */
    prompt: number;
    /** USD per 1 completion token. */
    completion: number;
  };
  supportsTools: boolean;
  supportsReasoning: boolean;
  /**
   * The model's own reasoning policy, from `/models`.`reasoning`. Absent
   * when upstream says nothing.
   *
   * Load-bearing, not decorative. Omitting the `reasoning` request param
   * means "use the model's default", and 120 of 436 listed models reason by
   * DEFAULT — so "off" implemented as "send nothing" left users paying for
   * reasoning tokens they had switched off. Meanwhile 101 models make
   * reasoning mandatory and answer an explicit disable with HTTP 400
   * ("Reasoning is mandatory for this endpoint and cannot be disabled"),
   * z-ai/glm-5.3-flash among them — so a blanket disable is not an option
   * either. Both facts are only knowable from here.
   */
  reasoningPolicy?: {
    /** Reasoning cannot be turned off; an explicit disable is a 400. */
    mandatory: boolean;
    /** The model reasons when the request says nothing about it. */
    defaultEnabled?: boolean;
    /** Effort values this model accepts, when upstream enumerates them. */
    supportedEfforts?: string[];
    /** Effort used when reasoning is on but no effort is given. */
    defaultEffort?: string;
  };
  /** Model accepts image inputs (multi-part `image_url` content parts). */
  supportsVision: boolean;
  /**
   * Unix timestamp (seconds) the model was registered with OpenRouter.
   * Used for sorting newest-first. 0 when the upstream field is missing.
   */
  created: number;
  /**
   * Model family slug, derived from the id prefix: "claude" | "gpt" |
   * "gemini" | "meta" | "qwen" | "deepseek" | "grok" | "kimi" | "glm". Used to filter
   * the model picker to the families Excelente targets. `null` for any model
   * that doesn't match one of those families (filtered out by default).
   */
  family: ModelFamily | null;
  /**
   * Independent capability score — the Artificial Analysis Intelligence
   * Index for the model's strongest published configuration. Merged in by
   * `core/catalog` from the nightly catalog, never from OpenRouter; absent
   * when the model is unranked or the catalog did not load. Higher is more
   * capable. This is what orders each lab's models in the picker.
   */
  capability?: number;
  /**
   * The same score per reasoning effort when the benchmark publishes
   * variants — keys `max / xhigh / high / medium / low / minimal`, `none` for
   * the non-reasoning run, `default` for an unqualified row. Lets the UI show
   * the score at the user's own reasoning setting.
   */
  capabilityByEffort?: Record<string, number>;
  /**
   * The lab's release date as unix seconds, when the catalog knows it.
   * Preferred over `created` (OpenRouter's registration date) for the
   * picker's twelve-month Latest window.
   */
  releasedAt?: number;
  /** Median output speed in tokens per second, when measured. */
  outputTokensPerSecond?: number;
}

/** Model families Excelente supports. Anything else is filtered out. */
export type ModelFamily =
  | "claude"
  | "gpt"
  | "gemini"
  | "qwen"
  | "deepseek"
  | "grok"
  | "kimi"
  | "glm"
  | "meta";

/* --------------------------------- Requests -------------------------------- */

export interface ChatRequest {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  reasoning?: ReasoningLevel;
  /**
   * `model`'s reasoning policy from the catalogue. Without it, `reasoning:
   * "off"` can only omit the parameter — which leaves reasoning ON for the
   * 120 models that reason by default. See `reasoningParamFor`.
   */
  reasoningPolicy?: ModelInfo["reasoningPolicy"];
  temperature?: number;
  signal?: AbortSignal;
}

/* ---------------------------------- Events --------------------------------- */

export type ChatEvent =
  | { type: "text-delta"; text: string }
  | { type: "reasoning-delta"; text: string }
  | { type: "tool-call-start"; index: number; id: string; name: string }
  | { type: "tool-call-delta"; index: number; argumentsDelta: string }
  | { type: "usage"; usage: Usage }
  | { type: "done"; finishReason: FinishReason };

export type FinishReason =
  | "stop"
  | "length"
  | "tool_calls"
  | "content_filter"
  | "error"
  | (string & Record<never, never>);

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** USD; OpenRouter includes this in its usage extension. */
  cost?: number;
  /**
   * Prompt tokens read from a cache (Anthropic prompt caching, OpenAI
   * automatic input caching). Each cached token is billed at ~10% of the
   * full input rate, so a high cache-read share is the headline metric for
   * Wave 8b prompt caching. Undefined when the provider didn't report a
   * value (e.g. models without caching support).
   */
  cacheReadTokens?: number;
  /**
   * Prompt tokens written to cache on this turn (Anthropic). Billed at a
   * surcharge over the full input rate — the one-time cost paid to make
   * subsequent turns cheap.
   */
  cacheCreationTokens?: number;
  /**
   * Authoritative member credit balance AFTER this call, echoed by the A.CRE
   * relay (1 credit = 1¢ of underlying cost). Absent on the direct OpenRouter
   * (BYOK) path. The UI trusts this as the live balance — no polling required.
   */
  creditsRemaining?: number;
}
