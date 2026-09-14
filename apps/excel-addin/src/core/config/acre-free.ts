import type { ModelPref } from "../storage";
import type { ByokDefaults } from "./types";

/**
 * Sentinel primary-model id for A.CRE Free. Never sent to OpenRouter —
 * `resolveOpenRouterModelId` maps it to the subsidized model before a call,
 * and in practice the proxy re-pins the model server-side anyway.
 */
export const ACRE_FREE_SENTINEL_ID = "acre-free";

/**
 * A.CRE Free proxy endpoint, same-origin with the pane. A.CRE's OpenRouter
 * key funds this tier and a browser client cannot hold that key, so the pane
 * calls our own droplet and the proxy adds the key server-side. There is no
 * sign-in: the proxy meters spend per network address instead.
 *
 * Server, install steps, and limits: `server/acre-free/README.md`.
 */
export const ACRE_FREE_ENDPOINT = "/api/free";

/**
 * Fallback model id, used only if a call somehow reaches OpenRouter directly.
 * The live choice is `ACRE_FREE_MODEL` in `/etc/excelente/free.env`, which
 * the proxy substitutes into every request — so A.CRE can change models with
 * an env edit and a restart, with no rebuild and no redeploy.
 */
export const ACRE_FREE_OPENROUTER_ID = "z-ai/glm-5.3-flash";

/**
 * The tier's name on its own, with no model in it. Used wherever the live
 * model is unknown — before `/health` answers, or if it never does.
 */
export const ACRE_FREE_DISPLAY_NAME = "A.CRE Free";

/**
 * "A.CRE Free (GLM 5.3 Flash)" — the tier plus whichever model it is pinned
 * to right now.
 *
 * The model name is NEVER baked into the bundle. A.CRE swaps the underlying
 * model every month or two by editing ACRE_FREE_MODEL in free.env and
 * restarting; a name compiled in here would start lying at that moment, and
 * correcting it would cost a rebuild and a redeploy. So the label is fetched
 * from the proxy's /health at runtime (useAcreFreeInfo) and threaded in.
 *
 * A null label — fetch still in flight, offline, proxy down — falls back to
 * the bare tier name. Showing "A.CRE Free" alone is always true; guessing a
 * model is not.
 */
export function acreFreeLabel(modelLabel: string | null | undefined): string {
  return modelLabel ? `${ACRE_FREE_DISPLAY_NAME} (${modelLabel})` : ACRE_FREE_DISPLAY_NAME;
}

/**
 * Turn an OpenRouter model id into something readable: z-ai/glm-5.3-flash
 * becomes "GLM 5.3 Flash". Used only when the proxy reports a model id with
 * no explicit label of its own (ACRE_FREE_MODEL_LABEL), which is the escape
 * hatch for ids this cannot render well.
 */
export function prettyModelName(modelId: string): string {
  const tail = modelId.split("/").pop() ?? modelId;
  // Drop routing suffixes — ":free", ":nitro", ":floor".
  const base = tail.split(":")[0] ?? tail;
  return base.split(/[-_]/).filter(Boolean).map(titleOrAcronym).join(" ");
}

/**
 * Vowel-free short tokens in this namespace are acronyms or version tags —
 * glm, gpt, v3, 235b — and title case mangles them ("Glm 5.3 Flash").
 */
function titleOrAcronym(token: string): string {
  if (token.length <= 4 && !/[aeiou]/i.test(token)) return token.toUpperCase();
  return token.charAt(0).toUpperCase() + token.slice(1);
}

export function isAcreFreeModel(id: string | null | undefined): id is typeof ACRE_FREE_SENTINEL_ID {
  return id === ACRE_FREE_SENTINEL_ID;
}

/** Map a stored primary id to the OpenRouter id the client should call. */
export function resolveOpenRouterModelId(id: string): string {
  return isAcreFreeModel(id) ? ACRE_FREE_OPENROUTER_ID : id;
}

/**
 * Setup is done when the user picked a model AND can pay for it — their own
 * OpenRouter key, or A.CRE Free, which needs nothing further.
 */
export function isSetupComplete(
  apiKey: string | null | undefined,
  modelId: string | null | undefined
): boolean {
  if (!modelId) return false;
  return isAcreFreeModel(modelId) || Boolean(apiKey);
}

/**
 * Reasoning effort and pace for A.CRE Free.
 *
 * Pinned rather than inherited from `byokDefaults`. Settings hides the
 * Advanced accordion when there is no OpenRouter key, so on A.CRE Free
 * these two are not user-visible and not user-fixable — which means a
 * `byokDefaults` edit (or an Intel Hub `/config/public` push) would move
 * them silently, with nothing in the UI to notice it by.
 *
 * A SLIDER POSITION, not an effort. It resolves against whatever
 * `ACRE_FREE_MODEL` is pinned to at the time (see `resolveEffort`), so its
 * meaning travels with the model rather than freezing one provider's
 * vocabulary. On `z-ai/glm-5.3-flash` — rungs low/high/max, no true middle —
 * "medium" lands on `high`.
 *
 * Owner decision 2026-09-10, revised the same day from "low" after live
 * testing: low made the model visibly worse AND more expensive, because it
 * flailed and spent turns repairing its own mistakes. In an agentic loop the
 * whole conversation is re-sent every turn, so a wasted turn costs far more
 * than the reasoning that would have avoided it — thinking is billed once at
 * $0.50/Mtok, a redundant turn re-bills the entire prompt. Off is not an
 * option regardless: reasoning is mandatory on this model, so Off and Low
 * resolve to the same rung.
 */
export const ACRE_FREE_REASONING = "medium";
export const ACRE_FREE_MAX_TURNS = 200;

/**
 * The A.CRE Free preference. Every role — primary, sub-agents, the Reviewer,
 * vision, summary — runs on the same subsidized model. The proxy pins the
 * model regardless of what the client asks for; these ids keep the pane's
 * labels and stats honest about it.
 *
 * Takes `ByokDefaults` for signature stability with the BYOK path; the
 * values above deliberately do not come from it.
 */
export function acreFreeModelPref(_defaults: ByokDefaults): ModelPref {
  return {
    modelId: ACRE_FREE_SENTINEL_ID,
    reasoning: ACRE_FREE_REASONING,
    maxTurns: ACRE_FREE_MAX_TURNS,
    visionModelId: ACRE_FREE_OPENROUTER_ID,
    subagentModelId: ACRE_FREE_OPENROUTER_ID,
    summaryModelId: ACRE_FREE_OPENROUTER_ID,
  };
}
