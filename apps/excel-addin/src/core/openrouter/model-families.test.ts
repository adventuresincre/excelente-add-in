import { describe, expect, it } from "vitest";
import { familyOf, isAllowedModel } from "./model-families";

describe("familyOf", () => {
  it("maps Anthropic claude slugs to 'claude'", () => {
    expect(familyOf("anthropic/claude-opus-4-7")).toBe("claude");
    expect(familyOf("anthropic/claude-sonnet-4-6")).toBe("claude");
    expect(familyOf("anthropic/claude-haiku-4-5")).toBe("claude");
  });

  it("maps OpenAI gpt slugs to 'gpt' (and ignores o-series, per Wave 8a-1 scope)", () => {
    expect(familyOf("openai/gpt-5")).toBe("gpt");
    expect(familyOf("openai/gpt-5-mini")).toBe("gpt");
    // o-series intentionally out of scope.
    expect(familyOf("openai/o3")).toBeNull();
    expect(familyOf("openai/o4-mini")).toBeNull();
  });

  it("maps Gemini, Qwen, DeepSeek, Grok, Kimi, GLM, and Meta", () => {
    expect(familyOf("google/gemini-2-5-pro")).toBe("gemini");
    expect(familyOf("qwen/qwen-3-7-max")).toBe("qwen");
    expect(familyOf("deepseek/deepseek-v3")).toBe("deepseek");
    expect(familyOf("x-ai/grok-4")).toBe("grok");
    expect(familyOf("moonshotai/kimi-latest")).toBe("kimi");
    expect(familyOf("moonshotai/kimi-k2.6")).toBe("kimi");
    expect(familyOf("z-ai/glm-5.2")).toBe("glm");
    expect(familyOf("z-ai/glm-4.6v")).toBe("glm");
    expect(familyOf("meta/muse-spark-1.3")).toBe("meta");
    expect(familyOf("meta/muse-spark-1.3-contributor")).toBe("meta");
    expect(familyOf("meta-llama/llama-4-maverick")).toBe("meta");
  });

  it("returns null for out-of-scope families", () => {
    expect(familyOf("nousresearch/hermes-4")).toBeNull();
    expect(familyOf("mistralai/mistral-large-2")).toBeNull();
    expect(familyOf("microsoft/phi-4")).toBeNull();
    expect(familyOf("cohere/command-r-plus")).toBeNull();
  });

  it("returns null for empty or malformed ids", () => {
    expect(familyOf("")).toBeNull();
    expect(familyOf("openai")).toBeNull();
    expect(familyOf("anthropic/")).toBeNull();
  });
});

describe("isAllowedModel", () => {
  it("returns true for any in-scope family member", () => {
    expect(isAllowedModel("anthropic/claude-opus-4-7")).toBe(true);
    expect(isAllowedModel("moonshotai/kimi-latest")).toBe(true);
    expect(isAllowedModel("z-ai/glm-5.2")).toBe(true);
    expect(isAllowedModel("meta-llama/llama-4")).toBe(true);
  });

  it("returns false for out-of-scope models", () => {
    expect(isAllowedModel("openai/o3")).toBe(false);
  });
});
