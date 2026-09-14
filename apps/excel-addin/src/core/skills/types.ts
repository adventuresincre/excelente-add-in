/**
 * Open Agent Skills format (https://agentskills.io). Each skill is a folder
 * containing `SKILL.md` (uppercase per spec; `skill.md` lowercase is accepted
 * for backward compatibility) with YAML frontmatter + markdown body. Sibling
 * files / sub-folders (`references/`, `scripts/`, `assets/`) become resources
 * the agent loads on demand via `read_skill_resource`.
 */
export interface SkillFrontmatter {
  /** Stable identifier — used in the URL / file path. Lower-kebab-case. */
  name: string;
  /** One-sentence description shown to the agent and in the UI. */
  description: string;
  /** Free-form text describing when the agent should use this skill. */
  whenToUse?: string;
  version?: string;
  author?: string;
  /**
   * Tools this skill may call. Empty / undefined means "all tools the
   * orchestrator already has". When set, restricts the agent for the
   * lifetime of this skill's activation.
   */
  toolAllowlist?: string[];
}

export interface SkillSummary extends SkillFrontmatter {
  /** Identifier of the source that provided this skill (e.g. "bundled"). */
  sourceId: string;
}

export interface Skill {
  /** Summary fields, plus sourceId. */
  summary: SkillSummary;
  /** The markdown body of SKILL.md — instructions the agent follows. */
  body: string;
  /**
   * Resource files inside the skill folder, keyed by path relative to the
   * folder root (e.g., "references/cap-rate-ranges.md"). Excludes the
   * SKILL.md file itself. Loaded eagerly when the skill is loaded; the
   * agent reads individual entries on demand via `read_skill_resource`.
   */
  resources: Map<string, string>;
}

/**
 * A SkillSource produces skills. Phase 4 shipped bundled; Phase 8 adds
 * user-installed (IndexedDB) skills. Remote registry is future work.
 */
export interface SkillSource {
  /** Stable identifier (e.g. "bundled", "user", "registry:acre"). */
  id: string;
  /** Cheap listing — frontmatter only. */
  list(): Promise<SkillSummary[]>;
  /** Load full skill body + resources for one skill. */
  load(name: string): Promise<Skill>;
}
