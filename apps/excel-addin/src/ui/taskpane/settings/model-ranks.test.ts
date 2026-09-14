import { describe, expect, it } from "vitest";
import type { ModelInfo } from "../../../core/openrouter";
import {
  formatRank,
  qualifiesForTopLists,
  rankModels,
  topByCapability,
  topByValue,
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

const astra = model("openai/gpt-6-astra", { capability: 53 });
const sol = model("openai/gpt-5.6-sol", { capability: 47 });
const twin = model("openai/gpt-5.6-twin", { capability: 47 }); // ties with sol
const flash = model("google/gemini-4-flash", {
  capability: 40,
  pricing: { prompt: 0.0000001, completion: 0.0000004 },
  family: "gemini",
});
const unranked = model("openai/gpt-mystery");
const freeScored = model("nvidia/nemotron:free", {
  capability: 14,
  pricing: { prompt: 0, completion: 0 },
  family: null,
});
const acre = model("acre-free", { capability: 99 });
const population = [astra, sol, twin, flash, unranked, freeScored, acre];

describe("rankModels", () => {
  const ranks = rankModels(population);

  it("ranks capability densely, best first, sharing a rank on ties", () => {
    expect(ranks.byId.get(astra.id)?.capability).toBe(1);
    expect(ranks.byId.get(sol.id)?.capability).toBe(2);
    expect(ranks.byId.get(twin.id)?.capability).toBe(2);
    expect(ranks.byId.get(flash.id)?.capability).toBe(3);
    expect(ranks.byId.get(freeScored.id)?.capability).toBe(4);
    expect(ranks.ofCapability).toBe(5);
  });

  it("leaves unscored models and A.CRE Free out entirely", () => {
    expect(ranks.byId.get(unranked.id)).toBeUndefined();
    expect(ranks.byId.get(acre.id)).toBeUndefined();
  });

  it("ranks value among paid scored models only — capability per blended dollar", () => {
    // flash: 40 / 0.175 ≈ 229 per $; astra: 53 / 3.44 ≈ 15; sol/twin: 47 / 3.44 ≈ 14.
    expect(ranks.byId.get(flash.id)?.value).toBe(1);
    expect(ranks.byId.get(astra.id)?.value).toBe(2);
    expect(ranks.byId.get(sol.id)?.value).toBe(3);
    expect(ranks.byId.get(twin.id)?.value).toBe(3);
    expect(ranks.byId.get(freeScored.id)?.value).toBeUndefined();
    expect(ranks.ofValue).toBe(4);
  });

  it("is empty for an empty population", () => {
    const empty = rankModels([]);
    expect(empty.byId.size).toBe(0);
    expect(empty.ofCapability).toBe(0);
    expect(empty.ofValue).toBe(0);
  });
});

describe("Top 10 lists", () => {
  const ranks = rankModels(population);

  it("qualifies only models with tools, reasoning and vision, never A.CRE Free", () => {
    expect(qualifiesForTopLists(astra)).toBe(true);
    expect(qualifiesForTopLists({ ...astra, supportsVision: false })).toBe(false);
    expect(qualifiesForTopLists({ ...astra, supportsReasoning: false })).toBe(false);
    expect(qualifiesForTopLists({ ...astra, supportsTools: false })).toBe(false);
    expect(qualifiesForTopLists(acre)).toBe(false);
  });

  it("orders by rank, breaking ties newest first, and skips unranked models", () => {
    const newerTwin = { ...twin, created: twin.created + 1 };
    const top = topByCapability([...population.filter((m) => m !== twin), newerTwin], ranks);
    expect(top.map((m) => m.id)).toEqual([astra.id, newerTwin.id, sol.id, flash.id, freeScored.id]);
  });

  it("value list is paid-only and honours the size cap", () => {
    expect(topByValue(population, ranks).map((m) => m.id)).toEqual([
      flash.id,
      astra.id,
      sol.id,
      twin.id,
    ]);
    expect(topByValue(population, ranks, 2).map((m) => m.id)).toEqual([flash.id, astra.id]);
    expect(topByCapability(population, ranks, 1).map((m) => m.id)).toEqual([astra.id]);
  });

  it("formats a rank with a hash", () => {
    expect(formatRank(1)).toBe("#1");
    expect(formatRank(12)).toBe("#12");
  });
});
