import { describe, expect, it, vi } from "vitest";
import { inMemoryDataSource } from "../context";
import { createUndoStack } from "./undo";
import { askUserQuestionTool } from "./ask-user";

const baseCtx = () => ({
  ds: inMemoryDataSource({ sheets: [{ name: "Sheet1" }] }),
  undoStack: createUndoStack(),
});

describe("ask_user_question", () => {
  it("delegates to ctx.askUser with the question shape and returns the answers", async () => {
    const askUser = vi.fn().mockResolvedValue({
      answers: [{ picked: ["10 years"] }, { picked: ["80/20"] }],
    });

    const result = await askUserQuestionTool.execute(
      {
        questions: [
          {
            question: "Hold period?",
            options: [{ label: "5 years" }, { label: "10 years" }],
          },
          {
            question: "GP/LP split?",
            header: "Split",
            options: [{ label: "80/20" }, { label: "90/10" }],
          },
        ],
      },
      { ...baseCtx(), askUser }
    );

    expect(askUser).toHaveBeenCalledOnce();
    expect(askUser.mock.calls[0][0]).toHaveLength(2);
    expect(askUser.mock.calls[0][0][0].question).toBe("Hold period?");
    expect(result.answers).toEqual([{ picked: ["10 years"] }, { picked: ["80/20"] }]);
  });

  it("returns reasonable-defaults message when askUser callback is not provided", async () => {
    const result = await askUserQuestionTool.execute(
      {
        questions: [{ question: "What?", options: [{ label: "A" }, { label: "B" }] }],
      },
      baseCtx()
    );
    expect(result.answers).toHaveLength(1);
    expect(result.answers[0]).toMatchObject({ text: expect.stringMatching(/not available/) });
  });

  it("supports cancelled answers in the response (user dismissed)", async () => {
    const askUser = vi.fn().mockResolvedValue({ answers: [{ cancelled: true }] });
    const result = await askUserQuestionTool.execute(
      {
        questions: [{ question: "x?", options: [{ label: "A" }, { label: "B" }] }],
      },
      { ...baseCtx(), askUser }
    );
    expect(result.answers[0]).toEqual({ cancelled: true });
  });

  it("is Read-permission (no approval needed — the question itself is the user interaction)", () => {
    expect(askUserQuestionTool.requiredPermission).toBe("Read");
  });

  it("schema enforces 1-4 questions, each with 2-4 options", () => {
    const schema = askUserQuestionTool.inputSchema as {
      properties: {
        questions: {
          minItems: number;
          maxItems: number;
          items: { properties: { options: { minItems: number; maxItems: number } } };
        };
      };
    };
    expect(schema.properties.questions.minItems).toBe(1);
    expect(schema.properties.questions.maxItems).toBe(4);
    expect(schema.properties.questions.items.properties.options.minItems).toBe(2);
    expect(schema.properties.questions.items.properties.options.maxItems).toBe(4);
  });
});
