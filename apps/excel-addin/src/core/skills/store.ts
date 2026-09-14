import type { SkillFrontmatter } from "./types";

/**
 * Persisted form of a user-installed skill. We keep `resources` as a plain
 * Record so it serializes cleanly to IndexedDB (Maps would need conversion
 * on every read).
 */
export interface StoredSkill {
  /** The skill's `name` from SKILL.md frontmatter — also the IndexedDB key. */
  name: string;
  /** Full frontmatter as parsed. */
  frontmatter: SkillFrontmatter;
  /** Markdown body of SKILL.md (everything after the frontmatter block). */
  body: string;
  /** Resource files keyed by path relative to the skill folder root. */
  resources: Record<string, string>;
  /** Unix milliseconds when the skill was installed. */
  installedAt: number;
  /** Optional: the original zip filename, for display. */
  filename?: string;
}

/**
 * Storage abstraction for user-installed skills. The production
 * implementation is IndexedDB-backed; tests use the in-memory variant.
 */
export interface SkillStore {
  /** All installed skills, oldest first. */
  list(): Promise<StoredSkill[]>;
  /** One skill by `name`, or `null` if not installed. */
  get(name: string): Promise<StoredSkill | null>;
  /** Insert or replace. Replaces silently if `name` already exists. */
  put(skill: StoredSkill): Promise<void>;
  /** Remove by `name`. No-op if not present. */
  delete(name: string): Promise<void>;
}
