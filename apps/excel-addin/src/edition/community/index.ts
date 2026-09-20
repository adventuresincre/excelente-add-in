import type { ModelInfo } from "../../core/openrouter";
import type { Edition } from "../types";

/**
 * The community edition: what the public repository builds.
 *
 * Bring your own OpenRouter key. No hosted models, so a model chosen
 * without a key waits (chat locked) until one is added. The five shared
 * skills under `apps/excel-addin/skills/` and nothing more.
 */
export const edition: Edition = {
  id: "community",
  hostedModels: [],
  keylessFallback: null,
  bundledSkills: { skill: {}, resources: {} },
  setup: {
    intro:
      "Excelente does not ship a model of its own. Connect one and everything else follows: any model on OpenRouter, from free to frontier, with your own key.",
  },
};

const NO_ROWS: ModelInfo[] = [];
const NO_IDS: ReadonlySet<string> = new Set();

export function useHostedPickerRows(): ModelInfo[] {
  return NO_ROWS;
}

export function useEntitledHostedIds(): ReadonlySet<string> {
  return NO_IDS;
}
