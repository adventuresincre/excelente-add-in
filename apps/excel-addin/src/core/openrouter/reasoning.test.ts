import { describe, expect, it } from "vitest";
import {
  effortLadder,
  reasoningIsMandatory,
  reasoningParamFor,
  reasoningStopsFor,
  resolveEffort,
  type ReasoningPolicy,
} from "./reasoning";

// Every policy below is a real row from OpenRouter's /models on 2026-09-10.

/** z-ai/glm-5.3-flash — A.CRE Free's model. Mandatory, defaults to max. */
const GLM_FLASH: ReasoningPolicy = {
  mandatory: true,
  defaultEnabled: true,
  supportedEfforts: ["max", "high", "low"],
  defaultEffort: "max",
};
/** nvidia/nemotron-3-super-120b-a12b:free — reasons by default, can be off. */
const NEMOTRON_SUPER: ReasoningPolicy = {
  mandatory: false,
  defaultEnabled: true,
  supportedEfforts: ["medium", "low"],
  defaultEffort: "medium",
};
/** nvidia/nemotron-3-ultra-550b-a55b:free — two rungs, neither low. */
const NEMOTRON_ULTRA: ReasoningPolicy = {
  mandatory: false,
  defaultEnabled: true,
  supportedEfforts: ["high", "medium"],
  defaultEffort: "high",
};
/** nex-agi/nex-n2.5-mini:free — "none" is a rung on its own list. */
const NEX_MINI: ReasoningPolicy = {
  mandatory: false,
  supportedEfforts: ["high", "medium", "none"],
  defaultEffort: "high",
};
/** meta/muse-spark-1.3-contributor — mandatory, six rungs down to minimal. */
const MUSE: ReasoningPolicy = {
  mandatory: true,
  supportedEfforts: ["max", "xhigh", "high", "medium", "low", "minimal"],
  defaultEffort: "medium",
};
/** openai/gpt-6-astra — mandatory, five rungs, default medium. */
const ASTRA: ReasoningPolicy = {
  mandatory: true,
  defaultEnabled: true,
  supportedEfforts: ["max", "xhigh", "high", "medium", "low"],
  defaultEffort: "medium",
};
/** deepseek/deepseek-v4.1-flash — three rungs, no literal medium, default high. */
const DEEPSEEK_FLASH: ReasoningPolicy = {
  mandatory: false,
  defaultEnabled: true,
  supportedEfforts: ["max", "high", "low"],
  defaultEffort: "high",
};
/** nvidia/nemotron-3.5-lightning:free — a policy with no ladder at all. */
const NO_EFFORTS: ReasoningPolicy = { mandatory: false };
/** liquid/lfm-2.5-2.6b:free — mandatory and publishes no ladder. */
const MANDATORY_NO_EFFORTS: ReasoningPolicy = { mandatory: true };

describe("effortLadder", () => {
  it("is the published list, weakest first, without the off-stop", () => {
    expect(effortLadder(NEX_MINI)).toEqual(["medium", "high"]);
    expect(effortLadder(MUSE)).toEqual(["minimal", "low", "medium", "high", "xhigh", "max"]);
  });

  it("is empty when nothing is published", () => {
    expect(effortLadder()).toEqual([]);
    expect(effortLadder(NO_EFFORTS)).toEqual([]);
    expect(effortLadder({ mandatory: false, supportedEfforts: ["none"] })).toEqual([]);
  });

  // A name we have never seen still lands where its provider ranks it, so a
  // lab's future rung needs no code change here.
  it("keeps an unknown effort at its published position", () => {
    expect(effortLadder({ mandatory: false, supportedEfforts: ["ultra", "high", "low"] })).toEqual([
      "low",
      "high",
      "ultra",
    ]);
  });

  // If the known names are out of order the list cannot be trusted as a
  // ladder; canonical order takes over and unrankable names are dropped.
  it("falls back to canonical order when the published order is not monotonic", () => {
    expect(
      effortLadder({ mandatory: false, supportedEfforts: ["low", "max", "ultra", "high"] })
    ).toEqual(["low", "high", "max"]);
  });
});

