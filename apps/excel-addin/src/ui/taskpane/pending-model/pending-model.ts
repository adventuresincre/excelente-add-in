import type { ModelInfo } from "../../../core/openrouter";
import type { ModelPref } from "../../../core/storage";
import type { Edition } from "../../../edition/types";
import { hostedModelFor } from "../../../edition/hosted";
import { displayName } from "../settings/model-grouping";

/**
 * The chosen model and the running model are two different things.
 *
 * Spencer, 2026-09-15: without an OpenRouter key the picker used to hold one
 * row, the hosted tier, and every other model was invisible. Now the whole
 * catalogue shows to everyone. A user without a key may choose any model;
 * the choice is SAVED as the preference (so it survives and becomes live the
 * moment a key is added) but does not RUN, because there is no key to run it
 * on. While the choice waits, chat is LOCKED (Spencer, 2026-09-15, after
 * testing the first cut, which kept answering on the hosted tier under a
 * chip that named another model): the notice offers a way forward, and
 * nothing is sent until one is chosen.
 *
 * Two reasons a choice can wait:
 *   - "key": a real model was chosen and there is no key. What runs
 *     underneath, if anything, is the edition's `keylessFallback`, and only
 *     when the user is entitled to it. The community edition has none:
 *     `running` is null, nothing runs, and the only way forward is a key.
 *   - "membership": a hosted model was chosen and the user is not (or no
 *     longer) entitled to it. Nothing runs; the ways forward are connecting
 *     a membership or adding a key and choosing another model.
 *
 * This resolver is the single place that decides what runs. Everything that
 * sends a request (the stream, the reasoning policy lookup, the session-info
 * popover) reads `running`; Settings reads the stored preference and shows
 * `pendingModelId` beside it.
 */
export type PendingReason = "key" | "membership";

export interface RunningModel {
  /** What actually drives requests right now. Null when nothing can run. */
  running: ModelPref | null;
  /** The chosen model that cannot run yet, or null when the choice is live. */
  pendingModelId: string | null;
  /** Why it waits, when it does. */
  pendingReason: PendingReason | null;
}

const LIVE = (running: ModelPref): RunningModel => ({
  running,
  pendingModelId: null,
  pendingReason: null,
});

export function resolveRunningPref(
  modelPref: ModelPref | null | undefined,
  apiKey: string | null | undefined,
  edition: Pick<Edition, "hostedModels" | "keylessFallback">,
  entitled: ReadonlySet<string>
): RunningModel {
  if (!modelPref) return { running: null, pendingModelId: null, pendingReason: null };
  const hosted = hostedModelFor(edition.hostedModels, modelPref.modelId);
  if (hosted) {
    if (entitled.has(hosted.id)) return LIVE(modelPref);
    return { running: null, pendingModelId: modelPref.modelId, pendingReason: "membership" };
  }
  if (apiKey) return LIVE(modelPref);
  const fallback = edition.keylessFallback;
  return {
    running: fallback && entitled.has(fallback.id) ? fallback.modelPref() : null,
    pendingModelId: modelPref.modelId,
    pendingReason: "key",
  };
}

/**
 * "Add OpenRouter key" from either notice: bring the key field in Settings
 * into view and focus it. Called after the Settings view is shown, so the
 * field exists and is visible; a no-op when it does not.
 */
export function focusApiKeyField(): void {
  const input = document.querySelector<HTMLInputElement>(".api-key-field__input");
  input?.scrollIntoView({ block: "center", behavior: "smooth" });
  input?.focus();
}

/**
 * "Connect membership", and a locked hosted row picked in the picker: bring
 * the edition's own Settings section into view. The section carries
 * `id="edition-settings"` by contract (`Edition.SettingsSection`).
 */
export function focusEditionSettingsSection(): void {
  document
    .getElementById("edition-settings")
    ?.scrollIntoView({ block: "start", behavior: "smooth" });
}

/**
 * A readable name for the waiting model. The catalogue may not have loaded
 * yet, or may not carry the id (a model delisted since it was chosen), so
 * fall back to the id's last path segment rather than the raw id.
 */
export function pendingModelName(
  models: readonly ModelInfo[],
  id: string,
  hosted: readonly ModelInfo[] = []
): string {
  const found = [...hosted, ...models].find((m) => m.id === id);
  if (found) return displayName(found);
  const parts = id.split("/");
  return parts[parts.length - 1] ?? id;
}
