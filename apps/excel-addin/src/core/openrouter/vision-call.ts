import type { ChatMessage, ContentPart, OpenRouterClient } from "./index";
import { downscaleImageDataUrl } from "./image-downscale";

/**
 * One-shot vision call: send an image plus a prompt to a vision-capable
 * model, get a single text reply back. Used by Excel tools that produce
 * images (the `screenshot` tool) so the primary
 * agent's conversation history stays text-only.
 *
 * Keeping vision off the primary stream has two benefits:
 *   1. The primary can be a non-vision model (Qwen Max, etc.) without the
 *      tool result blowing up the next API call.
 *   2. Prompt caching on the primary stream remains effective — image
 *      content blocks would shift the cache key.
 *
 * The vision model receives a base prompt that contextualizes the screenshot
 * (sheet, range, dimensions) plus an optional caller-supplied question to
 * focus the analysis. Output is plain text the primary can act on.
 */
export interface VisionCallArgs {
  /** The vision-capable model id (e.g. "anthropic/claude-sonnet-5"). */
  modelId: string;
  /** OpenRouter API key. */
  apiKey: string;
  /** Image data URL (base64 PNG/JPEG) to send. */
  imageDataUrl: string;
  /**
   * Human-readable context for the image — what sheet/range was captured,
   * dimensions, etc. Prepended to the user prompt so the vision model
   * understands what it's looking at.
   */
  context: string;
  /**
   * Optional caller question. Defaults to a general "describe what you see"
   * prompt when omitted.
   */
  question?: string;
  /** Abort signal threaded through from the parent run. */
  signal?: AbortSignal;
}

const DEFAULT_QUESTION =
  "Describe what you see in this range, focusing on values, formatting issues, formula errors visible in cells, and anything that looks wrong. Cite specific cells by address. Output as terse bullet points; no preamble.";

const SYSTEM_PROMPT =
  "You are a vision assistant supporting a financial-modeling agent in Excel. " +
  "Reply concisely as structured text the requesting agent can act on. Cite " +
  "cells by their A1 address when referencing specifics. Do not editorialize.";

/**
 * Execute a one-shot vision call. Streams the model's response and returns
 * the concatenated text. Errors (network, model refuses, no body) propagate
 * to the caller as thrown errors — the screenshot tool then surfaces them
 * as a structured tool result the primary can adapt to.
 */
export async function callVisionModel(
  client: OpenRouterClient,
  args: VisionCallArgs
): Promise<string> {
  // Downscale the image before shipping — most providers bill vision per
  // pixel-block, and full-screen Excel captures are often 1920+ on the
  // long edge. Downscaling to 1280px max edge typically halves vision
  // token cost while keeping cell values and labels legible. In Node /
  // test contexts the helper is a no-op.
  const downscaled = await downscaleImageDataUrl(args.imageDataUrl);

  const userContent: ContentPart[] = [
    { type: "text", text: `${args.context}\n\n${args.question ?? DEFAULT_QUESTION}` },
    { type: "image_url", image_url: { url: downscaled } },
  ];

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];

  let out = "";
  for await (const ev of client.chat({
    apiKey: args.apiKey,
    model: args.modelId,
    messages,
    signal: args.signal,
  })) {
    if (ev.type === "text-delta") out += ev.text;
  }
  return out.trim();
}
