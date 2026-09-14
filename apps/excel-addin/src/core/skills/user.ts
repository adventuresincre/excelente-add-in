import type { SkillStore } from "./store";
import type { Skill, SkillSource, SkillSummary } from "./types";

export const USER_SOURCE_ID = "user";

/**
 * `SkillSource` backed by a `SkillStore` (typically IndexedDB). Each call
 * fetches the current contents — there's no in-memory cache so a freshly
 * installed skill shows up on the next `list()`.
 */
export function userSkillSource(store: SkillStore): SkillSource {
  return {
    id: USER_SOURCE_ID,
    async list() {
      const records = await store.list();
      return records.map<SkillSummary>((r) => ({
        ...r.frontmatter,
        sourceId: USER_SOURCE_ID,
      }));
    },
    async load(name) {
      const record = await store.get(name);
      if (!record) throw new Error(`User skill not found: ${name}`);
      const resources = new Map<string, string>();
      for (const [k, v] of Object.entries(record.resources)) {
        resources.set(k, v);
      }
      return {
        summary: { ...record.frontmatter, sourceId: USER_SOURCE_ID },
        body: record.body,
        resources,
      } satisfies Skill;
    },
  };
}
