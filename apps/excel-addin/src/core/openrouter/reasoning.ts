import type { ReasoningLevel } from "../storage";
import type { ModelInfo } from "./types";

/**
 * OpenRouter unifies provider-specific reasoning parameters under a single
 * `reasoning` block. See https://openrouter.ai/docs/use-cases/reasoning-tokens
 *
 * `effort` names a rung on the model's own ladder. `enabled: false` turns
 * reasoning off outright — but NOT on every model. See `reasoningParamFor`.
 */
export interface ReasoningParam {
  effort?: string;
  enabled?: boolean;
}

export type ReasoningPolicy = NonNullable<ModelInfo["reasoningPolicy"]>;

/** The three slider stops that actually ask for reasoning. */
export type OnLevel = Exclude<ReasoningLevel, "off">;

/**
 * Every effort name OpenRouter has published so far, weakest first. This is
 * NOT the ladder we send from — `effortLadder` uses the provider's own
 * order — it is only the tie-breaker for a published list we cannot trust,
 * and the definition of which names mean "off".
 */
const CANONICAL_ORDER = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const OFF_EFFORTS: ReadonlySet<string> = new Set(["none"]);

/**
 * A model's reasoning efforts, weakest → strongest, with the off-stop removed.
 *
 * Every `supported_efforts` list in the catalogue is published strongest
 * first (all 24 distinct lists, 2026-09-10), so the provider's order IS the
 * ladder. Using it, rather than our own vocabulary, is what lets a name we
 * have never seen — a lab's future "ultra" — land where its provider ranks
 * it instead of being guessed at. The one guard: if the names we DO know are
 * not monotonic in the published order, the list is unordered and we fall
 * back to canonical order, dropping unknown names because an unrankable
 * effort could be either end of the ladder.
 *
 * Empty when the model publishes no efforts. That is the case for 143 of the
 * 307 models with a reasoning policy, and for every model without one.
 */
export function effortLadder(policy?: ReasoningPolicy): string[] {
  const published = Array.from(new Set(policy?.supportedEfforts ?? [])).filter(
    (e) => !OFF_EFFORTS.has(e)
  );
  if (published.length === 0) return [];
  const ascending = [...published].reverse();
  const knownRanks = ascending.map(canonicalRank).filter((r) => r >= 0);
  const monotonic = knownRanks.every((r, i) => i === 0 || r > knownRanks[i - 1]);
  if (monotonic) return ascending;
  return ascending
    .filter((e) => canonicalRank(e) >= 0)
    .sort((a, b) => canonicalRank(a) - canonicalRank(b));
}

function canonicalRank(effort: string): number {
  return CANONICAL_ORDER.indexOf(effort as (typeof CANONICAL_ORDER)[number]);
}

/**
 * The effort a slider stop asks for on a given model.
 *
 *   low    → the weakest effort the model offers
 *   high   → the strongest
 *   medium → the model's own "medium" when it has one; otherwise its default
 *            effort when that sits strictly between the ends (the lab's own
 *            idea of balanced); otherwise the ordinal middle, rounding toward
 *            the weaker end so a collapse never escalates spend.
 *
 * Providers disagree on names and on how many rungs they offer, so the three
 * stops are defined by POSITION on the model's ladder, not by name — a user
 * who picks High on a model whose top rung is "max" gets max, and one who
 * picks Low on a ladder that starts at "minimal" gets minimal. Name matching
 * would have sent "low" to a model whose weakest rung is "medium" and left
 * upstream to guess, and — the bug this replaces — resolved "low" on a list
 * of high/medium/none onto "none", switching reasoning OFF for a user who
 * asked for a little.
 *
 * With no published ladder the level name passes through unchanged:
 * OpenRouter normalizes an effort a model does not list rather than
 * rejecting it (verified: "medium" accepted by a model publishing
 * max/high/low), and any model that does reject it is caught by the
 * client's reasoning-400 fallback.
 */
