import planModePromptRaw from "./plan-mode.md?raw";
import workModePromptRaw from "./work-mode.md?raw";

/**
 * Mode-specific prompt overlays, loaded as raw markdown at build time. Lives
 * alongside the orchestrator (not under `apps/excel-addin/skills/`) because
 * mode prompts are platform behavior, not user-discoverable playbooks —
 * `find_skill` should not surface them, and they're loaded by mode, not by
 * the agent's judgment.
 *
 * Editing either file changes the corresponding mode's behavior on the next
 * build, without touching TypeScript. This is "fat skills" applied to the
 * harness's own prompts.
 */
export const PLAN_MODE_PROMPT = planModePromptRaw;
export const WORK_MODE_PROMPT = workModePromptRaw;
