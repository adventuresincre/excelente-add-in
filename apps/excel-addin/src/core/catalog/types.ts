/**
 * One model's enrichment, keyed by OpenRouter id in `ModelCatalogFile.models`.
 * Produced nightly by `server/model-catalog/build-catalog.mjs`; the pane only
 * ever reads it.
 */
export interface CatalogEntry {
  /** Ceiling score across the model's published reasoning configurations. */
  capability: number;
  /** Score per effort: `max / xhigh / high / medium / low / minimal / none / default`. */
  capabilityByEffort?: Record<string, number>;
  /** Lab release date, `YYYY-MM-DD`. */
  releaseDate?: string;
  /** Median output speed, tokens per second. */
  outputTokensPerSecond?: number;
  aaSlug?: string;
  aaName?: string;
  matchedBy?: string;
}

export interface ModelCatalogFile {
  schemaVersion: 1;
  /** ISO timestamp of the nightly build. */
  generatedAt: string;
  source: { name: string; url?: string; indexVersion?: string };
  models: Record<string, CatalogEntry>;
}
