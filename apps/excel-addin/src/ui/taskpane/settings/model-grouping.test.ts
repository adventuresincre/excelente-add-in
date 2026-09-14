import { describe, expect, it } from "vitest";
import {
  displayName,
  groupByFamily,
  groupModelsForPicker,
  labelForPickerModel,
  labForModel,
  pickAutoVisionModel,
  primarySupportsVision,
  resolveDefaultVisionModelId,
  buildPicker,
  pickerOptionModelId,
  pickerOptionValue,
  TOP_CAPABILITY_GROUP_LABEL,
  TOP_VALUE_GROUP_LABEL,
  type PickerGroup,
} from "./model-grouping";
import { rankModels } from "./model-metrics";
import type { ModelInfo, ModelFamily } from "../../../core/openrouter";
import { DEFAULT_PUBLIC_CONFIG } from "../../../core/config";

function model(id: string, family: ModelFamily, created: number): ModelInfo {
  return {
    id,
    name: id,
    contextLength: 100_000,
    pricing: { prompt: 0.000001, completion: 0.000003 },
    supportsTools: true,
    supportsReasoning: false,
    supportsVision: false,
    created,
    family,
  };
}

const YEAR = 365 * 24 * 60 * 60;

describe("groupByFamily", () => {
  it("groups models by family and preserves input order within each group", () => {
    const newer = model("anthropic/claude-opus-4-7", "claude", 1_750_000_000);
    const older = model("anthropic/claude-sonnet-3-7", "claude", 1_700_000_000);
    const newQwen = model("qwen/qwen-3-7-max", "qwen", 1_745_000_000);

    const groups = groupByFamily([newer, older, newQwen]);
    const claude = groups.find((g) => g.family === "claude");
    expect(claude?.models.map((m) => m.id)).toEqual([
      "anthropic/claude-opus-4-7",
      "anthropic/claude-sonnet-3-7",
    ]);
  });

  it("returns families in deterministic display order — alphabetical by LAB", () => {
    const input = [
      model("qwen/qwen-3-7-max", "qwen", 1),
      model("openai/gpt-5", "gpt", 2),
      model("anthropic/claude-opus-4-7", "claude", 3),
      model("x-ai/grok-4", "grok", 4),
      model("moonshotai/kimi-latest", "kimi", 5),
      model("google/gemini-2-5-pro", "gemini", 6),
      model("deepseek/deepseek-v3", "deepseek", 7),
      model("z-ai/glm-5.2", "glm", 8),
      model("meta/muse-spark-1.3", "meta", 9),
    ];
    const groups = groupByFamily(input);
    // Alibaba, Anthropic, DeepSeek, Google, Meta, Moonshot AI, OpenAI, xAI, Z.AI
    expect(groups.map((g) => g.family)).toEqual([
      "qwen",
      "claude",
      "deepseek",
      "gemini",
      "meta",
      "kimi",
      "gpt",
      "grok",
      "glm",
    ]);
    expect(groups.map((g) => g.label)).toEqual([
      "Alibaba (Qwen)",
      "Anthropic (Claude)",
      "DeepSeek",
      "Google (Gemini)",
      "Meta",
      "Moonshot AI (Kimi)",
      "OpenAI (GPT)",
      "xAI (Grok)",
      "Z.AI (GLM)",
    ]);
  });

  it("drops empty families (so the UI doesn't render labels with no options)", () => {
    const groups = groupByFamily([model("anthropic/claude-sonnet-4-6", "claude", 1)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].family).toBe("claude");
  });

  it("ignores models with family=null (already filtered upstream, defensive)", () => {
    const valid = model("anthropic/claude-sonnet-4-6", "claude", 1);
    const invalid: ModelInfo = { ...valid, id: "x/y", family: null };
    const groups = groupByFamily([invalid, valid]);
    expect(groups).toHaveLength(1);
    expect(groups[0].models.map((m) => m.id)).toEqual(["anthropic/claude-sonnet-4-6"]);
  });

  it("returns [] for empty input", () => {
    expect(groupByFamily([])).toEqual([]);
  });
});