export function resolveEffort(level: OnLevel, policy?: ReasoningPolicy): string {
  const ladder = effortLadder(policy);
  if (ladder.length === 0) return level;
  if (level === "low") return ladder[0];
  if (level === "high") return ladder[ladder.length - 1];
  if (ladder.includes("medium")) return "medium";
  const preferred = policy?.defaultEffort;
  if (preferred !== undefined) {
    const i = ladder.indexOf(preferred);
    if (i > 0 && i < ladder.length - 1) return preferred;
  }
  return ladder[Math.floor((ladder.length - 1) / 2)];
}

/**
 * Build the `reasoning` request block for a level and a model.
 *
 * Off used to return undefined, which OMITS the parameter — and omitting it
 * means "use the model's default". 120 of the 436 models OpenRouter lists
 * reason by default, so switching reasoning off changed nothing for them and
 * the user kept paying for thinking tokens they had turned off. Measured on
 * qwen3.7-flash: omitted → 296 reasoning tokens, `enabled:false` → 0.
 *
 * But a blanket `enabled: false` is not the fix either. 101 models make
 * reasoning mandatory and answer any explicit disable with HTTP 400
 * ("Reasoning is mandatory for this endpoint and cannot be disabled") — and
 * `z-ai/glm-5.3-flash`, the model A.CRE Free is pinned to, is one of them.
 * Sending it unconditionally would have failed every A.CRE Free request.
 *
 * So Off is policy-dependent:
 *   - mandatory        → the WEAKEST rung the model offers. Reasoning cannot
 *                        be turned off, and the model's own default is often
 *                        the opposite of what was asked (glm-5.3-flash
 *                        defaults to "max"), so the honest reading of "off"
 *                        is "as little as this model will do".
 *   - policy known,
 *     not mandatory    → `enabled: false`. Actually off.
 *   - policy unknown   → omit. Unknown means we have not been told whether a
 *                        disable is a 400, and breaking a turn is worse than
 *                        leaving reasoning on.
 *
 * Levels resolve by position on the model's ladder — see `resolveEffort`.
 */
export function reasoningParamFor(
  level: ReasoningLevel,
  policy?: ReasoningPolicy
): ReasoningParam | undefined {
  if (level === "off") {
    if (!policy) return undefined;
    if (policy.mandatory) return { effort: resolveEffort("low", policy) };
    return { enabled: false };
  }
  return { effort: resolveEffort(level, policy) };
}

/**
 * True when "off" cannot actually turn reasoning off. Drives the Settings
 * copy, so the slider explains itself instead of appearing not to work.
 */
export function reasoningIsMandatory(policy?: ReasoningPolicy): boolean {
  return policy?.mandatory === true;
}

/** One slider stop as it lands on a particular model. */
export interface ReasoningStop {
  level: ReasoningLevel;
  /**
   * The effort name that reaches the wire for this stop. Null for a true
   * off (`enabled:false`) and for an unknown policy, where Off omits the
   * parameter.
   */
  effort: string | null;
  /**
   * Set when this stop resolves to the same rung as a lower stop and so adds
   * nothing on this model. The slider disables it and names the stop it
   * equals rather than offering two buttons that do one thing. Only ever
   * "low" or "medium"; Off is judged by `reasoningIsMandatory` instead,
   * because on a mandatory model Off is the misleading stop, not Low.
   */
  sameAs?: OnLevel;
}

/**
 * Every slider stop resolved against a model, for the Settings UI. The
 * mapping is the whole point of the control being honest: a user testing a
 * new model should be able to read exactly which rung each stop buys.
 */
export function reasoningStopsFor(policy?: ReasoningPolicy): ReasoningStop[] {
  const off = reasoningParamFor("off", policy);
  const stops: ReasoningStop[] = [{ level: "off", effort: off?.effort ?? null }];
  let previous: ReasoningStop | undefined;
  for (const level of ["low", "medium", "high"] as const) {
    const effort = resolveEffort(level, policy);
    const stop: ReasoningStop = { level, effort };
    if (previous && previous.effort === effort) {
      stop.sameAs = previous.sameAs ?? (previous.level as OnLevel);
    }
    stops.push(stop);
    previous = stop;
  }
  return stops;
}
