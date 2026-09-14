import { describe, expect, it } from "vitest";
import { inMemoryDataSource } from "../context";
import type { Skill, SkillRegistry, SkillSummary } from "../skills";
import { createUndoStack } from "./undo";
import { findSkillTool, loadSkillTool, readSkillResourceTool } from "./skills";

function fakeSkill(
  name: string,
  resources: Record<string, string>,
  opts: { description?: string; whenToUse?: string; body?: string } = {}
): Skill {
  const summary: SkillSummary = {
    name,
    description: opts.description ?? `fake ${name}`,
    whenToUse: opts.whenToUse,
    sourceId: "test",
  };
  return {
    summary,
    body: opts.body ?? `# ${name}`,
    resources: new Map(Object.entries(resources)),
  };
}

function fakeRegistry(
  skills: Skill[],
  matchOverride?: (query: string, limit?: number) => SkillSummary[]
): SkillRegistry {
  const byName = new Map(skills.map((s) => [s.summary.name, s]));
  return {
    async list() {
      return skills.map((s) => s.summary);
    },
    async findByName(name) {
      return byName.get(name)?.summary ?? null;
    },
    async load(name) {
      const found = byName.get(name);
      if (!found) throw new Error(`Skill not found: ${name}`);
      return found;
    },
    async match(query, limit) {
      if (matchOverride) return matchOverride(query, limit);
      return [];
    },
  };
}

const baseCtx = () => ({
  ds: inMemoryDataSource({ sheets: [{ name: "Sheet1" }] }),
  undoStack: createUndoStack(),
});

describe("read_skill_resource", () => {
  it("returns the resource content when the path matches", async () => {
    const reg = fakeRegistry([
      fakeSkill("direct-cap-valuation", {
        "references/cap-rate-ranges.md": "## Multifamily\n5.0% – 7.5%",
      }),
    ]);
    const result = await readSkillResourceTool.execute(
      { skill: "direct-cap-valuation", path: "references/cap-rate-ranges.md" },
      { ...baseCtx(), skillRegistry: reg }
    );
    expect(result).toBe("## Multifamily\n5.0% – 7.5%");
  });

  it("throws with the list of available paths when the path is wrong", async () => {
    const reg = fakeRegistry([
      fakeSkill("direct-cap-valuation", {
        "references/cap-rate-ranges.md": "data",
        "assets/template.txt": "template",
      }),
    ]);
    await expect(
      readSkillResourceTool.execute(
        { skill: "direct-cap-valuation", path: "references/wrong.md" },
        { ...baseCtx(), skillRegistry: reg }
      )
    ).rejects.toThrow(
      /Resource not found in skill "direct-cap-valuation": "references\/wrong\.md".*assets\/template\.txt, references\/cap-rate-ranges\.md/
    );
  });

  it("throws with (none) when the skill has no resources", async () => {
    const reg = fakeRegistry([fakeSkill("plain-skill", {})]);
    await expect(
      readSkillResourceTool.execute(
        { skill: "plain-skill", path: "anything.md" },
        { ...baseCtx(), skillRegistry: reg }
      )
    ).rejects.toThrow(/\(none\)/);
  });

  it("throws if the skill registry is not provided in ToolContext", async () => {
    await expect(
      readSkillResourceTool.execute({ skill: "x", path: "y" }, baseCtx())
    ).rejects.toThrow(/skill registry not available/);
  });

  it("propagates load() errors from the registry (unknown skill)", async () => {
    const reg = fakeRegistry([]);
    await expect(
      readSkillResourceTool.execute(
        { skill: "missing", path: "any.md" },
        { ...baseCtx(), skillRegistry: reg }
      )
    ).rejects.toThrow(/Skill not found: missing/);
  });

  it("is read-only (no approval gate)", () => {
    expect(readSkillResourceTool.requiredPermission).toBe("Read");
  });
});

