import type { ToolDef } from "./types";

interface AskUserQuestionOption {
  label: string;
  description?: string;
}

interface AskUserQuestionEntry {
  question: string;
  header?: string;
  options: AskUserQuestionOption[];
  multiSelect?: boolean;
}

interface AskUserQuestionInput {
  questions: AskUserQuestionEntry[];
}

type AskUserQuestionAnswer = { picked: string[] } | { text: string } | { cancelled: true };

interface AskUserQuestionResult {
  answers: AskUserQuestionAnswer[];
}

/**
 * Ask the user one or more structured questions and pause until they
 * answer. Renders as a tappable card in the chat with multiple-choice
 * options (single- or multi-select) plus a free-text fallback. The
 * agent's run is suspended until the user responds.
 *
 * Use this BEFORE diving into a build when key parameters are
 * ambiguous and would be expensive to redo: GP/LP split, hurdle count,
 * unit count, hold period, exit strategy. NOT for tiny choices the
 * agent can reasonably assume (sheet name, formatting style).
 *
 * Each question gets one answer; answers come back in the same order.
 * When the user picks "Other / free text", the answer is { text }.
 * When the user dismisses without answering, it's { cancelled: true }.
 */
export const askUserQuestionTool: ToolDef<AskUserQuestionInput, AskUserQuestionResult> = {
  name: "ask_user_question",
  description:
    "Pause and ask the user 1-4 structured questions, rendered as answer cards (free-text " +
    "fallback is always available — don't add an 'Other' option). Use when a wrong assumption " +
    "is expensive to redo (GP/LP split, hurdle count, hold period, exit strategy) — not for " +
    "choices you can reasonably assume. Answers return in order; a dismissal returns " +
    "{ cancelled: true }.",
  inputSchema: {
    type: "object",
    properties: {
      questions: {
        type: "array",
        minItems: 1,
        maxItems: 4,
        items: {
          type: "object",
          properties: {
            question: {
              type: "string",
              description: "The full question text shown to the user.",
            },
            header: {
              type: "string",
              description: "Short label / category (≤12 chars).",
            },
            options: {
              type: "array",
              minItems: 2,
              maxItems: 4,
              items: {
                type: "object",
                properties: {
                  label: {
                    type: "string",
                    description: "Display text the user picks.",
                  },
                  description: {
                    type: "string",
                    description: "Optional explanation shown under the label.",
                  },
                },
                required: ["label"],
                additionalProperties: false,
              },
            },
            multiSelect: {
              type: "boolean",
              description: "When true, the user can pick multiple options. Default false.",
            },
          },
          required: ["question", "options"],
          additionalProperties: false,
        },
      },
    },
    required: ["questions"],
    additionalProperties: false,
  },
  requiredPermission: "Read",
  async execute({ questions }, { askUser }) {
    if (!askUser) {
      return {
        answers: questions.map(() => ({
          text: "(ask_user_question is not available in this context — proceed with reasonable defaults)",
        })),
      };
    }
    return askUser(questions);
  },
};
