import type { ToolDef } from "./types";

interface EnterPlanModeInput {
  /** One-sentence rationale shown to the user. */
  reason: string;
}

interface EnterPlanModeResult {
  sessionPermission: "Read";
  note: string;
}

/**
 * Tool-driven Plan mode entry. The model calls this when the user's request
 * looks like multi-step work that warrants a plan before any writes — the
 * tool flips the orchestrator's session permission to Read, blocking writes
 * for the remainder of the turn, and the UI mirrors the chatMode to "plan".
 *
 * Symmetrical with the user's manual Plan/Work pill, but driven by the
 * agent's judgment instead of a pre-send toggle. The user can still override
 * via the pill (or via `/work`).
 */
export const enterPlanModeTool: ToolDef<EnterPlanModeInput, EnterPlanModeResult> = {
  name: "enter_plan_mode",
  description:
    "Switch this session to Plan mode (Read-only) for the rest of the turn. Call as your FIRST " +
    "tool when the request implies a multi-sheet build or restructuring worth proposing before " +
    "executing — then investigate, submit_plan, stop. Skip for small asks (one cell, one " +
    "formula, a question) or when the user already decided (/work, or they named the exact " +
    "change).",
  inputSchema: {
    type: "object",
    properties: {
      reason: {
        type: "string",
        description:
          'One short sentence describing why a plan is warranted (e.g. "Multi-sheet DCF build"). ' +
          "Surfaced to the user so they understand the mode switch.",
      },
    },
    required: ["reason"],
    additionalProperties: false,
  },
  requiredPermission: "Read",
  async execute({ reason }, ctx) {
    if (!ctx.setSessionPermission) {
      return {
        sessionPermission: "Read" as const,
        note: "Plan mode is not available in this context (no setSessionPermission callback).",
      };
    }
    ctx.setSessionPermission("Read");
    return {
      sessionPermission: "Read" as const,
      note: `Entered Plan mode: ${reason}. Investigate the workbook as needed, then call submit_plan and stop.`,
    };
  },
};
