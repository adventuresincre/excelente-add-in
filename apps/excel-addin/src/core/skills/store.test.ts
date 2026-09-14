import { describe, expect, it } from "vitest";
import { createInMemorySkillStore } from "./store-memory";
import type { StoredSkill } from "./store";

function makeSkill(name: string, overrides: Partial<StoredSkill> = {}): StoredSkill {
  return {
    name,
    frontmatter: { name, description: `Test ${name}` },
    body: `# ${name}`,
    resources: {},
    installedAt: Date.now(),
    ...overrides,
  };
}

describe("SkillStore (in-memory)", () => {
  it("put + get round-trips a skill", async () => {
    const store = createInMemorySkillStore();
    const skill = makeSkill("foo");
    await store.put(skill);
    expect(await store.get("foo")).toEqual(skill);
  });

  it("get returns null for unknown names", async () => {
    const store = createInMemorySkillStore();
    expect(await store.get("nope")).toBeNull();
  });

  it("list returns insertion order with most-recent puts at the tail", async () => {
    const store = createInMemorySkillStore();
    await store.put(makeSkill("a"));
    await store.put(makeSkill("b"));
    await store.put(makeSkill("c"));
    const names = (await store.list()).map((s) => s.name);
    expect(names).toEqual(["a", "b", "c"]);
  });

  it("put on existing name replaces and re-orders to tail", async () => {
    const store = createInMemorySkillStore();
    await store.put(makeSkill("a"));
    await store.put(makeSkill("b"));
    await store.put(makeSkill("a", { body: "# updated" }));
    const items = await store.list();
    expect(items.map((s) => s.name)).toEqual(["b", "a"]);
    expect(items[1].body).toBe("# updated");
  });

  it("delete removes a skill; second delete is a no-op", async () => {
    const store = createInMemorySkillStore();
    await store.put(makeSkill("a"));
    await store.delete("a");
    expect(await store.get("a")).toBeNull();
    await store.delete("a"); // no-throw
  });

  it("seed pre-populates the store", async () => {
    const store = createInMemorySkillStore([makeSkill("a"), makeSkill("b")]);
    expect((await store.list()).map((s) => s.name)).toEqual(["a", "b"]);
  });
});