describe("groupModelsForPicker", () => {
  const now = 1_800_000_000;
  function paid(id: string, family: ModelFamily, created: number, extra: Partial<ModelInfo> = {}) {
    return { ...model(id, family, created), ...extra };
  }
  function free(id: string, family: ModelFamily, created: number, extra: Partial<ModelInfo> = {}) {
    return {
      ...model(id, family, created),
      pricing: { prompt: 0, completion: 0 },
      ...extra,
    };
  }

  it("puts A.CRE Free first, then free (with the train-on-data label), then Latest, then Legacy", () => {
    const recentClaude = paid("anthropic/claude-new", "claude", now - 10, {
      releasedAt: now - 30 * 24 * 3600,
    });
    // Registered with OpenRouter recently, but the lab released it 14 months
    // ago — Legacy on the release date, not Latest on the registration date.
    const oldClaude = paid("anthropic/claude-old", "claude", now - 20, {
      releasedAt: now - 14 * 30 * 24 * 3600,
    });
    const grok = paid("x-ai/grok-4.6", "grok", now - 50);
    const freeRow = free("z-ai/glm-4.7-flash:free", "glm", now - 40);
    const groups = groupModelsForPicker([oldClaude, recentClaude, grok, freeRow], now);

    expect(groups[0]?.key).toBe("acre");
    expect(groups[0]?.models[0]?.id).toBe("acre-free");
    expect(groups[1]?.label).toBe("Free Models (may train on your data)");
    expect(groups[1]?.models.map((m) => m.id)).toEqual(["z-ai/glm-4.7-flash:free"]);
    expect(groups.map((g) => g.key)).toEqual([
      "acre",
      "free",
      "latest-claude",
      "latest-grok",
      "legacy-claude",
    ]);
    expect(groups.find((g) => g.key === "latest-claude")?.models.map((m) => m.id)).toEqual([
      "anthropic/claude-new",
    ]);
    expect(groups.find((g) => g.key === "legacy-claude")?.models.map((m) => m.id)).toEqual([
      "anthropic/claude-old",
    ]);
  });

  it("counts a model with no release date as Latest by its registration date", () => {
    const registeredRecently = paid("openai/gpt-x", "gpt", now - 100 * 24 * 3600);
    const registeredLongAgo = paid("openai/gpt-y", "gpt", now - YEAR + 1); // inside the listing window, but not "latest"? It is: created counts as released.
    const groups = groupModelsForPicker([registeredRecently, registeredLongAgo], now);
    expect(groups.find((g) => g.key === "latest-gpt")?.models.map((m) => m.id)).toEqual([
      "openai/gpt-x",
      "openai/gpt-y",
    ]);
    expect(groups.find((g) => g.key === "legacy-gpt")).toBeUndefined();
  });

  it("orders each lab most capable first, unscored after, newest within a tie", () => {
    const models = [
      paid("openai/gpt-newest-unscored", "gpt", now - 1),
      paid("openai/gpt-older-unscored", "gpt", now - 2),
      paid("openai/gpt-mid", "gpt", now - 3, { capability: 40 }),
      paid("openai/gpt-best", "gpt", now - 4, { capability: 53 }),
      paid("anthropic/claude-a", "claude", now - 5, { capability: 51 }),
    ];
    const groups = groupModelsForPicker(models, now);
    expect(groups.find((g) => g.key === "latest-gpt")?.models.map((m) => m.id)).toEqual([
      "openai/gpt-best",
      "openai/gpt-mid",
      "openai/gpt-newest-unscored",
      "openai/gpt-older-unscored",
    ]);
    // Labs stay alphabetical even though Claude's score beats GPT's second.
    expect(groups.map((g) => g.key)).toEqual(["acre", "latest-claude", "latest-gpt"]);
  });

  it("orders the free section by capability as well", () => {
    const gemma: ModelInfo = {
      ...free("google/gemma-4-31b-it:free", "gemini", now - 1),
      family: null,
      capability: 15,
    };
    const nemotron: ModelInfo = {
      ...free("nvidia/nemotron-3-ultra:free", "gpt", now - 2),
      family: null,
      capability: 23,
    };
    const groups = groupModelsForPicker([gemma, nemotron], now);
    expect(groups.find((g) => g.key === "free")?.models.map((m) => m.id)).toEqual([
      "nvidia/nemotron-3-ultra:free",
      "google/gemma-4-31b-it:free",
    ]);
  });

  it("omits :batch variants", () => {
    const models = [
      paid("anthropic/claude-new:batch", "claude", now - 1),
      paid("anthropic/claude-new", "claude", now - 1),
      paid("anthropic/claude-old", "claude", now - 2),
    ];
    const latest = groupModelsForPicker(models, now).find((g) => g.key === "latest-claude");
    expect(latest?.models.map((m) => m.id)).toEqual([
      "anthropic/claude-new",
      "anthropic/claude-old",
    ]);
  });

  it("excludes every model registered more than 12 months ago from the dropdown", () => {
    const recentMeta = paid("meta/muse-spark-1.3", "meta", now - YEAR);
    const oldClaude = paid("anthropic/claude-old", "claude", now - YEAR - 1);

    const groups = groupModelsForPicker([recentMeta, oldClaude], now);
    const ids = groups.flatMap((group) => group.models.map((entry) => entry.id));
    expect(ids).toContain("meta/muse-spark-1.3");
    expect(ids).not.toContain("anthropic/claude-old");
  });
});

