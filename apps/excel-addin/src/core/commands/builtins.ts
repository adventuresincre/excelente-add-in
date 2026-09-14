/**
 * Built-in slash commands surfaced in the Composer's slash menu alongside
 * installed skills. Commands are platform actions (mode switches, clear,
 * help) — distinct from skills, which are prompt playbooks the agent
 * follows. Adding a new command here adds it to the menu; the Composer's
 * `onSlashCommand` callback dispatches handlers in ChatPanel.
 *
 * Names are stable identifiers (used by the menu's onSelect callback) and
 * should match what users would naturally type after `/`.
 */
export interface SlashCommand {
  /** Identifier shown after `/` in the menu and matched against the slash query. */
  name: string;
  /** One-line description shown under the command name in the menu. */
  description: string;
  /**
   * Optional one-letter hint shown to the right of the name (currently
   * unused — reserved for future keyboard shortcuts). Kept for forward
   * compatibility so adding shortcuts later doesn't churn this interface.
   */
  shortcut?: string;
}

export const BUILTIN_COMMANDS: readonly SlashCommand[] = Object.freeze([
  {
    name: "plan",
    description: "Switch to Plan mode — the agent proposes a numbered plan and stops for review.",
  },
  {
    name: "work",
    description: "Switch to Work mode — the agent executes immediately (default).",
  },
  {
    name: "undo",
    description: "Revert the most recent agent write to its prior contents.",
  },
  {
    name: "init",
    description: "Bootstrap this workbook's memory file from an Explore subagent's analysis.",
  },
  {
    name: "skillify",
    description: "Ask the agent to propose a new skill from a recent workflow.",
  },
  {
    name: "clear",
    description: "Clear the chat history and start a fresh conversation.",
  },
  {
    name: "help",
    description: "Show this command list.",
  },
  {
    name: "cost",
    description: "Show this session's cost so far.",
  },
]);

/**
 * Filter built-in commands by a slash-menu query, mirroring the matching
 * behavior the Composer uses for skills (name or description contains the
 * query, case-insensitive). Returns the filtered list in the original
 * declaration order — keeps `/plan` above `/work` which keeps the menu
 * stable across renders.
 */
export function filterCommands(query: string): SlashCommand[] {
  if (!query) return [...BUILTIN_COMMANDS];
  const q = query.toLowerCase();
  return BUILTIN_COMMANDS.filter(
    (c) => c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)
  );
}
