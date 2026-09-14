import { describe, expect, it } from "vitest";
import { createSkillRegistry } from "./registry";
import type { Skill, SkillSource, SkillSummary } from "./types";

function memSource(id: string, skills: Skill[]): SkillSource {
  return {
    id,
    async list() {
      return skills.map((s) => s.summary);
    },
    async load(name) {
      const found = skills.find((s) => s.summary.name === name);
      if (!found) throw new Error(`Skill not found: ${name}`);
      return found;
    },
  };
}

function fakeSkill(name: string, description: string, whenToUse?: string, body = ""): Skill {
  const summary: SkillSummary = {
    name,
    description,
    whenToUse,
    sourceId: "test",
  };
  return { summary, body, resources: new Map<string, string>() };
}

describe("createSkillRegistry", () => {
  it("lists skills from every source", async () => {
    const a = memSource("a", [fakeSkill("alpha", "First")]);
    const b = memSource("b", [fakeSkill("beta", "Second")]);
    const reg = createSkillRegistry([a, b]);
    const names = (await reg.list()).map((s) => s.name);
    expect(names.sort()).toEqual(["alpha", "beta"]);
  });

  it("findByName returns null when no source has it", async () => {
    const reg = createSkillRegistry([memSource("a", [fakeSkill("x", "x")])]);
    expect(await reg.findByName("missing")).toBeNull();
    expect((await reg.findByName("x"))?.name).toBe("x");
  });

  it("load() delegates to the source that owns the skill", async () => {
    const a = memSource("a", [fakeSkill("alpha", "From A", undefined, "BODY A")]);
    const b = memSource("b", [fakeSkill("beta", "From B", undefined, "BODY B")]);
    const reg = createSkillRegistry([a, b]);
    expect((await reg.load("alpha")).body).toBe("BODY A");
    expect((await reg.load("beta")).body).toBe("BODY B");
    await expect(reg.load("missing")).rejects.toThrow(/not found/);
  });

  it("match() ranks by keyword overlap on description + whenToUse + name", async () => {
    const source = memSource("a", [
      fakeSkill(
        "direct-cap-valuation",
        "Value a stabilized property by Direct Capitalization",
        "User asks to value a property using direct cap or NOI"
      ),
      fakeSkill(
        "formula-audit",
        "Trace and explain formulas in a sheet",
        "User asks why a number is wrong"
      ),
      fakeSkill(
        "dcf-modeling",
        "Build a discounted cash flow model",
        "User asks for DCF, IRR, multi-period valuation"
      ),
    ]);
    const reg = createSkillRegistry([source]);

    const direct = await reg.match("Help me value this property by direct cap");
    expect(direct[0].name).toBe("direct-cap-valuation");

    const dcf = await reg.match("I need a discounted cash flow with IRR");
    expect(dcf[0].name).toBe("dcf-modeling");

    const audit = await reg.match("trace why this formula gives the wrong number");
    expect(audit[0].name).toBe("formula-audit");
  });

  it("match() returns [] when no skill scores above zero", async () => {
    const reg = createSkillRegistry([
      memSource("a", [fakeSkill("x", "completely unrelated stuff")]),
    ]);
    expect(await reg.match("xyzzy")).toEqual([]);
  });

  it("match() respects limit", async () => {
    const reg = createSkillRegistry([
      memSource("a", [
        fakeSkill("one", "value direct cap"),
        fakeSkill("two", "value direct cap"),
        fakeSkill("three", "value direct cap"),
      ]),
    ]);
    expect(await reg.match("value direct cap", 2)).toHaveLength(2);
  });

  it("match() prefers skills with a rare-term hit over a generic-term hit (IDF)", async () => {
    // "build" appears in every skill, so it should carry little weight.
    // "monte-carlo" is unique to one skill — that skill should win even
    // though both candidates have one query-term match.
    const reg = createSkillRegistry([
      memSource("a", [
        fakeSkill(
          "monte-carlo-sim",
          "Build a Monte Carlo simulation for risk analysis",
          "User asks to run Monte Carlo / probabilistic scenarios"
        ),
        fakeSkill("build-thing-a", "Build a thing for category A", "User asks to build a thing"),
        fakeSkill("build-thing-b", "Build a thing for category B", "User asks to build a thing"),
        fakeSkill("build-thing-c", "Build a thing for category C", "User asks to build a thing"),
      ]),
    ]);

    const ranked = await reg.match("build monte carlo");
    expect(ranked[0].name).toBe("monte-carlo-sim");
  });

  it("match() recall test: 90%+ of paraphrased prompts surface the right skill in top-3", async () => {
    const reg = createSkillRegistry([
      memSource("a", [
        fakeSkill(
          "direct-cap-valuation",
          "Value a stabilized commercial property by direct capitalization (NOI / cap rate)",
          "User asks to value a deal using direct cap, NOI divided by cap rate, or quick property pricing"
        ),
        fakeSkill(
          "dcf-modeling",
          "Build a multi-period discounted cash flow model with IRR and equity multiple",
          "User asks for DCF, IRR, multi-year projection, unlevered or levered returns"
        ),
        fakeSkill(
          "formula-audit",
          "Trace and explain formulas to find errors or inconsistencies in a workbook",
          "User asks why a number is wrong, to audit formulas, or to debug a model"
        ),
        fakeSkill(
          "rent-roll-cleanup",
          "Clean up and normalize a rent roll for analysis",
          "User asks to tidy a rent roll, fix tenant data, normalize lease dates"
        ),
      ]),
    ]);

    const cases: Array<{ prompt: string; expected: string }> = [
      // direct-cap variants
      { prompt: "price this deal", expected: "direct-cap-valuation" },
      { prompt: "what's it worth at a 6 cap", expected: "direct-cap-valuation" },
      { prompt: "value the property", expected: "direct-cap-valuation" },
      {
        prompt: "give me a quick valuation by NOI divided by cap rate",
        expected: "direct-cap-valuation",
      },
      { prompt: "direct capitalization", expected: "direct-cap-valuation" },
      // dcf variants
      { prompt: "build a 10-year DCF", expected: "dcf-modeling" },
      { prompt: "I want IRR and equity multiple", expected: "dcf-modeling" },
      { prompt: "multi-period discounted cash flow projection", expected: "dcf-modeling" },
      { prompt: "unlevered returns analysis", expected: "dcf-modeling" },
      // audit variants
      { prompt: "trace why this number is wrong", expected: "formula-audit" },
      { prompt: "debug the formulas on Sheet1", expected: "formula-audit" },
      { prompt: "audit the model", expected: "formula-audit" },
      { prompt: "explain this formula error", expected: "formula-audit" },
      // rent roll variants
      { prompt: "tidy up the rent roll", expected: "rent-roll-cleanup" },
      { prompt: "normalize tenant data", expected: "rent-roll-cleanup" },
      { prompt: "clean up lease dates", expected: "rent-roll-cleanup" },
    ];

    let hits = 0;
    for (const { prompt, expected } of cases) {
      const ranked = await reg.match(prompt, 3);
      if (ranked.some((s) => s.name === expected)) hits++;
    }
    const recall = hits / cases.length;
    expect(recall).toBeGreaterThanOrEqual(0.9);
  });

  it("list() keeps healthy sources when one source rejects", async () => {
    const dead: SkillSource = {
      id: "dead",
      async list() {
        throw new Error("The database connection is closing.");
      },
      async load() {
        throw new Error("should not load from dead source");
      },
    };
    const live = memSource("live", [fakeSkill("office-js-patterns", "Office.js patterns")]);
    const reg = createSkillRegistry([live, dead]);
    expect((await reg.list()).map((s) => s.name)).toEqual(["office-js-patterns"]);
    expect((await reg.findByName("office-js-patterns"))?.name).toBe("office-js-patterns");
    expect((await reg.load("office-js-patterns")).summary.name).toBe("office-js-patterns");
  });

  it("load() still finds a later source when an earlier source's list() throws", async () => {
    const dead: SkillSource = {
      id: "dead",
      async list() {
        throw new Error("The database connection is closing.");
      },
      async load() {
        throw new Error("should not load from dead source");
      },
    };
    const live = memSource("live", [fakeSkill("verify-model-outputs", "Reviewer playbook")]);
    const reg = createSkillRegistry([dead, live]);
    expect((await reg.load("verify-model-outputs")).summary.name).toBe("verify-model-outputs");
  });
});