describe("resolveEffort — by position, not by name", () => {
  it("low is the weakest rung and high the strongest, whatever they are called", () => {
    expect(resolveEffort("low", MUSE)).toBe("minimal");
    expect(resolveEffort("high", MUSE)).toBe("max");
    expect(resolveEffort("low", NEMOTRON_ULTRA)).toBe("medium");
    expect(resolveEffort("high", NEMOTRON_SUPER)).toBe("medium");
    expect(resolveEffort("high", GLM_FLASH)).toBe("max");
  });

  // The bug this replaces: name-matching sent "low" to a model whose list is
  // high/medium/none and picked "none" as the nearest neighbour — reasoning
  // OFF for a user who asked for a little.
  it("never resolves an on-level onto the off-stop", () => {
    expect(resolveEffort("low", NEX_MINI)).toBe("medium");
    expect(resolveEffort("medium", NEX_MINI)).toBe("medium");
    expect(resolveEffort("high", NEX_MINI)).toBe("high");
    const highOrNone: ReasoningPolicy = { mandatory: false, supportedEfforts: ["high", "none"] };
    expect(resolveEffort("low", highOrNone)).toBe("high");
    expect(resolveEffort("medium", highOrNone)).toBe("high");
  });

  it("medium is the model's own medium when it has one", () => {
    expect(resolveEffort("medium", ASTRA)).toBe("medium");
    expect(resolveEffort("medium", MUSE)).toBe("medium");
    expect(resolveEffort("medium", NEMOTRON_SUPER)).toBe("medium");
  });

  it("otherwise medium is the default effort when that sits between the ends", () => {
    expect(resolveEffort("medium", DEEPSEEK_FLASH)).toBe("high");
  });

  it("otherwise medium is the ordinal middle, rounding toward the weaker end", () => {
    // max/high/low with default max: the default is an end, so the middle rung wins.
    expect(resolveEffort("medium", GLM_FLASH)).toBe("high");
    // Two rungs, neither named medium.
    expect(
      resolveEffort("medium", {
        mandatory: false,
        supportedEfforts: ["xhigh", "high"],
        defaultEffort: "xhigh",
      })
    ).toBe("high");
    // Four rungs: floor((4 - 1) / 2) = index 1 from the weak end.
    expect(
      resolveEffort("medium", {
        mandatory: false,
        supportedEfforts: ["max", "xhigh", "high", "low"],
      })
    ).toBe("high");
  });

  it("passes the level name through when no ladder is published", () => {
    for (const level of ["low", "medium", "high"] as const) {
      expect(resolveEffort(level)).toBe(level);
      expect(resolveEffort(level, NO_EFFORTS)).toBe(level);
    }
  });
});

describe("reasoningParamFor — off", () => {
  // The reported bug: omitting the parameter means "model default", and this
  // model's default is to reason. Measured on qwen3.7-flash: omitted -> 296
  // reasoning tokens, enabled:false -> 0.
  it("sends an explicit disable when the model allows it", () => {
    expect(reasoningParamFor("off", NEMOTRON_SUPER)).toEqual({ enabled: false });
    expect(reasoningParamFor("off", NO_EFFORTS)).toEqual({ enabled: false });
    expect(reasoningParamFor("off", NEX_MINI)).toEqual({ enabled: false });
  });

  // THE trap. Both `{enabled:false}` and `{effort:"none"}` return HTTP 400
  // "Reasoning is mandatory for this endpoint and cannot be disabled" on
  // glm-5.3-flash — which every A.CRE Free request runs on. A blanket
  // disable would have failed the whole free tier.
  it("NEVER sends a disable to a mandatory-reasoning model", () => {
    for (const policy of [GLM_FLASH, MUSE, ASTRA, MANDATORY_NO_EFFORTS]) {
      const param = reasoningParamFor("off", policy);
      expect(param).not.toHaveProperty("enabled");
      expect(param?.effort).not.toBe("none");
    }
  });

  // Its own default is "max", so omitting would be the opposite of what the
  // user asked for. The weakest rung is the honest reading.
  it("asks a mandatory model for its weakest rung instead", () => {
    expect(reasoningParamFor("off", GLM_FLASH)).toEqual({ effort: "low" });
    expect(reasoningParamFor("off", MUSE)).toEqual({ effort: "minimal" });
    expect(reasoningParamFor("off", ASTRA)).toEqual({ effort: "low" });
  });

  it("falls back to low for a mandatory model that publishes no ladder", () => {
    expect(reasoningParamFor("off", MANDATORY_NO_EFFORTS)).toEqual({ effort: "low" });
  });

  // No policy means we have not been told whether a disable is a 400.
  // Leaving reasoning on is worse than nothing; breaking the turn is worse
  // than both.
  it("omits the parameter when the policy is unknown", () => {
    expect(reasoningParamFor("off")).toBeUndefined();
  });
});

