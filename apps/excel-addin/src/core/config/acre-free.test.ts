import { describe, expect, it } from "vitest";
import {
  ACRE_FREE_DISPLAY_NAME,
  ACRE_FREE_OPENROUTER_ID,
  ACRE_FREE_REASONING,
  ACRE_FREE_SENTINEL_ID,
  acreFreeLabel,
  acreFreeModelPref,
  prettyModelName,
  isAcreFreeModel,
  isSetupComplete,
  resolveOpenRouterModelId,
} from "./acre-free";
import { DEFAULT_PUBLIC_CONFIG } from "./defaults";
import { reasoningParamFor } from "../openrouter";

describe("A.CRE Free ids", () => {
  it("treats only the sentinel as A.CRE Free", () => {
    expect(isAcreFreeModel(ACRE_FREE_SENTINEL_ID)).toBe(true);
    expect(isAcreFreeModel(ACRE_FREE_OPENROUTER_ID)).toBe(false);
    expect(isAcreFreeModel(null)).toBe(false);
  });

  it("never sends the sentinel to OpenRouter", () => {
    expect(resolveOpenRouterModelId(ACRE_FREE_SENTINEL_ID)).toBe(ACRE_FREE_OPENROUTER_ID);
    expect(resolveOpenRouterModelId("x-ai/grok-4.6")).toBe("x-ai/grok-4.6");
  });

  // The proxy pins the model server-side, so A.CRE can switch models without
  // shipping a new bundle. A label naming a model would start lying the
  // moment they do.
  it("keeps the display label free of a model name", () => {
    expect(ACRE_FREE_DISPLAY_NAME).toBe("A.CRE Free");
    expect(ACRE_FREE_DISPLAY_NAME).not.toContain("/");
  });
});

describe("isSetupComplete", () => {
  it("needs nothing beyond the pick for A.CRE Free — no key, no sign-in", () => {
    expect(isSetupComplete(null, ACRE_FREE_SENTINEL_ID)).toBe(true);
  });

  it("requires a key for any other model", () => {
    expect(isSetupComplete(null, "x-ai/grok-4.6")).toBe(false);
    expect(isSetupComplete("sk-or-test", "x-ai/grok-4.6")).toBe(true);
  });

  it("is incomplete with no model", () => {
    expect(isSetupComplete("sk-or-test", null)).toBe(false);
    expect(isSetupComplete(null, null)).toBe(false);
  });
});

describe("acreFreeModelPref", () => {
  it("runs every role on the subsidized model", () => {
    const pref = acreFreeModelPref(DEFAULT_PUBLIC_CONFIG.byokDefaults);
    expect(pref.modelId).toBe(ACRE_FREE_SENTINEL_ID);
    expect(pref.visionModelId).toBe(ACRE_FREE_OPENROUTER_ID);
    expect(pref.subagentModelId).toBe(ACRE_FREE_OPENROUTER_ID);
    expect(pref.summaryModelId).toBe(ACRE_FREE_OPENROUTER_ID);
  });

  // Settings hides the Advanced accordion with no key, so on A.CRE Free
  // these two are neither visible nor fixable. Inheriting them from
  // byokDefaults would let an Intel Hub config push move them silently.
  it("pins Medium reasoning and the Longer pace, ignoring byokDefaults", () => {
    const pref = acreFreeModelPref({
      ...DEFAULT_PUBLIC_CONFIG.byokDefaults,
      reasoning: "high",
      maxTurns: 25,
    });
    expect(pref.reasoning).toBe("medium");
    expect(pref.maxTurns).toBe(200);
  });

  // The pinned value is a slider POSITION, so what reaches the wire depends
  // on the model the proxy is pinned to. glm-5.3-flash publishes low/high/max
  // and no true middle, so Medium lands on `high` — worth a test, because a
  // future ACRE_FREE_MODEL with a real `medium` rung will resolve cheaper
  // without this constant changing.
  it("resolves the pinned level against the live model's own ladder", () => {
    expect(
      reasoningParamFor(ACRE_FREE_REASONING, {
        mandatory: true,
        defaultEnabled: true,
        supportedEfforts: ["max", "high", "low"],
        defaultEffort: "max",
      })
    ).toEqual({ effort: "high" });
  });
});

describe("acreFreeLabel", () => {
  it("names the live model when the proxy reported one", () => {
    expect(acreFreeLabel("GLM 5.3 Flash")).toBe("A.CRE Free (GLM 5.3 Flash)");
  });

  // The label is fetched at runtime, so "not yet known" is a state every
  // caller renders at least once. It must degrade to a true sentence, never
  // to an empty paren or a guessed model.
  it("falls back to the bare tier name when the model is unknown", () => {
    expect(acreFreeLabel(null)).toBe(ACRE_FREE_DISPLAY_NAME);
    expect(acreFreeLabel(undefined)).toBe(ACRE_FREE_DISPLAY_NAME);
    expect(acreFreeLabel("")).toBe(ACRE_FREE_DISPLAY_NAME);
  });
});

describe("prettyModelName", () => {
  it("uppercases vendor acronyms and version tags, title-cases words", () => {
    expect(prettyModelName("z-ai/glm-5.3-flash")).toBe("GLM 5.3 Flash");
    expect(prettyModelName("openai/gpt-5-mini")).toBe("GPT 5 Mini");
    expect(prettyModelName("anthropic/claude-sonnet-4.5")).toBe("Claude Sonnet 4.5");
    expect(prettyModelName("x-ai/grok-4.6")).toBe("Grok 4.6");
    expect(prettyModelName("qwen/qwen3-235b")).toBe("Qwen3 235B");
  });

  it("drops the routing suffix", () => {
    expect(prettyModelName("z-ai/glm-4.6:free")).toBe("GLM 4.6");
    expect(prettyModelName("z-ai/glm-4.6:nitro")).toBe("GLM 4.6");
  });

  it("handles a bare id with no vendor prefix", () => {
    expect(prettyModelName("glm-5.3-flash")).toBe("GLM 5.3 Flash");
  });
});
