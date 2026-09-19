import { describe, expect, it } from "vitest";
import { pendingModelName, resolveRunningPref } from "./pending-model";
import type { ModelInfo } from "../../../core/openrouter";
import type { ModelPref } from "../../../core/storage";
import type { HostedModel } from "../../../edition/types";

const opus: ModelPref = { modelId: "anthropic/claude-opus-5", reasoning: "high", maxTurns: 200 };

// A hosted tier as an edition would define one: a sentinel id, every role
// pinned to the host's upstream model.
const hostedPref: ModelPref = {
  modelId: "host-tier",
  reasoning: "medium",
  maxTurns: 200,
  visionModelId: "vendor/pinned",
  subagentModelId: "vendor/pinned",
  summaryModelId: "vendor/pinned",
};
const HOST: HostedModel = {
  id: "host-tier",
  name: "Host Tier",
  upstreamModelId: "vendor/pinned",
  modelPref: () => hostedPref,
  client: () => {
    throw new Error("not called in these tests");
  },
  LiveName: () => null,
  ChatIntro: () => null,
};

const withFallback = { hostedModels: [HOST], keylessFallback: HOST };
const noFallback = { hostedModels: [], keylessFallback: null };

describe("resolveRunningPref", () => {
  it("runs nothing when nothing is chosen", () => {
    for (const ed of [withFallback, noFallback]) {
      expect(resolveRunningPref(null, null, ed)).toEqual({ running: null, pendingModelId: null });
      expect(resolveRunningPref(null, "sk-or-k", ed)).toEqual({
        running: null,
        pendingModelId: null,
      });
    }
  });

  it("runs the chosen model when a key exists", () => {
    expect(resolveRunningPref(opus, "sk-or-k", withFallback)).toEqual({
      running: opus,
      pendingModelId: null,
    });
    expect(resolveRunningPref(opus, "sk-or-k", noFallback)).toEqual({
      running: opus,
      pendingModelId: null,
    });
  });

  it("runs a hosted model when it is the choice, key or no key", () => {
    expect(resolveRunningPref(hostedPref, null, withFallback)).toEqual({
      running: hostedPref,
      pendingModelId: null,
    });
    expect(resolveRunningPref(hostedPref, "sk-or-k", withFallback)).toEqual({
      running: hostedPref,
      pendingModelId: null,
    });
  });

  // Spencer, 2026-09-15: the choice is kept, the pane keeps working, and the
  // gap between the two is the incentive to add a key.
  it("keeps a keyless choice waiting and runs the fallback underneath it", () => {
    const { running, pendingModelId } = resolveRunningPref(opus, null, withFallback);
    expect(pendingModelId).toBe("anthropic/claude-opus-5");
    expect(running?.modelId).toBe("host-tier");
    // Every role is pinned to the host's model, exactly as a direct pick would be.
    expect(running?.visionModelId).toBe("vendor/pinned");
    expect(running?.subagentModelId).toBe("vendor/pinned");
    expect(running?.summaryModelId).toBe("vendor/pinned");
  });

  // The community edition: nothing hosted, so a keyless choice waits with
  // nothing running. The chat locks and only a key opens it.
  it("keeps a keyless choice waiting with nothing running when there is no fallback", () => {
    expect(resolveRunningPref(opus, null, noFallback)).toEqual({
      running: null,
      pendingModelId: "anthropic/claude-opus-5",
    });
  });

  it("treats an empty-string key as no key", () => {
    expect(resolveRunningPref(opus, "", withFallback).pendingModelId).toBe(
      "anthropic/claude-opus-5"
    );
  });
});

describe("pendingModelName", () => {
  const listed: ModelInfo = {
    id: "anthropic/claude-opus-5",
    name: "Anthropic: Claude Opus 5",
    contextLength: 1,
    pricing: { prompt: 0, completion: 0 },
    supportsTools: true,
    supportsReasoning: true,
    supportsVision: true,
    created: 1,
    family: "claude",
  };

  it("uses the catalogue's display name when the model is listed", () => {
    expect(pendingModelName([listed], listed.id)).toBe("Claude Opus 5");
  });

  it("falls back to the id's last segment when it is not", () => {
    expect(pendingModelName([], "vendor/some-model")).toBe("some-model");
  });
});
