import { familyOf } from "../openrouter/model-families";
import type { ModelInfo } from "../openrouter";
import type { ModelPref } from "../storage";
import type { ByokDefaults } from "./types";

/**
 * Turn `byokDefaults` into a persisted `ModelPref` for first-run setup.
 *
 * When the live OpenRouter list is in hand, each configured id is resolved
 * against it (exact match, then a dated snapshot with the same prefix, then
 * newest in-family, then first tool-capable model). When the list is empty
 * (models still loading, or a host that failed to fetch them) the configured
 * ids are used as-is so Chat is not blocked on the picker.
 *
 * Subagent is intentionally omitted — blank means "same as primary".
 */
export function resolveByokDefaults(
  defaults: ByokDefaults,
  models: ReadonlyArray<ModelInfo>
): ModelPref {
  const toolModels = models.filter((m) => m.supportsTools);
  const visionModels = models.filter((m) => m.supportsTools && m.supportsVision);

  const pref: ModelPref = {
    modelId: pickModelId(defaults.primaryModelId, toolModels) ?? defaults.primaryModelId,
    reasoning: defaults.reasoning,
    maxTurns: defaults.maxTurns,
  };

  const visionId = pickModelId(defaults.visionModelId, visionModels) ?? defaults.visionModelId;
  if (visionId) pref.visionModelId = visionId;

  const summaryId = pickModelId(defaults.summaryModelId, toolModels) ?? defaults.summaryModelId;
  if (summaryId) pref.summaryModelId = summaryId;

  return pref;
}

function pickModelId(
  wanted: string | undefined,
  list: ReadonlyArray<ModelInfo>
): string | undefined {
  if (!wanted) return undefined;
  if (list.length === 0) return wanted;
  if (list.some((m) => m.id === wanted)) return wanted;
  const snapshot = list.find((m) => m.id.startsWith(`${wanted}-`) || m.id.startsWith(`${wanted}.`));
  if (snapshot) return snapshot.id;
  const family = familyOf(wanted);
  if (family) {
    const inFamily = list.find((m) => m.family === family);
    if (inFamily) return inFamily.id;
  }
  return list[0]?.id;
}
