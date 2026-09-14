import { describe, expect, it } from "vitest";
import { CORE_SKILL_NAMES, ALWAYS_INJECTED_CORE_SKILL, isCoreSkill } from "./core-skills";

describe("core skills", () => {
  it("contains the three foundational bundled skills", () => {
    // Locked in so a future commit can't accidentally remove a core skill
    // without the test author consciously updating the list.
    expect(CORE_SKILL_NAMES.has("cre-modeling-conventions")).toBe(true);
    expect(CORE_SKILL_NAMES.has("office-js-patterns")).toBe(true);
    expect(CORE_SKILL_NAMES.has("verify-model-outputs")).toBe(true);
  });

  it("the always-injected core skill is cre-modeling-conventions and is a core skill", () => {
    expect(ALWAYS_INJECTED_CORE_SKILL).toBe("cre-modeling-conventions");
    expect(CORE_SKILL_NAMES.has(ALWAYS_INJECTED_CORE_SKILL)).toBe(true);
  });

  it("returns true from isCoreSkill for core names", () => {
    expect(isCoreSkill("cre-modeling-conventions")).toBe(true);
    expect(isCoreSkill("office-js-patterns")).toBe(true);
    expect(isCoreSkill("verify-model-outputs")).toBe(true);
  });

  it("returns false for non-core / unknown skill names", () => {
    expect(isCoreSkill("formula-audit")).toBe(false); // user-visible bundled, not core
    expect(isCoreSkill("user-uploaded-skill")).toBe(false);
    expect(isCoreSkill("")).toBe(false);
  });
});
