import { describe, expect, it } from "vitest";
import { PLAN_MODE_PROMPT, WORK_MODE_PROMPT } from "./index";

describe("mode prompts", () => {
  it("plan-mode prompt loads from markdown and is non-trivial", () => {
    expect(PLAN_MODE_PROMPT).toContain("Plan mode");
    expect(PLAN_MODE_PROMPT).toContain("submit_plan");
    expect(PLAN_MODE_PROMPT.length).toBeGreaterThan(200);
  });

  it("work-mode prompt loads from markdown and references plan execution", () => {
    expect(WORK_MODE_PROMPT).toContain("Work mode");
    expect(WORK_MODE_PROMPT).toContain("update_plan_step");
    expect(WORK_MODE_PROMPT.length).toBeGreaterThan(200);
  });

  it("prompts are distinct (no copy-paste error)", () => {
    expect(PLAN_MODE_PROMPT).not.toBe(WORK_MODE_PROMPT);
  });
});
