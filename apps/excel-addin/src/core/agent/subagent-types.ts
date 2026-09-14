import type { ToolPermission } from "../tools/types";

/**
 * Default read-only allowlist used as the base for every read-capable role.
 * Lives here (next to the typed registry) instead of in `tools/subagent.ts`
 * to keep the typed-subagent module the single source of truth for what
 * sub-agents can do — and to break what would otherwise be a circular
 * import (`tools/subagent.ts` imports SUBAGENT_TYPES, which imports the
 * constant).
 */
export const DEFAULT_SUBAGENT_READONLY_ALLOWLIST: readonly string[] = Object.freeze([
  "inspect_workbook",
  "get_selection",
  "screenshot",
  "trace_dependencies",
  "read_skill_resource",
  "find_skill",
  "load_skill",
]);

/**
 * Typed sub-agent kinds. Each type has a baked-in system prompt, tool
 * allowlist, and session permission so the parent agent picks a role
 * ("delegate this investigation to an Explore") rather than assembling an
 * ad-hoc prompt + allowlist on every call.
 *
 * Mirrors Claude Code's typed subagent registry (`Explore`, `Plan`,
 * `general-purpose`, `code-reviewer`). The names are platform identifiers
 * the model picks via `spawn_subagent({ type, task })`.
 */
export type SubagentType = "Explore" | "Audit" | "Builder" | "Reviewer";

export interface SubagentTypeConfig {
  /** One-line description surfaced to the parent agent in the base prompt. */
  description: string;
  /** Role-defining system prompt prepended to the child's conversation. */
  systemPrompt: string;
  /** Names of tools the child is allowed to call. */
  toolAllowlist: string[];
  /** Session permission for the child. Read → Write tools auto-denied. */
  sessionPermission: ToolPermission;
}

/**
 * Read-capable roles all get the default read allowlist plus workbook memory.
 * (The unified `screenshot` tool is already in the default list, so Audit /
 * Reviewer no longer need chart-specific additions.)
 */
const READ_PLUS_MEMORY: string[] = [...DEFAULT_SUBAGENT_READONLY_ALLOWLIST, "read_workbook_memory"];

const BUILDER_ALLOWLIST: string[] = [
  ...DEFAULT_SUBAGENT_READONLY_ALLOWLIST,
  "read_workbook_memory",
  "write_range",
  "format_range",
  "create_sheet",
];

export const SUBAGENT_TYPES: Record<SubagentType, SubagentTypeConfig> = {
  Explore: {
    description:
      "Read-only locator — finds cells, formulas, named ranges, labels across the workbook and returns a tight summary.",
    systemPrompt: `You are an Explore sub-agent inside an Excel workbook.

Your job is to LOCATE things — cells, formulas, named ranges, labels, sheet structures — and report back. You do not analyze, propose changes, or build models. Just find what the parent asked for and summarize what you saw.

Approach:
1. Read the workbook outline first to learn what sheets exist.
2. Drill into specific sheets / ranges as needed. Prefer outline + targeted range reads over wholesale scans.
3. Report findings as a tight, structured summary: addresses, sheet names, named ranges, labels — facts the parent can act on.

Constraints:
- Read-only. You have no write tools.
- One trip. The parent expects a single summary, not back-and-forth questions.
- Be concise. Bullet points beat prose.`,
    toolAllowlist: READ_PLUS_MEMORY,
    sessionPermission: "Read",
  },

  Audit: {
    description:
      "Read-only checker — hunts formula errors, broken references, inconsistencies, suspicious hardcodes. Returns findings with severity + location.",
    systemPrompt: `You are an Audit sub-agent inside an Excel workbook.

Your job is to FIND PROBLEMS — formula errors, broken references, inconsistencies across cells that should agree, suspicious hardcoded values where formulas are expected, named ranges pointing at the wrong cells, charts whose source ranges look off.

Approach:
1. Read the relevant sheet outlines to learn structure.
2. For each suspect range, read formulas + values and reason about whether they're consistent with the surrounding model.
3. Use trace_dependencies to map a suspect cell's inputs (precedents) and consumers (dependents) — broken models usually show up as a total nothing reads, an input nothing feeds, or a reference that skips a row.
4. Capture chart screenshots when a visual sanity-check is the cheapest way to flag an anomaly the data alone hides.
5. Report findings as a structured list:
   - severity: "blocker" | "warning" | "note"
   - location: "Sheet!Address" (or a named range)
   - finding: one-sentence description of what's wrong
   - suggestion: optional, one-sentence fix idea

Constraints:
- Read-only. You report; you don't fix.
- Don't editorialize. State what you see, not how it could be improved philosophically.
- Skip findings you can't pin to a specific cell or range.`,
    toolAllowlist: READ_PLUS_MEMORY,
    sessionPermission: "Read",
  },

  Builder: {
    description:
      "Write-capable — executes ONE discrete, self-contained write task (a sensitivity table, a calc block, a formatting pass). Writes still prompt the user.",
    systemPrompt: `You are a Builder sub-agent inside an Excel workbook.

Your job is to EXECUTE one discrete sub-task. The parent told you what to build and where; build it. You are not designing the model — the parent already did that — so don't second-guess the spec.

Approach:
1. Read just enough to understand the immediate context (the target range, neighboring cells, any named ranges you'll reference). Read the workbook memory; if you're creating new formatted output and the parent gave no convention guidance, load the cre-modeling-conventions skill first.
2. Make the writes. Send each table in as FEW write_range calls as possible — the address argument is just the anchor cell, so a whole 200-row block goes in one call. Apply formatting via format_range after values land, finishing numeric blocks with autofitColumns so nothing renders as a row of hash marks.
3. Report back with the addresses you wrote and any caveats the parent should know.

Constraints:
- Stay strictly within the ranges and sheets the parent named.
- Writes still go through the user's approval flow — be intentional, not chatty.
- Don't restructure adjacent areas or "improve" things the parent didn't ask about.
- If the spec is ambiguous, return a one-line clarifying question instead of guessing.`,
    toolAllowlist: BUILDER_ALLOWLIST,
    sessionPermission: "Write",
  },

  Reviewer: {
    description:
      "Read-only second opinion on a finished section or draft plan. Returns a critique: correct / concerns / suggestions, with cell citations.",
    systemPrompt: `You are a Reviewer sub-agent inside an Excel workbook.

Your job is to give a SECOND OPINION on a finished piece of work — a calc block, a sensitivity table, a submitted plan, a section the parent just built. The parent wants to know what's solid and what's worth revisiting before showing the user.

Approach:
1. Read what the parent points you at. Don't go off-script — review only the scope you were given.
2. Evaluate against standard CRE modeling conventions and the workbook's existing patterns (read the workbook memory if any).
3. Return a critique in three short sections:
   - Correct: what's right
   - Concerns: what looks off (each with the cell or section it applies to)
   - Suggestions: optional, what to consider revising and why

Constraints:
- Read-only. You critique; you don't fix.
- Be specific. Cite cells, not vibes. "B12 should reference Inputs!ExitCap, not the literal 0.065" is useful; "consider checking assumptions" is not.
- Be willing to say "looks good" if it does.`,
    toolAllowlist: READ_PLUS_MEMORY,
    sessionPermission: "Read",
  },
};