describe("find_skill", () => {
  it("returns top matches with name + description + whenToUse only (no bodies)", async () => {
    const skills = [
      fakeSkill(
        "direct-cap-valuation",
        {},
        {
          description: "Value a stabilized property",
          whenToUse: "User asks for cap rate valuation",
          body: "FULL BODY THAT SHOULD NOT APPEAR",
        }
      ),
      fakeSkill(
        "dcf-modeling",
        {},
        {
          description: "Build a DCF",
          whenToUse: "User asks for DCF / IRR",
        }
      ),
    ];
    const reg = fakeRegistry(skills, () => [skills[0].summary, skills[1].summary]);

    const result = await findSkillTool.execute(
      { query: "value this property" },
      { ...baseCtx(), skillRegistry: reg }
    );

    expect(result.matches).toEqual([
      {
        name: "direct-cap-valuation",
        description: "Value a stabilized property",
        whenToUse: "User asks for cap rate valuation",
      },
      {
        name: "dcf-modeling",
        description: "Build a DCF",
        whenToUse: "User asks for DCF / IRR",
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("FULL BODY");
  });

  it("respects the limit parameter (default 5)", async () => {
    const recorded: Array<{ query: string; limit?: number }> = [];
    const reg = fakeRegistry([], (query, limit) => {
      recorded.push({ query, limit });
      return [];
    });

    await findSkillTool.execute({ query: "anything" }, { ...baseCtx(), skillRegistry: reg });
    expect(recorded[0].limit).toBe(5);

    await findSkillTool.execute(
      { query: "anything", limit: 3 },
      { ...baseCtx(), skillRegistry: reg }
    );
    expect(recorded[1].limit).toBe(3);
  });

  it("returns { matches: [] } when no skill matches — agent proceeds without one", async () => {
    const reg = fakeRegistry([fakeSkill("unrelated", {})], () => []);
    const result = await findSkillTool.execute(
      { query: "no matches here" },
      { ...baseCtx(), skillRegistry: reg }
    );
    expect(result.matches).toEqual([]);
  });

  it("throws if the skill registry is not provided", async () => {
    await expect(findSkillTool.execute({ query: "x" }, baseCtx())).rejects.toThrow(
      /skill registry not available/
    );
  });

  it("is read-only (no approval gate)", () => {
    expect(findSkillTool.requiredPermission).toBe("Read");
  });
});

describe("load_skill", () => {
  it("returns the full body plus resource path list", async () => {
    const reg = fakeRegistry([
      fakeSkill(
        "direct-cap-valuation",
        {
          "references/cap-rate-ranges.md": "## Multifamily",
          "assets/template.txt": "...",
        },
        {
          description: "Value a stabilized property",
          whenToUse: "User asks for cap rate valuation",
          body: "# Direct Cap Playbook\n\nStep 1...",
        }
      ),
    ]);

    const result = await loadSkillTool.execute(
      { name: "direct-cap-valuation" },
      { ...baseCtx(), skillRegistry: reg }
    );

    expect(result).toEqual({
      name: "direct-cap-valuation",
      description: "Value a stabilized property",
      whenToUse: "User asks for cap rate valuation",
      body: "# Direct Cap Playbook\n\nStep 1...",
      resources: ["assets/template.txt", "references/cap-rate-ranges.md"],
    });
  });

  it("returns an empty resources list when the skill has none", async () => {
    const reg = fakeRegistry([fakeSkill("plain", {})]);
    const result = await loadSkillTool.execute(
      { name: "plain" },
      { ...baseCtx(), skillRegistry: reg }
    );
    expect(result.resources).toEqual([]);
  });

  it("propagates load() errors for unknown skill names", async () => {
    const reg = fakeRegistry([]);
    await expect(
      loadSkillTool.execute({ name: "missing" }, { ...baseCtx(), skillRegistry: reg })
    ).rejects.toThrow(/Skill not found: missing/);
  });

  it("throws if the skill registry is not provided", async () => {
    await expect(loadSkillTool.execute({ name: "x" }, baseCtx())).rejects.toThrow(
      /skill registry not available/
    );
  });

  it("is read-only (no approval gate)", () => {
    expect(loadSkillTool.requiredPermission).toBe("Read");
  });
});
