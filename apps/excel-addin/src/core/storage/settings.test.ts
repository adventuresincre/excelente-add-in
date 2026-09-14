import { describe, expect, it } from "vitest";
import { createSettingsStore, inMemoryBackend } from "./settings";

describe("SettingsStore", () => {
  it("round-trips the API key", async () => {
    const store = createSettingsStore(inMemoryBackend());

    expect(await store.getApiKey()).toBeNull();
    await store.setApiKey("sk-or-test-123");
    expect(await store.getApiKey()).toBe("sk-or-test-123");
    await store.clearApiKey();
    expect(await store.getApiKey()).toBeNull();
  });

  it("rejects empty or whitespace API keys", async () => {
    const store = createSettingsStore(inMemoryBackend());
    await expect(store.setApiKey("")).rejects.toThrow();
    await expect(store.setApiKey("   ")).rejects.toThrow();
  });

  it("round-trips a model preference", async () => {
    const store = createSettingsStore(inMemoryBackend());

    expect(await store.getModelPref()).toBeNull();
    await store.setModelPref({ modelId: "anthropic/claude-opus-4-7", reasoning: "high" });
    expect(await store.getModelPref()).toEqual({
      modelId: "anthropic/claude-opus-4-7",
      reasoning: "high",
    });
  });

  it("rejects invalid reasoning levels", async () => {
    const store = createSettingsStore(inMemoryBackend());
    await expect(
      store.setModelPref({ modelId: "x", reasoning: "ultra" as never })
    ).rejects.toThrow();
  });

  it("rejects empty modelId", async () => {
    const store = createSettingsStore(inMemoryBackend());
    await expect(store.setModelPref({ modelId: "", reasoning: "low" })).rejects.toThrow();
  });

  it("returns null for malformed stored model pref", async () => {
    const backend = inMemoryBackend();
    await backend.setItem("excelente.openrouter.modelPref", "not json");
    const store = createSettingsStore(backend);
    expect(await store.getModelPref()).toBeNull();
  });

  it("returns null for partially-shaped stored model pref", async () => {
    const backend = inMemoryBackend();
    await backend.setItem("excelente.openrouter.modelPref", JSON.stringify({ modelId: "x" }));
    const store = createSettingsStore(backend);
    expect(await store.getModelPref()).toBeNull();
  });

  it("key is namespaced so it does not collide with other settings", async () => {
    const backend = inMemoryBackend();
    const store = createSettingsStore(backend);
    await store.setApiKey("sk-1");

    expect(await backend.getItem("excelente.openrouter.apiKey")).toBe("sk-1");
    expect(await backend.getItem("apiKey")).toBeNull();
  });

  it("round-trips maxTurns and rounds/validates it", async () => {
    const store = createSettingsStore(inMemoryBackend());
    await store.setModelPref({
      modelId: "anthropic/claude-sonnet-4-6",
      reasoning: "off",
      maxTurns: 100,
    });
    expect((await store.getModelPref())?.maxTurns).toBe(100);

    // Non-positive / non-finite values are dropped (omitted, not stored).
    await store.setModelPref({
      modelId: "anthropic/claude-sonnet-4-6",
      reasoning: "off",
      maxTurns: 0,
    });
    expect((await store.getModelPref())?.maxTurns).toBeUndefined();
  });

  it("round-trips subagentModelId + visionModelId + summaryModelId overrides", async () => {
    const store = createSettingsStore(inMemoryBackend());
    await store.setModelPref({
      modelId: "anthropic/claude-opus-4-7",
      reasoning: "medium",
      subagentModelId: "anthropic/claude-haiku-4-5",
      visionModelId: "moonshotai/kimi-latest",
      summaryModelId: "anthropic/claude-haiku-4-5",
    });
    expect(await store.getModelPref()).toEqual({
      modelId: "anthropic/claude-opus-4-7",
      reasoning: "medium",
      subagentModelId: "anthropic/claude-haiku-4-5",
      visionModelId: "moonshotai/kimi-latest",
      summaryModelId: "anthropic/claude-haiku-4-5",
    });
  });

  it("treats empty override strings as 'use default' on write and omits them on read", async () => {
    const store = createSettingsStore(inMemoryBackend());
    await store.setModelPref({
      modelId: "anthropic/claude-opus-4-7",
      reasoning: "off",
      subagentModelId: "",
      visionModelId: "   ",
    });
    const pref = await store.getModelPref();
    expect(pref?.subagentModelId).toBeUndefined();
    expect(pref?.visionModelId).toBeUndefined();
  });

  it("active capabilities default to empty arrays when unset", async () => {
    const store = createSettingsStore(inMemoryBackend());
    expect(await store.getActiveCapabilities()).toEqual({ skills: [], connectors: [] });
  });

  it("round-trips active skills + connectors", async () => {
    const store = createSettingsStore(inMemoryBackend());
    await store.setActiveCapabilities({
      skills: ["real-estate-valuation", "debt-sizing"],
      connectors: ["cre-agents"],
    });
    expect(await store.getActiveCapabilities()).toEqual({
      skills: ["real-estate-valuation", "debt-sizing"],
      connectors: ["cre-agents"],
    });
  });

  it("normalizes active capabilities — drops non-strings/empties and de-dupes", async () => {
    const backend = inMemoryBackend();
    await backend.setItem(
      "excelente.capabilities.active",
      JSON.stringify({ skills: ["a", "a", "", 7, null, "b"], connectors: "nope" })
    );
    const store = createSettingsStore(backend);
    expect(await store.getActiveCapabilities()).toEqual({ skills: ["a", "b"], connectors: [] });
  });

  it("returns empty active capabilities for malformed JSON", async () => {
    const backend = inMemoryBackend();
    await backend.setItem("excelente.capabilities.active", "not json");
    const store = createSettingsStore(backend);
    expect(await store.getActiveCapabilities()).toEqual({ skills: [], connectors: [] });
  });

  it("ignores legacy persisted prefs without the new fields", async () => {
    // Older stored prefs only had modelId + reasoning. They should still load
    // — the new optional fields just come back undefined.
    const backend = inMemoryBackend();
    await backend.setItem(
      "excelente.openrouter.modelPref",
      JSON.stringify({ modelId: "qwen/qwen-3-7-max", reasoning: "low" })
    );
    const store = createSettingsStore(backend);
    const pref = await store.getModelPref();
    expect(pref).toEqual({
      modelId: "qwen/qwen-3-7-max",
      reasoning: "low",
    });
  });
});