describe("labelForPickerModel", () => {
  const astra: ModelInfo = {
    ...model("openai/gpt-6-astra", "gpt", 1),
    name: "OpenAI: GPT-6 Astra",
    pricing: { prompt: 0.00000125, completion: 0.00001 },
    capability: 52.6,
  };
  const sol: ModelInfo = {
    ...model("openai/gpt-5.6-sol", "gpt", 1),
    name: "OpenAI: gpt-5.6-sol",
    capability: 47,
  };
  const cheap: ModelInfo = {
    ...model("google/gemini-4-flash", "gemini", 1),
    name: "Google: gemini-4-flash",
    pricing: { prompt: 0.0000001, completion: 0.0000004 },
    capability: 40,
  };
  const mystery: ModelInfo = {
    ...model("openai/gpt-mystery", "gpt", 1),
    name: "OpenAI: gpt-mystery",
    capability: undefined,
  };
  const nemotron: ModelInfo = {
    ...model("nvidia/nemotron-3-super-120b-a12b:free", "gpt", 1),
    name: "NVIDIA: Nemotron 3 Super 120B A12B (free)",
    family: null,
    pricing: { prompt: 0, completion: 0 },
    capability: 14,
  };
  const ranks = rankModels([astra, sol, cheap, mystery, nemotron]);

  it("reads name · #rank · price — the rank, not the raw score (2026-09-12)", () => {
    expect(labelForPickerModel(astra, ranks)).toBe("GPT-6 Astra · #1 · $1.25/$10.00");
    expect(labelForPickerModel(sol, ranks)).toBe("gpt-5.6-sol · #2 · $1.00/$3.00");
  });

  it("leads with the value rank in the Top 10 Value group", () => {
    // The cheap Gemini has the best capability per dollar; Astra the worst.
    expect(labelForPickerModel(cheap, ranks, "value")).toBe(
      "gemini-4-flash · value #1 · $0.10/$0.40"
    );
    expect(labelForPickerModel(astra, ranks, "value")).toBe(
      "GPT-6 Astra · value #3 · $1.25/$10.00"
    );
  });

  it("omits the rank for an unscored model, and for every model without a rank table", () => {
    expect(labelForPickerModel(mystery, ranks)).toBe("gpt-mystery · $1.00/$3.00");
    expect(labelForPickerModel(astra)).toBe("GPT-6 Astra · $1.25/$10.00");
  });

  it("marks a free model, ranks it by capability, and prices it as free", () => {
    expect(labelForPickerModel(nemotron, ranks)).toBe(
      "🆓 Nemotron 3 Super 120B A12B (free) · #4 · free"
    );
    // A free model has no value rank: the value style falls back to capability.
    expect(labelForPickerModel(nemotron, ranks, "value")).toBe(
      "🆓 Nemotron 3 Super 120B A12B (free) · #4 · free"
    );
  });
});

