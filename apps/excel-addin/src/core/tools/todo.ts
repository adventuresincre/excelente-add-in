import type { ToolDef } from "./types";

/**
 * One entry in the agent's running task list. Distinct from PlanStep
 * (which lives inside a submitted/approved plan): TodoTask is informal —
 * the agent mutates it freely without requiring user approval.
 */
export interface TodoTask {
  text: string;
  status: "pending" | "in-progress" | "done";
}

interface TodoWriteInput {
  items: Array<{
    text: string;
    /** Defaults to "pending". */
    status?: "pending" | "in-progress" | "done";
  }>;
}

export interface TodoWriteResult {
  /** Echoed back so the model sees the canonical list it just wrote. */
  items: TodoTask[];
}

/**
 * Lightweight task scratchpad. The agent uses this to lay out a checklist
 * for itself during longer builds and tick items off as it goes. Unlike
 * `submit_plan` (which is structured + approval-gated to enter Work mode),
 * todo_write is informal — no approval gate, no mode change, no impact on
 * permissions. It's purely a UI affordance so the user can watch progress.
 *
 * Each call replaces the previous list. Pass the full current state every
 * time, not deltas. (Mirrors Claude Code's TodoWrite shape.)
 */
export const todoWriteTool: ToolDef<TodoWriteInput, TodoWriteResult> = {
  name: "todo_write",
  description:
    "Update your visible task checklist during multi-step work. Each call REPLACES the whole " +
    "list — pass full state, not deltas. Informal (no approval, no mode change): use it when " +
    "the work is already authorized; use submit_plan when the build warrants review first. " +
    "One line per item.",
  inputSchema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            text: {
              type: "string",
              description: "One-line description of the task.",
            },
            status: {
              type: "string",
              enum: ["pending", "in-progress", "done"],
              description: "Current status. Default 'pending'.",
            },
          },
          required: ["text"],
          additionalProperties: false,
        },
      },
    },
    required: ["items"],
    additionalProperties: false,
  },
  requiredPermission: "Read",
  async execute({ items }) {
    const normalized: TodoTask[] = items.map((item) => ({
      text: item.text,
      status: item.status ?? "pending",
    }));
    return { items: normalized };
  },
};
