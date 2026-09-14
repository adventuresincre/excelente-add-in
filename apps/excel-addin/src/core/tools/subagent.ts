import { SUBAGENT_TYPES, type SubagentType } from "../agent/subagent-types";
import type { SubagentResult, ToolDef } from "./types";

interface SpawnSubagentInput {
  type: SubagentType;
  task: string;
  max_turns?: number;
}

type SpawnSubagentOutput = SubagentResult | { error: string };

/**
 * Hard ceiling on a child's model turns. `max_turns` is model-supplied, and
 * a child's read tools run without approval prompts — so an unclamped value
 * (from a confused model, or from injected content asking for 100000) is a
 * silent token/credit burn the user only notices on the bill. Generous
 * enough that no legitimate delegation hits it.
 */
export const MAX_SUBAGENT_TURNS = 20;

/** Clamp a model-supplied turn cap into [1, MAX_SUBAGENT_TURNS]. */
function clampMaxTurns(requested: number | undefined): number | undefined {
  if (typeof requested !== "number" || !Number.isFinite(requested)) return undefined;
  return Math.min(Math.max(Math.floor(requested), 1), MAX_SUBAGENT_TURNS);
}

const TYPE_NAMES = Object.keys(SUBAGENT_TYPES) as SubagentType[];

function describeTypes(): string {
  return TYPE_NAMES.map((name) => `  - "${name}": ${SUBAGENT_TYPES[name].description}`).join("\n");
}

export const spawnSubagentTool: ToolDef<SpawnSubagentInput, SpawnSubagentOutput> = {
  name: "spawn_subagent",
  description:
    "Spawn an isolated child agent for a focused sub-task — keeps its intermediate work out " +
    "of your context; you see only its final summary. The child sees only your `task` text " +
    "(no history) and cannot spawn children.\n\n" +
    "Types:\n" +
    describeTypes(),
  inputSchema: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: TYPE_NAMES,
        description: "Role — each bakes in a system prompt and tool allowlist (see Types above).",
      },
      task: {
        type: "string",
        description:
          "Task description for the child. Be specific — the child has no other context. " +
          "For Builder, name the exact ranges/sheets in scope; for Reviewer, name the " +
          "section to review.",
      },
      max_turns: {
        type: "number",
        description: `Cap on the child's model turns. Default 6, maximum ${MAX_SUBAGENT_TURNS}.`,
      },
    },
    required: ["type", "task"],
    additionalProperties: false,
  },
  requiredPermission: "Read",
  async execute(input, ctx) {
    // Recursion lock — claw-code's rule: sub-agents cannot spawn sub-agents.
    // Without this, a child can fork unboundedly, blowing up cost and
    // latency. The denial is returned as a structured ToolResult so the
    // parent's model can adapt rather than crash.
    if (ctx.isSubagent) {
      return {
        error:
          "Sub-agents cannot spawn sub-agents. If you need to delegate again, summarize your findings and return; the parent can spawn a fresh sub-agent.",
      };
    }
    if (!ctx.runSubagent) {
      return { error: "Sub-agent runtime not available in this context." };
    }
    const cfg = SUBAGENT_TYPES[input.type];
    if (!cfg) {
      return {
        error: `Unknown subagent type "${input.type}". Valid types: ${TYPE_NAMES.join(", ")}.`,
      };
    }
    return ctx.runSubagent({
      prompt: input.task,
      systemPrompt: cfg.systemPrompt,
      toolAllowlist: cfg.toolAllowlist,
      sessionPermission: cfg.sessionPermission,
      maxTurns: clampMaxTurns(input.max_turns),
    });
  },
};

// Default read-only allowlist now lives in `agent/subagent-types.ts` next
// to the typed registry that consumes it. Re-export here for back-compat
// with any caller that imports it from the tools barrel.
export { DEFAULT_SUBAGENT_READONLY_ALLOWLIST } from "../agent/subagent-types";
