import { describe, expect, it } from "vitest";
import { roleOverride } from "./useAgentStream";
import { ACRE_FREE_OPENROUTER_ID, ACRE_FREE_SENTINEL_ID } from "../../../core/config";

describe("roleOverride", () => {
  it("passes a real BYOK override through, resolved", () => {
    expect(roleOverride("anthropic/claude-opus-4-7", false)).toBe("anthropic/claude-opus-4-7");
    expect(roleOverride("anthropic/claude-opus-4-7", true)).toBe("anthropic/claude-opus-4-7");
  });

  it("treats an unset role as no override", () => {
    expect(roleOverride(null, false)).toBeUndefined();
    expect(roleOverride(undefined, true)).toBeUndefined();
    expect(roleOverride("", true)).toBeUndefined();
  });

  // acreFreeModelPref writes the pinned model into every role id. Reading
  // that back as a user override would route A.CRE's model to the user's own
  // OpenRouter key and bill them for what A.CRE is paying for.
  it("does NOT treat the A.CRE Free pin as an override on A.CRE Free", () => {
    expect(roleOverride(ACRE_FREE_OPENROUTER_ID, true)).toBeUndefined();
    expect(roleOverride(ACRE_FREE_SENTINEL_ID, true)).toBeUndefined();
  });

  // A BYOK user really can choose glm-5.3-flash for summarization — it is
  // the shipped default for that role — and must keep paying for it himself.
  it("keeps the same id as a real override for a BYOK primary", () => {
    expect(roleOverride(ACRE_FREE_OPENROUTER_ID, false)).toBe(ACRE_FREE_OPENROUTER_ID);
  });
});
