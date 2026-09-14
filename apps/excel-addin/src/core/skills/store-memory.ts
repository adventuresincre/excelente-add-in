import type { SkillStore, StoredSkill } from "./store";

/**
 * In-memory `SkillStore` used by tests and as a fallback when IndexedDB
 * is unavailable. Preserves insertion order so `list()` returns oldest
 * first, matching the IndexedDB impl.
 */
export function createInMemorySkillStore(seed?: StoredSkill[]): SkillStore {
  const data = new Map<string, StoredSkill>();
  if (seed) {
    for (const s of seed) data.set(s.name, s);
  }
  return {
    async list() {
      return Array.from(data.values());
    },
    async get(name) {
      return data.get(name) ?? null;
    },
    async put(skill) {
      // Re-insert at the tail so updates keep "most recent" semantics.
      data.delete(skill.name);
      data.set(skill.name, skill);
    },
    async delete(name) {
      data.delete(name);
    },
  };
}
