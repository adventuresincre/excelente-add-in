import type { ModelFamily, ModelInfo } from "./types";

/**
 * Maps OpenRouter model id prefixes to the families Excelente targets.
 *
 * Excelente intentionally narrows the model picker to nine families that
 * matter in 2026: Claude, GPT, Gemini, Qwen, DeepSeek, Grok, Kimi, and GLM
 * (Z.AI — added 2026-07-02 for GLM 5.x's cost/capability ratio), and Meta
 * Muse and Llama. Other open-weight models (Hermes, Mistral, Phi, Cohere, etc.) are out of
 * scope — they either don't compete on capability/cost for our use case or
 * use non-standard wire formats we don't support. OpenRouter exposes ~300
 * models; this allowlist cuts noise dramatically and lets us guarantee that
 * every listed model actually works end-to-end with the harness.
 *
 * The match is "id starts with one of these strings". OpenRouter normalizes
 * provider routing so a single prefix is enough — `qwen/` covers Qwen
 * regardless of which underlying provider serves the request.
 */
const FAMILY_PREFIXES: Array<{ prefix: string; family: ModelFamily }> = [
  { prefix: "anthropic/claude-", family: "claude" },
  { prefix: "openai/gpt-", family: "gpt" },
  { prefix: "google/gemini-", family: "gemini" },
  { prefix: "qwen/", family: "qwen" },
  { prefix: "deepseek/", family: "deepseek" },
  { prefix: "x-ai/grok-", family: "grok" },
  { prefix: "moonshotai/kimi-", family: "kimi" },
  { prefix: "z-ai/glm-", family: "glm" },
  { prefix: "meta/", family: "meta" },
  { prefix: "meta-llama/", family: "meta" },
];

/**
 * Returns the family for an OpenRouter model id, or null when the model isn't
 * one of Excelente's targeted families.
 */
export function familyOf(id: string): ModelFamily | null {
  for (const entry of FAMILY_PREFIXES) {
    if (id.startsWith(entry.prefix)) return entry.family;
  }
  return null;
}

/**
 * True when the model is from one of the allowed families. Convenience wrapper
 * around `familyOf` for filter callers.
 */
export function isAllowedModel(id: string): boolean {
  return familyOf(id) !== null;
}

/**
 * True when OpenRouter charges nothing for this model.
 *
 * `:batch` variants are excluded: they are asynchronous routing variants
 * priced separately, not a free tier.
 */
export function isFreeTierModel(m: Pick<ModelInfo, "id" | "pricing">): boolean {
  if (m.id.includes(":batch")) return false;
  if (m.id.endsWith(":free")) return true;
  return m.pricing.prompt === 0 && m.pricing.completion === 0;
}

/**
 * Vendors whose FREE models Excelente lists.
 *
 * Free models have to bypass the nine-family allowlist above, because none
 * of OpenRouter's free models are in those families — the allowlist alone
 * emptied the free section completely. This is the narrower gate that
 * replaces it: every vendor we already sell paid models from, plus NVIDIA
 * and OpenRouter's own free-model router.
 *
 * Owner decision 2026-09-10, after probing all 11 candidates live. Poolside
 * and Thinking Machines were dropped: Thinking Machines gates its free
 * endpoints to apps in OpenRouter's directory (403 until Excelente is
 * listed), and Poolside's only free endpoint is removed by the free-model
 * training guardrail. Both are re-addable by one line here if that changes.
 *
 * Matched on the VENDOR prefix, not the family prefix, which is why
 * `google/gemma-*` qualifies where `familyOf` (keyed on `google/gemini-`)
 * says null.
 */
const FREE_VENDOR_PREFIXES: readonly string[] = [
  // Vendors with paid models in the picker.
  "anthropic/",
  "deepseek/",
  "google/",
  "meta/",
  "meta-llama/",
  "moonshotai/",
  "openai/",
  "qwen/",
  "x-ai/",
  "z-ai/",
  // Plus, by owner decision.
  "nvidia/",
  "openrouter/",
];

/** True when this model's vendor is one whose free models we list. */
export function isSupportedFreeVendor(id: string): boolean {
  return FREE_VENDOR_PREFIXES.some((p) => id.startsWith(p));
}