describe("buildPicker — the Top 10 lists", () => {
  const now = 1_800_000_000;
  /** A fully capable paid model: tools, reasoning and vision. */
  function full(id: string, family: ModelFamily, capability: number, priceIn: number) {
    return {
      ...model(id, family, now - 100),
      supportsReasoning: true,
      supportsVision: true,
      capability,
      pricing: { prompt: priceIn, completion: priceIn * 4 },
    } as ModelInfo;
  }

  it("inserts Top 10 Capability then Top 10 Value between Free and the first lab", () => {
    const models = [
      full("anthropic/claude-a", "claude", 50, 0.000005),
      full("openai/gpt-b", "gpt", 53, 0.00000125),
      full("google/gemini-c", "gemini", 40, 0.0000001),
      { ...full("z-ai/glm-free:free", "glm", 30, 0), family: null } as ModelInfo,
    ];
    const { groups, ranks } = buildPicker(models, now);
    expect(groups.map((g) => g.key)).toEqual([
      "acre",
      "free",
      "top-capability",
      "top-value",
      "latest-claude",
      "latest-gemini",
      "latest-gpt",
    ]);
    const cap = groups.find((g) => g.key === "top-capability")!;
    expect(cap.label).toBe(TOP_CAPABILITY_GROUP_LABEL);
    expect(cap.duplicates).toBe(true);
    // Best first; the free model qualifies for capability (it can do everything).
    expect(cap.models.map((m) => m.id)).toEqual([
      "openai/gpt-b",
      "anthropic/claude-a",
      "google/gemini-c",
      "z-ai/glm-free:free",
    ]);
    const val = groups.find((g) => g.key === "top-value")!;
    expect(val.label).toBe(TOP_VALUE_GROUP_LABEL);
    expect(val.labelStyle).toBe("value");
    // Paid only, best capability per dollar first; the free model is excluded.
    expect(val.models.map((m) => m.id)).toEqual([
      "google/gemini-c",
      "openai/gpt-b",
      "anthropic/claude-a",
    ]);
    expect(ranks.ofCapability).toBe(4);
    expect(ranks.ofValue).toBe(3);
  });

  it("admits only models with tools, reasoning AND vision, and caps each list at ten", () => {
    const models: ModelInfo[] = [];
    for (let i = 0; i < 12; i++) models.push(full(`openai/gpt-${i}`, "gpt", 60 - i, 0.000001));
    models.push({ ...full("anthropic/no-vision", "claude", 70, 0.000001), supportsVision: false });
    models.push({
      ...full("anthropic/no-reasoning", "claude", 69, 0.000001),
      supportsReasoning: false,
    });
    models.push({ ...full("anthropic/no-tools", "claude", 68, 0.000001), supportsTools: false });
    const { groups } = buildPicker(models, now);
    const cap = groups.find((g) => g.key === "top-capability")!;
    expect(cap.models).toHaveLength(10);
    expect(cap.models.map((m) => m.id)).toEqual(
      Array.from({ length: 10 }, (_, i) => `openai/gpt-${i}`)
    );
    // The three most capable models are absent because each lacks one capability;
    // they still rank (#1–#3) and still appear in their lab group.
    expect(groups.find((g) => g.key === "latest-claude")!.models.map((m) => m.id)).toEqual([
      "anthropic/no-vision",
      "anthropic/no-reasoning",
      "anthropic/no-tools",
    ]);
  });

  it("omits both lists when nothing qualifies (tests elsewhere rely on the old shape)", () => {
    const plain = { ...model("openai/gpt-plain", "gpt", now - 100), capability: 50 };
    const { groups } = buildPicker([plain], now);
    expect(groups.map((g) => g.key)).toEqual(["acre", "latest-gpt"]);
  });

  it("encodes duplicate options distinctly and decodes them back to the model id", () => {
    const m = full("openai/gpt-b", "gpt", 53, 0.00000125);
    const top = { key: "top-value", label: "", models: [m], duplicates: true } as PickerGroup;
    const lab = { key: "latest-gpt", label: "", models: [m] } as PickerGroup;
    expect(pickerOptionValue(top, m)).toBe("top-value::openai/gpt-b");
    expect(pickerOptionValue(lab, m)).toBe("openai/gpt-b");
    expect(pickerOptionModelId("top-value::openai/gpt-b")).toBe("openai/gpt-b");
    expect(pickerOptionModelId("openai/gpt-b")).toBe("openai/gpt-b");
  });
});

