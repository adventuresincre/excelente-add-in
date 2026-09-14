import { describe, expect, it } from "vitest";
import { createInMemorySkillStore } from "./store-memory";
import type { StoredSkill } from "./store";
import { userSkillSource, USER_SOURCE_ID } from "./user";

function makeStored(name: string, extras?: Partial<StoredSkill>): StoredSkill {
  return {
    name,
    frontmatter: {
      name,
      description: `desc for ${name}`,
      whenToUse: `when ${name}`,
      version: "1.0.0",
      author: "tester",
    },
    body: `# ${name}`,
    resources: {},
    installedAt: 1234,
    ...extras,
  };
}

describe("userSkillSource", () => {
  it("lists empty when store is empty", async () => {
    const src = userSkillSource(createInMemorySkillStore());
    expect(await src.list()).toEqual([]);
  });

  it("list maps stored skills to summaries with sourceId = user", async () => {
    const src = userSkillSource(createInMemorySkillStore([makeStored("alpha")]));
    const list = await src.list();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("alpha");
    expect(list[0].sourceId).toBe(USER_SOURCE_ID);
    expect(list[0].whenToUse).toBe("when alpha");
  });

  it("load returns body + resources as a Map", async () => {
    const stored = makeStored("alpha", {
      resources: { "ref/a.md": "hello", "ref/b.md": "world" },
    });
    const src = userSkillSource(createInMemorySkillStore([stored]));
    const skill = await src.load("alpha");
    expect(skill.body).toBe("# alpha");
    expect(skill.summary.sourceId).toBe(USER_SOURCE_ID);
    expect(skill.resources).toBeInstanceOf(Map);
    expect(skill.resources.get("ref/a.md")).toBe("hello");
    expect(skill.resources.get("ref/b.md")).toBe("world");
  });

  it("load throws for unknown name", async () => {
    const src = userSkillSource(createInMemorySkillStore());
    await expect(src.load("missing")).rejects.toThrow(/not found/i);
  });
});
