/**
 * Core skills are bundled with the Excelente add-in and shape the agent's
 * baseline competence. They're hidden from the Skills tab — the user doesn't
 * see or manage them — and they're always discoverable / loadable by the
 * agent regardless of session state.
 *
 * Two ways the agent reaches a core skill:
 *   1. We inject a short summary index (name + description + whenToUse) into
 *      the system prompt so the model knows they exist without needing a
 *      find_skill call. Cheap (~200 tokens flat) and ensures the foundational
 *      patterns are always top-of-mind.
 *   2. The model can also call find_skill + load_skill normally, same as for
 *      user skills.
 *
 * Updating this list:
 *   - Adding a name here marks the existing bundled skill (under
 *     `apps/excel-addin/skills/<name>/`) as core. The skill file itself
 *     doesn't need any changes — just put the name in this Set.
 *   - User-uploaded skills with the same name are NOT promoted to core;
 *     core status is controlled by us, not metadata.
 *   - Names must match the `name:` field in the skill's SKILL.md frontmatter
 *     (which is also the bundled-skill directory name).
 */
export const CORE_SKILL_NAMES = new Set<string>([
  "cre-modeling-conventions",
  "office-js-patterns",
  "verify-model-outputs",
]);

/**
 * The one core skill injected IN FULL (body, not just summary) into every
 * system prompt — the operating-principles doc that applies to every model
 * build, analogous to a coding agent's always-present AGENTS.md. Lazy
 * summary-then-load left it to the model to decide to fetch it, and weak
 * models routinely skipped it. The other core skills (office-js-patterns,
 * verify-model-outputs) stay lazy — they're genuinely conditional
 * (scripting / Reviewer-only).
 *
 * Short + stable → it caches cleanly behind the system-prompt cache
 * breakpoint, so it's effectively free after the first turn.
 */
export const ALWAYS_INJECTED_CORE_SKILL = "cre-modeling-conventions";

export function isCoreSkill(name: string): boolean {
  return CORE_SKILL_NAMES.has(name);
}
