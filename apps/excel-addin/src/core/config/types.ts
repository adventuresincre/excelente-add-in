import type { ReasoningLevel } from "../storage";

/**
 * Bundled settings the add-in starts from. There is no server-driven config:
 * the first-run model defaults ship with the build (`defaults.ts`) and change
 * by a code change and a deploy.
 */
export interface PublicConfig {
  byokDefaults: ByokDefaults;
}

/** Model picks and pace applied the moment a first-run key is saved. */
export interface ByokDefaults {
  primaryModelId: string;
  visionModelId?: string;
  summaryModelId?: string;
  reasoning: ReasoningLevel;
  maxTurns: number;
}
