import type { ModelInfo } from "../../../core/openrouter";
import type { ModelPref } from "../../../core/storage";
import type { Edition } from "../../../edition/types";
import { isHostedModelId } from "../../../edition/hosted";
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
 * chip that named another model): the notice offers a key or a return to
 * the fallback, and nothing is sent until one is chosen.
 *
 * What runs underneath a waiting choice is the edition's `keylessFallback`.
 * A hosted edition supplies its tier, so every consumer has a coherent
 * preference to read; the composer and the send guard are what keep it from
 * being used. In the community edition there is no fallback: `running` is
 * null, nothing runs, and the only way forward is a key.
 *
 * This resolver is the single place that decides what runs. Everything that
 * sends a request (the stream, the reasoning policy lookup, the session-info
 * popover) reads `running`; Settings reads the stored preference and shows
 * `pendingModelId` beside it.
 */
export interface RunningModel {
  /** What actually drives requests right now. Null when nothing can run. */
  running: ModelPref | null;
  /** The chosen model that cannot run yet, or null when the choice is live. */
  pendingModelId: string | null;
}

export function resolveRunningPref(
  modelPref: ModelPref | null | undefined,
  apiKey: string | null | undefined,
  edition: Pick<Edition, "hostedModels" | "keylessFallback">
): RunningModel {
  if (!modelPref) return { running: null, pendingModelId: null };
  if (apiKey || isHostedModelId(edition.hostedModels, modelPref.modelId)) {
    return { running: modelPref, pendingModelId: null };
  }
  return {
    running: edition.keylessFallback?.modelPref() ?? null,
    pendingModelId: modelPref.modelId,
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
 * A readable name for the waiting model. The catalogue may not have loaded
 * yet, or may not carry the id (a model delisted since it was chosen), so
 * fall back to the id's last path segment rather than the raw id.
 */
export function pendingModelName(models: readonly ModelInfo[], id: string): string {
  const found = models.find((m) => m.id === id);
  if (found) return displayName(found);
  const parts = id.split("/");
  return parts[parts.length - 1] ?? id;
}
