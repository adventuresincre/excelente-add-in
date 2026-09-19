import { describe, expect, it } from "vitest";
import { roleOverride } from "./useAgentStream";
import type { HostedModel } from "../../../edition/types";

// A hosted tier: sentinel "host-tier", pinned upstream to "vendor/pinned".
const HOST: HostedModel = {
  id: "host-tier",
  name: "Host Tier",
  upstreamModelId: "vendor/pinned",
  modelPref: () => ({ modelId: "host-tier", reasoning: "medium", maxTurns: 200 }),
  client: () => {
    throw new Error("not called in these tests");
  },
  LiveName: () => null,
  ChatIntro: () => null,
};
const hosted = [HOST];

describe("roleOverride", () => {
  it("passes a real BYOK override through, resolved", () => {
    expect(roleOverride("anthropic/claude-opus-4-7", hosted, null)).toBe(
      "anthropic/claude-opus-4-7"
    );
    expect(roleOverride("anthropic/claude-opus-4-7", hosted, HOST)).toBe(
      "anthropic/claude-opus-4-7"
    );
    expect(roleOverride("anthropic/claude-opus-4-7", [], null)).toBe("anthropic/claude-opus-4-7");
  });

  it("treats an unset role as no override", () => {
    expect(roleOverride(null, hosted, null)).toBeUndefined();
    expect(roleOverride(undefined, hosted, HOST)).toBeUndefined();
    expect(roleOverride("", hosted, HOST)).toBeUndefined();
  });

  // A hosted tier's modelPref writes the pinned model into every role id.
  // Reading that back as a user override would route the host's model to the
  // user's own OpenRouter key and bill them for what the host is paying for.
  it("does NOT treat the host's pin as an override on the hosted primary", () => {
    expect(roleOverride("vendor/pinned", hosted, HOST)).toBeUndefined();
    expect(roleOverride("host-tier", hosted, HOST)).toBeUndefined();
  });

  // A BYOK user really can choose the same model the host pins (it may well
  // be a shipped default for a role) and must keep paying for it themselves.
  it("keeps the same id as a real override for a BYOK primary", () => {
    expect(roleOverride("vendor/pinned", hosted, null)).toBe("vendor/pinned");
  });

  // A stored sentinel on a BYOK primary is an edge case, but it must never
  // reach OpenRouter as-is.
  it("resolves a hosted sentinel to its upstream id on a BYOK primary", () => {
    expect(roleOverride("host-tier", hosted, null)).toBe("vendor/pinned");
  });
});
