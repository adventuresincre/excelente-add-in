import { describe, expect, it } from "vitest";
import type { ModelInfo } from "../openrouter";
import { enrichModels, stripRoutingSuffix, toUnixSeconds } from "./merge";
import type { ModelCatalogFile } from "./types";

function model(id: string): ModelInfo {
  return {
    id,
    name: id,
    contextLength: 100_000,
    pricing: { prompt: 0.000001, completion: 0.000003 },
    supportsTools: true,
    supportsReasoning: true,
    supportsVision: false,
    created: 1_750_000_000,
    family: null,
  };
}

const catalog: ModelCatalogFile = {
  schemaVersion: 1,
  generatedAt: "2026-09-11T04:31:07.000Z",
  source: { name: "Artificial Analysis" },
  models: {
    "openai/gpt-6-astra": {
      capability: 53,
      capabilityByEffort: { max: 53, low: 46, none: 45 },
      releaseDate: "2026-06-12",
      outputTokensPerSecond: 88.2,
    },
    "nvidia/nemotron-3-super-120b-a12b": { capability: 14 },
  },
};

describe("enrichModels", () => {
  it("attaches capability, release date and speed to matched models", () => {
    const [astra] = enrichModels([model("openai/gpt-6-astra")], catalog);
    expect(astra).toMatchObject({
      capability: 53,
      capabilityByEffort: { max: 53, low: 46, none: 45 },
      releasedAt: Date.UTC(2026, 5, 12) / 1000,
      outputTokensPerSecond: 88.2,
    });
  });

  it("leaves unmatched models exactly as they were", () => {
    const original = model("cohere/north-pro");
    const [same] = enrichModels([original], catalog);
    expect(same).toBe(original);
  });

  it("falls back from a :free variant to the base id", () => {
    const [nemotron] = enrichModels([model("nvidia/nemotron-3-super-120b-a12b:free")], catalog);
    expect(nemotron.capability).toBe(14);
    expect(nemotron).not.toHaveProperty("releasedAt");
  });

  it("is a no-op without a catalog", () => {
    const originals = [model("a/b"), model("c/d")];
    expect(enrichModels(originals, null)).toEqual(originals);
    expect(enrichModels(originals, undefined)).toEqual(originals);
  });
});

describe("helpers", () => {
  it("strips routing suffixes", () => {
    expect(stripRoutingSuffix("nvidia/x:free")).toBe("nvidia/x");
    expect(stripRoutingSuffix("nvidia/x")).toBe("nvidia/x");
  });

  it("parses dates to UTC midnight seconds and rejects junk", () => {
    expect(toUnixSeconds("2026-06-12")).toBe(Date.UTC(2026, 5, 12) / 1000);
    expect(toUnixSeconds("2026-06-12T10:00:00Z")).toBe(Date.UTC(2026, 5, 12) / 1000);
    expect(toUnixSeconds("not a date")).toBeUndefined();
    expect(toUnixSeconds(undefined)).toBeUndefined();
  });
});
