import { describe, expect, it } from "vitest";
import type { ModelFamily, ModelInfo } from "../openrouter";
import { DEFAULT_PUBLIC_CONFIG } from "./defaults";
import { resolveByokDefaults } from "./resolve-byok-defaults";
import type { ByokDefaults } from "./types";

function model(id: string, family: ModelFamily, extra: Partial<ModelInfo> = {}): ModelInfo {
  return {
    id,
    name: id,
    contextLength: 100_000,
    pricing: { prompt: 0, completion: 0 },
    supportsTools: true,
    supportsReasoning: false,
    supportsVision: false,
    created: 1,
    family,
    ...extra,
  };
}

const DEFAULTS: ByokDefaults = {
  primaryModelId: "x-ai/grok-4.6",
  visionModelId: "x-ai/grok-4.6",
  summaryModelId: "deepseek/deepseek-v4-pro",
  reasoning: "low",
  maxTurns: 50,
};

describe("resolveByokDefaults", () => {
  it("uses the configured ids when they are on the live list", () => {
    const grok = model("x-ai/grok-4.6", "grok", { supportsVision: true });
    const ds = model("deepseek/deepseek-v4-pro", "deepseek");
    expect(resolveByokDefaults(DEFAULTS, [grok, ds])).toEqual({
      modelId: "x-ai/grok-4.6",
      visionModelId: "x-ai/grok-4.6",
      summaryModelId: "deepseek/deepseek-v4-pro",
      reasoning: "low",
      maxTurns: 50,
    });
  });

  it("does not set a subagent override (same as primary)", () => {
    const grok = model("x-ai/grok-4.6", "grok", { supportsVision: true });
    expect(resolveByokDefaults(DEFAULTS, [grok]).subagentModelId).toBeUndefined();
  });

  it("maps a rolling summary id onto a dated snapshot when that is what OpenRouter lists", () => {
    const grok = model("x-ai/grok-4.6", "grok", { supportsVision: true });
    const ds = model("deepseek/deepseek-v4-pro-0813", "deepseek");
    expect(resolveByokDefaults(DEFAULTS, [grok, ds]).summaryModelId).toBe(
      "deepseek/deepseek-v4-pro-0813"
    );
  });

  it("falls back to newest in-family when the configured id is gone", () => {
    const newerGrok = model("x-ai/grok-4.20", "grok", { supportsVision: true });
    const olderGrok = model("x-ai/grok-4.5", "grok", { supportsVision: true });
    const ds = model("deepseek/deepseek-v3", "deepseek");
    const pref = resolveByokDefaults(DEFAULTS, [newerGrok, olderGrok, ds]);
    expect(pref.modelId).toBe("x-ai/grok-4.20");
    expect(pref.visionModelId).toBe("x-ai/grok-4.20");
    expect(pref.summaryModelId).toBe("deepseek/deepseek-v3");
  });

  it("keeps the configured ids when the model list is empty (fetch failed)", () => {
    expect(resolveByokDefaults(DEFAULTS, [])).toEqual({
      modelId: "x-ai/grok-4.6",
      visionModelId: "x-ai/grok-4.6",
      summaryModelId: "deepseek/deepseek-v4-pro",
      reasoning: "low",
      maxTurns: 50,
    });
  });

  it("matches the bundled DEFAULT_PUBLIC_CONFIG shape", () => {
    const d = DEFAULT_PUBLIC_CONFIG.byokDefaults;
    expect(d.primaryModelId).toBe("x-ai/grok-4.6");
    expect(d.visionModelId).toBe("x-ai/grok-4.6");
    // Summary is the deliberate exception to the single-model rule — a
    // flash-tier model with the largest context window we default to,
    // because it drives the unattended compaction meta-call.
    expect(d.summaryModelId).toBe("z-ai/glm-5.3-flash");
    expect(d.reasoning).toBe("low");
    expect(d.maxTurns).toBe(200);
  });
});