describe("displayName and labForModel", () => {
  it("strips the vendor prefix and names the lab, including for free-tier vendors", () => {
    const astra = { ...model("openai/gpt-6-astra", "gpt", 1), name: "OpenAI: GPT-6 Astra" };
    expect(displayName(astra)).toBe("GPT-6 Astra");
    expect(labForModel(astra)).toBe("OpenAI");
    const nemotron: ModelInfo = {
      ...model("nvidia/nemotron-3.5-lightning:free", "gpt", 1),
      name: "NVIDIA: Nemotron 3.5 Lightning (free)",
      family: null,
    };
    expect(labForModel(nemotron)).toBe("NVIDIA");
    expect(labForModel({ ...nemotron, id: "mystery/thing" })).toBe("Mystery");
  });
});

describe("pickAutoVisionModel", () => {
  it("prefers the configured byokDefaults vision id when present", () => {
    const list = [
      model("moonshotai/kimi-k2.7-code", "kimi", 9),
      model("anthropic/claude-opus-4-8", "claude", 8),
      model("x-ai/grok-4.6", "grok", 7),
    ];
    expect(pickAutoVisionModel(list)?.id).toBe("x-ai/grok-4.6");
  });

  it("falls back to the newest model in the CONFIGURED family when that exact id is absent", () => {
    // Configured id (x-ai/grok-4.6) is retired / missing from the live list.
    // The fallback must stay inside the configured family rather than
    // silently moving every BYOK user to another vendor.
    const list = [
      model("moonshotai/kimi-k2.7-code", "kimi", 9),
      model("anthropic/claude-opus-4-8", "claude", 8),
      model("x-ai/grok-5", "grok", 7),
      model("x-ai/grok-4.5", "grok", 6),
    ];
    // List arrives newest-first from the client; find() takes the first.
    expect(pickAutoVisionModel(list)?.id).toBe("x-ai/grok-5");
  });

  it("returns null when neither the configured id nor its family is available", () => {
    const list = [
      model("moonshotai/kimi-k2.7-code", "kimi", 9),
      model("anthropic/claude-opus-4-8", "claude", 8),
    ];
    expect(pickAutoVisionModel(list)).toBeNull();
  });

  it("returns null when no Claude is in the list (callers fall back to primary-inline)", () => {
    expect(pickAutoVisionModel([model("moonshotai/kimi-k2.7-code", "kimi", 1)])).toBeNull();
    expect(pickAutoVisionModel([])).toBeNull();
  });
});

describe("A.CRE Free picker row", () => {
  it("names the live model when the proxy has reported one", () => {
    const groups = groupModelsForPicker([], 100, { acreFreeModelLabel: "GLM 5.3 Flash" });
    const acre = groups.find((g) => g.key === "acre");
    expect(labelForPickerModel(acre!.models[0])).toBe("A.CRE Free (GLM 5.3 Flash)");
  });

  // First paint always renders before /health answers, so the un-labelled
  // row is a real state, not an error path.
  it("reads as the bare tier name before the model is known", () => {
    const groups = groupModelsForPicker([], 100);
    const acre = groups.find((g) => g.key === "acre");
    expect(labelForPickerModel(acre!.models[0])).toBe("A.CRE Free");
  });

  // The label must never pick up the pricing/score decorations the real
  // OpenRouter rows carry — the model is subsidized and server-pinned.
  it("carries no pricing, score or context decoration", () => {
    const groups = groupModelsForPicker([], 100, { acreFreeModelLabel: "GLM 5.3 Flash" });
    const label = labelForPickerModel(groups.find((g) => g.key === "acre")!.models[0]);
    expect(label).not.toContain("$");
    expect(label).not.toContain("·");
  });
});