describe("reasoningParamFor — levels", () => {
  it("spans the whole ladder of the model", () => {
    expect(reasoningParamFor("low", GLM_FLASH)).toEqual({ effort: "low" });
    expect(reasoningParamFor("medium", GLM_FLASH)).toEqual({ effort: "high" });
    expect(reasoningParamFor("high", GLM_FLASH)).toEqual({ effort: "max" });
  });

  it("collapses onto what a short ladder offers", () => {
    expect(reasoningParamFor("low", NEMOTRON_SUPER)).toEqual({ effort: "low" });
    expect(reasoningParamFor("medium", NEMOTRON_SUPER)).toEqual({ effort: "medium" });
    expect(reasoningParamFor("high", NEMOTRON_SUPER)).toEqual({ effort: "medium" });
  });

  it.each(["low", "medium", "high"] as const)(
    "passes %s through when nothing is published",
    (level) => {
      expect(reasoningParamFor(level)).toEqual({ effort: level });
      expect(reasoningParamFor(level, NO_EFFORTS)).toEqual({ effort: level });
    }
  );
});

describe("reasoningIsMandatory", () => {
  it("reports what the slider needs to explain itself", () => {
    expect(reasoningIsMandatory(GLM_FLASH)).toBe(true);
    expect(reasoningIsMandatory(NEMOTRON_SUPER)).toBe(false);
    expect(reasoningIsMandatory(undefined)).toBe(false);
  });
});

describe("reasoningStopsFor", () => {
  it("names the rung every stop buys on the model", () => {
    expect(reasoningStopsFor(MUSE)).toEqual([
      { level: "off", effort: "minimal" },
      { level: "low", effort: "minimal" },
      { level: "medium", effort: "medium" },
      { level: "high", effort: "max" },
    ]);
  });

  it("marks a stop that adds nothing over the one below it", () => {
    expect(reasoningStopsFor(NEMOTRON_SUPER)).toEqual([
      { level: "off", effort: null },
      { level: "low", effort: "low" },
      { level: "medium", effort: "medium" },
      { level: "high", effort: "medium", sameAs: "medium" },
    ]);
    expect(reasoningStopsFor(NEMOTRON_ULTRA)).toEqual([
      { level: "off", effort: null },
      { level: "low", effort: "medium" },
      { level: "medium", effort: "medium", sameAs: "low" },
      { level: "high", effort: "high" },
    ]);
  });

  it("chains a collapse back to the first stop it equals", () => {
    expect(reasoningStopsFor({ mandatory: false, supportedEfforts: ["high", "none"] })).toEqual([
      { level: "off", effort: null },
      { level: "low", effort: "high" },
      { level: "medium", effort: "high", sameAs: "low" },
      { level: "high", effort: "high", sameAs: "low" },
    ]);
  });

  it("reports a true off as null and an unknown policy as all pass-through", () => {
    expect(reasoningStopsFor()).toEqual([
      { level: "off", effort: null },
      { level: "low", effort: "low" },
      { level: "medium", effort: "medium" },
      { level: "high", effort: "high" },
    ]);
  });
});
