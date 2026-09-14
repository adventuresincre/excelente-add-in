import { describe, expect, it } from "vitest";
import { BUNDLED_SOURCE_ID, bundledSkillSource } from "./bundled";

const sampleFile = `---
name: my-skill
description: A test skill
when-to-use: Whenever the user asks for the test
version: 1.0.0
---

# Body

Some markdown body.
`;

describe("bundledSkillSource", () => {
  it("lists skills found in the injected files map", async () => {
    const src = bundledSkillSource({
      skill: { "/abs/path/skills/my-skill/SKILL.md": sampleFile },
    });
    const list = await src.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      name: "my-skill",
      description: "A test skill",
      whenToUse: "Whenever the user asks for the test",
      version: "1.0.0",
      sourceId: BUNDLED_SOURCE_ID,
    });
  });

  it("loads the body + empty resources map for a known skill", async () => {
    const src = bundledSkillSource({
      skill: { "/abs/path/skills/my-skill/SKILL.md": sampleFile },
    });
    const skill = await src.load("my-skill");
    expect(skill.summary.name).toBe("my-skill");
    expect(skill.body).toContain("# Body");
    expect(skill.body).toContain("Some markdown body.");
    expect(skill.resources).toBeInstanceOf(Map);
    expect(skill.resources.size).toBe(0);
  });

  it("accepts lowercase skill.md for backward compatibility", async () => {
    const src = bundledSkillSource({
      skill: { "/abs/path/skills/my-skill/skill.md": sampleFile },
    });
    const list = await src.list();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("my-skill");
  });

  it("prefers SKILL.md when both casings exist in the same folder", async () => {
    const src = bundledSkillSource({
      skill: {
        "/abs/path/skills/my-skill/skill.md": sampleFile.replace("my-skill", "lowercase-wins"),
        "/abs/path/skills/my-skill/SKILL.md": sampleFile,
      },
    });
    const list = await src.list();
    // SKILL.md should win, so name = "my-skill" (not "lowercase-wins")
    expect(list.map((s) => s.name)).toEqual(["my-skill"]);
  });

  it("attaches resource files keyed by their path relative to the skill folder", async () => {
    const src = bundledSkillSource({
      skill: { "/abs/path/skills/my-skill/SKILL.md": sampleFile },
      resources: {
        "/abs/path/skills/my-skill/references/cap-rates.md": "## Cap Rates\nrange data",
        "/abs/path/skills/my-skill/assets/example.txt": "example content",
      },
    });
    const skill = await src.load("my-skill");
    expect(skill.resources.size).toBe(2);
    expect(skill.resources.get("references/cap-rates.md")).toContain("## Cap Rates");
    expect(skill.resources.get("assets/example.txt")).toBe("example content");
  });

  it("excludes the SKILL.md / skill.md itself from resources", async () => {
    const src = bundledSkillSource({
      skill: { "/abs/path/skills/my-skill/SKILL.md": sampleFile },
      resources: {
        // Even if a resources glob accidentally picks up the skill file, we filter it.
        "/abs/path/skills/my-skill/SKILL.md": sampleFile,
        "/abs/path/skills/my-skill/skill.md": sampleFile,
        "/abs/path/skills/my-skill/references/keep.md": "keep me",
      },
    });
    const skill = await src.load("my-skill");
    expect(skill.resources.size).toBe(1);
    expect(skill.resources.has("references/keep.md")).toBe(true);
  });

  it("throws for an unknown skill", async () => {
    const src = bundledSkillSource({ skill: {} });
    await expect(src.load("missing")).rejects.toThrow(/not found/);
  });

  it("skips files outside the expected /skills/<folder>/SKILL.md shape", async () => {
    const src = bundledSkillSource({
      skill: {
        "/some/unrelated/path.md": sampleFile,
        "/abs/path/skills/ok/SKILL.md": sampleFile.replace("my-skill", "ok"),
      },
    });
    const list = await src.list();
    expect(list.map((s) => s.name)).toEqual(["ok"]);
  });

  it("logs a warning when the folder name doesn't match the frontmatter name", async () => {
    const warnings: string[] = [];
    const orig = console.warn;
    console.warn = (...args) => warnings.push(args.join(" "));
    try {
      bundledSkillSource({
        skill: { "/abs/path/skills/wrong-folder/SKILL.md": sampleFile },
      });
    } finally {
      console.warn = orig;
    }
    expect(warnings.some((w) => w.includes("wrong-folder"))).toBe(true);
    expect(warnings.some((w) => w.includes("my-skill"))).toBe(true);
  });

  it("skips and warns when frontmatter is malformed", async () => {
    const warnings: string[] = [];
    const orig = console.warn;
    console.warn = (...args) => warnings.push(args.join(" "));
    try {
      const src = bundledSkillSource({
        skill: { "/abs/path/skills/bad/SKILL.md": "no frontmatter here" },
      });
      const list = await src.list();
      expect(list).toEqual([]);
    } finally {
      console.warn = orig;
    }
    expect(warnings.some((w) => w.includes("bad"))).toBe(true);
  });
});

describe("bundledSkillSource — production globs", () => {
  // The loader globs the skills directory, so the set varies by build: a
  // distribution may bundle skills whose license does not allow them to be
  // redistributed here (see skills/LICENSE.md). Assert the floor instead of
  // an exact list, so a renamed or dropped core skill still fails the build
  // and an added one does not.
  it("includes the core skill set", async () => {
    const src = bundledSkillSource();
    const names = (await src.list()).map((s) => s.name).sort();
    expect(names).toEqual(
      expect.arrayContaining([
        "cre-modeling-conventions",
        "excel-native-method",
        "formula-audit",
        "office-js-patterns",
        "verify-model-outputs",
      ])
    );
  });

  it("each bundled skill has a non-empty body", async () => {
    const src = bundledSkillSource();
    for (const summary of await src.list()) {
      const full = await src.load(summary.name);
      expect(full.body.length).toBeGreaterThan(100);
    }
  });
});