describe("free models bypass the family allowlist", () => {
  // The whole point: as of 2026-09-10 NONE of OpenRouter's free models are
  // in the nine families, so requiring a family emptied this section.
  const gemma: ModelInfo = {
    ...model("google/gemma-4-31b-it:free", "gemini", 100),
    family: null,
    pricing: { prompt: 0, completion: 0 },
  };
  const nemotron: ModelInfo = {
    ...model("nvidia/nemotron-3.5-lightning:free", "gpt", 100),
    family: null,
    pricing: { prompt: 0, completion: 0 },
  };

  it("lists a free model with no recognized family", () => {
    const groups = groupModelsForPicker([gemma, nemotron], 100);
    const free = groups.find((g) => g.key === "free");
    expect(free?.models.map((m) => m.id)).toEqual([gemma.id, nemotron.id]);
  });

  it("labels the two free sections as the owner specified", () => {
    const groups = groupModelsForPicker([gemma], 100);
    expect(groups.map((g) => g.label)).toEqual([
      "A.CRE Free Model (For Students / Learners)",
      "Free Models (may train on your data)",
    ]);
  });

  // The allowlist's end-to-end guarantee still governs anything paid, so a
  // family-less PAID model must stay out.
  it("still excludes a paid model with no recognized family", () => {
    const paidUnknown: ModelInfo = { ...model("cohere/north-pro", "gpt", 100), family: null };
    const groups = groupModelsForPicker([paidUnknown], 100);
    expect(groups.flatMap((g) => g.models.map((m) => m.id))).not.toContain("cohere/north-pro");
  });

  it("keeps A.CRE Free out of the may-train section", () => {
    const groups = groupModelsForPicker([gemma], 100);
    const free = groups.find((g) => g.key === "free");
    expect(free?.models.some((m) => m.id === "acre-free")).toBe(false);
    expect(groups.find((g) => g.key === "acre")?.models).toHaveLength(1);
  });
});

describe("resolveDefaultVisionModelId", () => {
  const seeing: ModelInfo = {
    ...model("anthropic/claude-opus-4-7", "claude", 100),
    supportsVision: true,
  };
  const blind: ModelInfo = {
    ...model("deepseek/deepseek-v4-pro", "deepseek", 100),
    supportsVision: false,
  };
  // What byokDefaults.visionModelId points at, so pickAutoVisionModel can
  // resolve a fallback in these cases.
  const configured: ModelInfo = {
    ...model(DEFAULT_PUBLIC_CONFIG.byokDefaults.visionModelId ?? "x-ai/grok-4.6", "grok", 100),
    supportsVision: true,
  };
  const all = [seeing, blind, configured];

  it("routes images inline when the primary can see them", () => {
    expect(resolveDefaultVisionModelId(all, { modelId: seeing.id })).toBeNull();
  });

  it("falls back to the configured model when the primary is blind", () => {
    expect(resolveDefaultVisionModelId(all, { modelId: blind.id })).toBe(configured.id);
  });

  it("always honors an explicit override", () => {
    expect(
      resolveDefaultVisionModelId(all, { modelId: seeing.id, visionModelId: configured.id })
    ).toBe(configured.id);
  });

  // A.CRE Free's sentinel is never in the OpenRouter list, and the proxy
  // re-pins the model on every call, so a describer could not be honored.
  it("routes A.CRE Free inline", () => {
    expect(resolveDefaultVisionModelId(all, { modelId: "acre-free" })).toBeNull();
  });

  // Routing an image to a model that cannot read it fails silently; an
  // unnecessary describer call is merely wasteful. Prefer the waste.
  it("falls back for an unknown primary rather than assuming it can see", () => {
    expect(resolveDefaultVisionModelId(all, { modelId: "retired/model-9" })).toBe(configured.id);
    expect(resolveDefaultVisionModelId([], { modelId: seeing.id })).toBeNull();
  });

  it("returns null with no primary at all", () => {
    expect(resolveDefaultVisionModelId(all, null)).toBeNull();
    expect(resolveDefaultVisionModelId(all, { modelId: null })).toBeNull();
  });
});

describe("primarySupportsVision", () => {
  it("distinguishes unknown from blind", () => {
    const blind: ModelInfo = {
      ...model("deepseek/deepseek-v4-pro", "deepseek", 1),
      supportsVision: false,
    };
    expect(primarySupportsVision([blind], blind.id)).toBe(false);
    // Undefined, NOT false — nothing may claim a model is blind because the
    // list has not loaded.
    expect(primarySupportsVision([], blind.id)).toBeUndefined();
    expect(primarySupportsVision([blind], null)).toBeUndefined();
  });

  it("treats A.CRE Free as vision-capable", () => {
    expect(primarySupportsVision([], "acre-free")).toBe(true);
  });
});
