import type { ToolDef } from "./types";

interface ProposeSkillInput {
  kind: "create" | "update";
  name: string;
  description: string;
  whenToUse?: string;
  body: string;
  references?: Record<string, string>;
  /** Required when kind="update" — what changed and why (shown on the card). */
  reason?: string;
}

type SkillProposalResult = { accepted: true; name: string } | { dismissed: true };

/**
 * Propose a new or updated skill for the user's library. Renders as a
 * SkillProposalCard the user reviews and accepts or dismisses; on accept the
 * host persists into the user-skill store and the skill becomes discoverable
 * via find_skill on the next call.
 *
 * One tool with a `kind` discriminator (was create_skill + update_skill) —
 * the underlying `ToolContext.proposeSkill` already keyed on kind, so the
 * two-tool split was pure surface area and one extra decision for the model.
 */
export const proposeSkillTool: ToolDef<ProposeSkillInput, SkillProposalResult> = {
  name: "propose_skill",
  description:
    "Propose a skill for the user's library after completing a non-trivial workflow likely to " +
    "recur (3+ steps, decision branches, or a model the user works with repeatedly) — not for " +
    'one-off tasks. Call find_skill first: if a close skill exists, propose kind="update" (state ' +
    '`reason`); otherwise kind="create". The user reviews a card; on accept the skill is saved ' +
    "and discoverable. For updates, the new body replaces the old and references merge.\n\n" +
    "Body = full markdown playbook, no frontmatter. Recommended sections: 'When to use', " +
    "'Approach' (numbered), 'What to flag', 'How to phrase the report'.",
  inputSchema: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: ["create", "update"],
        description:
          '"create" for a new skill; "update" to revise an existing one (requires reason).',
      },
      name: {
        type: "string",
        description:
          "Skill identifier in lower-kebab (letters, digits, hyphens). For update, the existing skill's name.",
      },
      description: {
        type: "string",
        description: "One-line description shown in find_skill results.",
      },
      whenToUse: {
        type: "string",
        description:
          "Short phrase describing when this skill activates — phrase it the way users describe the task.",
      },
      body: {
        type: "string",
        description:
          "Full markdown playbook (frontmatter omitted — reconstructed from the other fields).",
      },
      references: {
        type: "object",
        description:
          "Optional bundled reference files keyed by relative path (e.g. 'references/cap-rate-ranges.md'). For updates, merged with existing references.",
        additionalProperties: { type: "string" },
      },
      reason: {
        type: "string",
        description:
          'For kind="update": one-line summary of what changed and why. Shown on the review card.',
      },
    },
    required: ["kind", "name", "description", "body"],
    additionalProperties: false,
  },
  requiredPermission: "Read",
  async execute(input, { proposeSkill }) {
    if (input.kind === "update" && (!input.reason || input.reason.trim() === "")) {
      return { dismissed: true };
    }
    if (!proposeSkill) {
      return { dismissed: true };
    }
    const response = await proposeSkill({
      kind: input.kind,
      name: input.name,
      description: input.description,
      whenToUse: input.whenToUse,
      body: input.body,
      references: input.references,
    });
    if (response.outcome === "accepted") {
      return { accepted: true, name: response.name ?? input.name };
    }
    return { dismissed: true };
  },
};
