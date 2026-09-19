import { describe, expect, it } from "vitest";
import type { ModelInfo } from "../../../core/openrouter";
import {
  blendedPricePerMillion,
  capabilityAtSetting,
  capabilityRank,
  compareByCapability,
  explorerRows,
  formatCapability,
  formatPriceLong,
  formatPricePair,
  formatReleased,
  formatSpeed,
  ordinal,
  relativeCapability,
  valueScore,
} from "./model-metrics";

function model(id: string, extra: Partial<ModelInfo> = {}): ModelInfo {
  return {
    id,
    name: id,
    contextLength: 200_000,
    pricing: { prompt: 0.00000125, completion: 0.00001 },
    supportsTools: true,
    supportsReasoning: true,
    supportsVision: true,
    created: 1_750_000_000,
    family: "gpt",
    ...extra,
  };
}

const astra = model("openai/gpt-6-astra", {
  capability: 53,
  capabilityByEffort: { max: 53, xhigh: 53, high: 51, medium: 50, low: 46, none: 45 },
  reasoningPolicy: {
    mandatory: true,
    supportedEfforts: ["max", "xhigh", "high", "medium", "low"],
    defaultEffort: "medium",
  },
  outputTokensPerSecond: 88.2,
  releasedAt: Date.UTC(2026, 5, 12) / 1000,
});
const sol = model("openai/gpt-5.6-sol", { capability: 47, created: 1_740_000_000 });
const unranked = model("openai/gpt-mystery", { created: 1_760_000_000 });
const nemotron = model("nvidia/nemotron-3-super-120b-a12b:free", {
  capability: 14,
  pricing: { prompt: 0, completion: 0 },
  supportsVision: false,
  family: null,
  reasoningPolicy: { mandatory: false, supportedEfforts: ["medium", "low"] },
});
// A hosted row (an edition's own tier) never ranks, however it is scored.
const acre = model("host-tier", {
  capability: 99,
  hosted: { lab: "Host", groupKey: "host", groupLabel: "Host Tier" },
});

describe("formatting", () => {
  it("rounds capability to a whole number", () => {
    expect(formatCapability(52.6)).toBe("53");
  });

  it("prices per million tokens", () => {
    expect(formatPricePair(astra.pricing)).toBe("$1.25/$10.00");
    expect(formatPriceLong(astra)).toBe("$1.25 in · $10.00 out per 1M tokens");
    expect(formatPriceLong(nemotron)).toBe("Free");
  });

  it("formats speed and release month, tolerating unknowns", () => {
    expect(formatSpeed(88.2)).toBe("88 tokens/s");
    expect(formatSpeed(undefined)).toBeNull();
    expect(formatReleased(astra.releasedAt)).toBe("Jun 2026");
    expect(formatReleased(undefined)).toBeNull();
    expect(formatReleased(0)).toBeNull();
  });

  it("writes ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "101st",
    ]);
  });
});

describe("rank, bar and value", () => {
  const list = [astra, sol, unranked, nemotron, acre];

  it("ranks densely among scored models and ignores hosted rows", () => {
    expect(capabilityRank(list, astra)).toEqual({ rank: 1, of: 3 });
    expect(capabilityRank(list, sol)).toEqual({ rank: 2, of: 3 });
    expect(capabilityRank(list, nemotron)).toEqual({ rank: 3, of: 3 });
    expect(capabilityRank(list, unranked)).toBeNull();
  });

  it("scales the bar to the best score in the list", () => {
    expect(relativeCapability([astra, sol], sol)).toBeCloseTo(47 / 53);
    expect(relativeCapability([astra, sol], astra)).toBe(1);
    expect(relativeCapability([astra], unranked)).toBeNull();
  });

  it("uses the 3:1 blended price, weights capability to the 4th power, and treats a scored free model as infinite value", () => {
    expect(blendedPricePerMillion(astra)).toBeCloseTo((3 * 1.25 + 10) / 4);
    expect(valueScore(astra)).toBeCloseTo(53 ** 4 / ((3 * 1.25 + 10) / 4));
    expect(valueScore(nemotron)).toBe(Number.POSITIVE_INFINITY);
    expect(valueScore(unranked)).toBeNull();
  });
});

describe("capabilityAtSetting", () => {
  it("reads the score for the rung the reasoning ladder actually sends", () => {
    expect(capabilityAtSetting(astra, "high")).toEqual({ effort: "max", score: 53 });
    expect(capabilityAtSetting(astra, "medium")).toEqual({ effort: "medium", score: 50 });
    expect(capabilityAtSetting(astra, "low")).toEqual({ effort: "low", score: 46 });
  });

  it("maps Off to the weakest rung on a mandatory model and to the non-reasoning run otherwise", () => {
    expect(capabilityAtSetting(astra, "off")).toEqual({ effort: "low", score: 46 });
    const offable = model("x/y", {
      capabilityByEffort: { high: 40, none: 30 },
      reasoningPolicy: { mandatory: false, supportedEfforts: ["high", "none"] },
    });
    expect(capabilityAtSetting(offable, "off")).toEqual({ effort: "none", score: 30 });
  });

  it("is null when the benchmark published no such variant", () => {
    expect(capabilityAtSetting(sol, "high")).toBeNull();
    expect(capabilityAtSetting(nemotron, "high")).toBeNull();
  });
});

describe("compareByCapability", () => {
  it("puts scored models first, best first, then newest", () => {
    const sorted = [unranked, sol, astra, nemotron].sort(compareByCapability).map((m) => m.id);
    expect(sorted).toEqual([astra.id, sol.id, nemotron.id, unranked.id]);
    const unscoredNew = model("a/new", { created: 3 });
    const unscoredOld = model("a/old", { created: 1 });
    expect([unscoredOld, unscoredNew].sort(compareByCapability).map((m) => m.id)).toEqual([
      "a/new",
      "a/old",
    ]);
  });
});

describe("explorerRows", () => {
  const list = [astra, sol, unranked, nemotron, acre];
  const none = { freeOnly: false, vision: false, reasoningOffable: false };

  it("never lists a hosted row and defaults to most capable first", () => {
    expect(explorerRows(list, none, "capability").map((m) => m.id)).toEqual([
      astra.id,
      sol.id,
      nemotron.id,
      unranked.id,
    ]);
  });

  it("filters by free, vision and reasoning-off", () => {
    expect(explorerRows(list, { ...none, freeOnly: true }, "capability").map((m) => m.id)).toEqual([
      nemotron.id,
    ]);
    expect(explorerRows(list, { ...none, vision: true }, "capability").map((m) => m.id)).toEqual([
      astra.id,
      sol.id,
      unranked.id,
    ]);
    expect(
      explorerRows(list, { ...none, reasoningOffable: true }, "capability").map((m) => m.id)
    ).toEqual([sol.id, nemotron.id, unranked.id]);
  });

  it("sorts by price, value, speed and recency", () => {
    expect(explorerRows(list, none, "price").map((m) => m.id)[0]).toBe(nemotron.id);
    expect(explorerRows(list, none, "value").map((m) => m.id)[0]).toBe(nemotron.id);
    expect(explorerRows(list, none, "speed").map((m) => m.id)[0]).toBe(astra.id);
    expect(explorerRows(list, none, "newest").map((m) => m.id)[0]).toBe(astra.id);
  });
});
