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
const ENTITLED: ReadonlySet<string> = new Set(["host-tier"]);
const NOBODY: ReadonlySet<string> = new Set();

describe("resolveRunningPref", () => {
  it("runs nothing when nothing is chosen", () => {
    for (const ed of [withFallback, noFallback]) {
      expect(resolveRunningPref(null, null, ed, ENTITLED)).toEqual({
        running: null,
        pendingModelId: null,
        pendingReason: null,
      });
    }
  });

  it("runs the chosen model when a key exists", () => {
    expect(resolveRunningPref(opus, "sk-or-k", withFallback, NOBODY)).toEqual({
      running: opus,
      pendingModelId: null,
      pendingReason: null,
    });
  });

  it("runs a hosted model when it is the choice and the user is entitled, key or no key", () => {
    expect(resolveRunningPref(hostedPref, null, withFallback, ENTITLED).running).toBe(hostedPref);
    expect(resolveRunningPref(hostedPref, "sk-or-k", withFallback, ENTITLED).running).toBe(
      hostedPref
    );
  });

  // The membership lapsed (disconnected, revoked). The choice is kept, nothing
  // runs, and the notice points at the memberships section.
  it("keeps a hosted choice waiting on a membership when the user is not entitled", () => {
    expect(resolveRunningPref(hostedPref, "sk-or-k", withFallback, NOBODY)).toEqual({
      running: null,
      pendingModelId: "host-tier",
      pendingReason: "membership",
    });
  });

  // Spencer, 2026-09-15: the choice is kept, the pane keeps working, and the
  // gap between the two is the incentive to add a key.
  it("keeps a keyless choice waiting and runs the fallback underneath it, for an entitled user", () => {
    const { running, pendingModelId, pendingReason } = resolveRunningPref(
      opus,
      null,
      withFallback,
      ENTITLED
    );
    expect(pendingModelId).toBe("anthropic/claude-opus-5");
    expect(pendingReason).toBe("key");
    expect(running?.modelId).toBe("host-tier");
    expect(running?.visionModelId).toBe("vendor/pinned");
  });

  // Not a member: the fallback exists in the edition but is not theirs to
  // use, so nothing runs. Same shape as the community edition.
  it("runs nothing under a keyless choice when the user is not entitled to the fallback", () => {
    expect(resolveRunningPref(opus, null, withFallback, NOBODY)).toEqual({
      running: null,
      pendingModelId: "anthropic/claude-opus-5",
      pendingReason: "key",
    });
    expect(resolveRunningPref(opus, null, noFallback, NOBODY)).toEqual({
      running: null,
      pendingModelId: "anthropic/claude-opus-5",
      pendingReason: "key",
    });
  });

  it("treats an empty-string key as no key", () => {
    expect(resolveRunningPref(opus, "", withFallback, ENTITLED).pendingReason).toBe("key");
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
  const hostedRow: ModelInfo = {
    ...listed,
    id: "host-tier",
    name: "Host Tier (Pinned)",
    hosted: { lab: "Host", groupKey: "host", groupLabel: "Host" },
  };

  it("uses the catalogue's display name when the model is listed", () => {
    expect(pendingModelName([listed], listed.id)).toBe("Claude Opus 5");
  });

  it("names a hosted row from the edition's rows", () => {
    expect(pendingModelName([listed], "host-tier", [hostedRow])).toBe("Host Tier (Pinned)");
  });

  it("falls back to the id's last segment when it is not listed", () => {
    expect(pendingModelName([], "vendor/some-model")).toBe("some-model");
  });
});
