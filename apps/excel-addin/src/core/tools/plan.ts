import type { ToolDef } from "./types";

/* -------------------------------- types ----------------------------------- */

export type PlanStepStatus = "pending" | "in-progress" | "done" | "blocked";

export interface PlanStep {
  /** 1-based step number (matches what the user sees in the UI). */
  number: number;
  title: string;
  details?: string;
  status: PlanStepStatus;
  /** Optional note attached by the agent when the status moved (e.g. why blocked). */
  note?: string;
}

export interface SubmitPlanInput {
  steps: Array<{ title: string; details?: string }>;
}

export interface SubmitPlanResult {
  planId: string;
  steps: PlanStep[];
}

export interface UpdatePlanStepInput {
  step: number;
  status: PlanStepStatus;
  note?: string;
}

/* ------------------------------- submit_plan ------------------------------ */

export const submitPlanTool: ToolDef<SubmitPlanInput, SubmitPlanResult> = {
  name: "submit_plan",
  description:
    "Propose a numbered plan. Call ONCE in Plan mode after investigating. Each step is a " +
    'concrete, executable unit with a short imperative title ("Build the rent roll table"); ' +
    "`details` sparingly. After submitting, stop — the user decides whether to promote it to " +
    "Work mode.",
  inputSchema: {
    type: "object",
    properties: {
      steps: {
        type: "array",
        minItems: 1,
        maxItems: 20,
        items: {
          type: "object",
          properties: {
            title: { type: "string", minLength: 1 },
            details: { type: "string" },
          },
          required: ["title"],
          additionalProperties: false,
        },
      },
    },
    required: ["steps"],
    additionalProperties: false,
  },
  requiredPermission: "Read",
  async execute({ steps }) {
    if (!Array.isArray(steps) || steps.length === 0) {
      throw new Error("submit_plan requires a non-empty steps array.");
    }
    const planId = `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const numbered: PlanStep[] = steps.map((s, i) => ({
      number: i + 1,
      title: s.title,
      details: s.details,
      status: "pending",
    }));
    return { planId, steps: numbered };
  },
};

/* ---------------------------- update_plan_step ---------------------------- */

export const updatePlanStepTool: ToolDef<
  UpdatePlanStepInput,
  { ok: true; step: number; status: PlanStepStatus; next: string }
> = {
  name: "update_plan_step",
  description:
    'Mark a plan step "in-progress" when you start it, "done" when complete, or "blocked" ' +
    "(with a `note` saying what you need). The result's `next` field is a directive — follow it.",
  inputSchema: {
    type: "object",
    properties: {
      step: { type: "integer", minimum: 1 },
      status: { type: "string", enum: ["pending", "in-progress", "done", "blocked"] },
      note: { type: "string" },
    },
    required: ["step", "status"],
    additionalProperties: false,
  },
  requiredPermission: "Read",
  async execute({ step, status }) {
    if (!Number.isInteger(step) || step < 1) {
      throw new Error("update_plan_step: `step` must be a positive integer.");
    }
    // The UI watches for this tool's result events and updates the live plan
    // accordingly — see useAgentStream. The `next` field is a directive the
    // model sees in the tool result; without it, weaker models stall between
    // plan steps (over-investigating reads, never committing to the write).
    const next = nextInstruction(status);
    return { ok: true as const, step, status, next };
  },
};

function nextInstruction(status: PlanStepStatus): string {
  switch (status) {
    case "in-progress":
      return (
        'DO THE WORK FOR THIS STEP NOW. Make at most 1–2 inspect_workbook(scope="range") calls if you genuinely need ' +
        "more context (you've usually read enough already — don't loop on reads). Then call " +
        "write_range / format_range to make the actual change in the workbook. After the write " +
        'succeeds, call update_plan_step on THIS SAME STEP with status "done". Do not send a ' +
        "chat message between starting and finishing this step."
      );
    case "done":
      return (
        'STEP COMPLETE. If the plan has more steps that aren\'t yet "done" or "blocked", ' +
        'IMMEDIATELY call update_plan_step on the next step with status "in-progress" and start ' +
        "the work in this same turn. Do NOT send a chat message between steps. Only send a final " +
        "chat summary AFTER every step is done."
      );
    case "blocked":
      return (
        "STEP BLOCKED. Send a brief chat message explaining what you need from the user to unblock " +
        "this step (e.g., a missing assumption, a clarification on the user's intent). Do not " +
        "attempt other steps in the meantime."
      );
    case "pending":
    default:
      return "Pending — no action required for this status.";
  }
}

export const planTools: ToolDef[] = [submitPlanTool, updatePlanStepTool];
export const PLAN_TOOL_NAMES = new Set(["submit_plan", "update_plan_step"]);
