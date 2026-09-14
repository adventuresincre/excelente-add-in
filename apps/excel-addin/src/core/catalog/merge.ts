import type { ModelInfo } from "../openrouter";
import type { ModelCatalogFile } from "./types";

/**
 * Attach catalog enrichment to OpenRouter's live model list. Pure: returns
 * new objects for enriched models and the originals untouched otherwise.
 *
 * Lookup is by exact OpenRouter id first, then by the id with its routing
 * suffix (`:free`, `:batch`) removed — the job matches the exact ids it
 * fetched, but a variant that appears between nightly runs still deserves
 * its base model's score.
 */
export function enrichModels(
  models: readonly ModelInfo[],
  catalog: ModelCatalogFile | null | undefined
): ModelInfo[] {
  if (!catalog) return [...models];
  return models.map((m) => {
    const entry = catalog.models[m.id] ?? catalog.models[stripRoutingSuffix(m.id)];
    if (!entry) return m;
    const enriched: ModelInfo = { ...m, capability: entry.capability };
    if (entry.capabilityByEffort) enriched.capabilityByEffort = entry.capabilityByEffort;
    const releasedAt = toUnixSeconds(entry.releaseDate);
    if (releasedAt !== undefined) enriched.releasedAt = releasedAt;
    if (entry.outputTokensPerSecond !== undefined) {
      enriched.outputTokensPerSecond = entry.outputTokensPerSecond;
    }
    return enriched;
  });
}

export function stripRoutingSuffix(id: string): string {
  const i = id.indexOf(":");
  return i === -1 ? id : id.slice(0, i);
}

/** `YYYY-MM-DD` → unix seconds at UTC midnight; undefined when unparseable. */
export function toUnixSeconds(date: string | undefined): number | undefined {
  if (!date) return undefined;
  const ms = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined;
}
