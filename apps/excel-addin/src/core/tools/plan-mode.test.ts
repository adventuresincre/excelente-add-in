import { describe, expect, it, vi } from "vitest";
import { inMemoryDataSource } from "../context";
import { createUndoStack } from "./undo";
import { enterPlanModeTool } from "./plan-mode";

const baseCtx = () => ({
  ds: inMemoryDataSource({ sheets: [{ name: "Sheet1" }] }),
  undoStack: createUndoStack(),
});

describe("enter_plan_mode", () => {
  it("calls setSessionPermission('Read') and returns the rationale", async () => {
    const setSessionPermission = vi.fn();
    const result = await enterPlanModeTool.execute(
      { reason: "Multi-sheet DCF build" },
      { ...baseCtx(), setSessionPermission }
    );

    expect(setSessionPermission).toHaveBeenCalledWith("Read");
    expect(result.sessionPermission).toBe("Read");
    expect(result.note).toMatch(/Multi-sheet DCF build/);
    expect(result.note).toMatch(/submit_plan/);
  });

  it("returns a graceful note when the callback is not provided (test context)", async () => {
    const result = await enterPlanModeTool.execute({ reason: "anything" }, baseCtx());
    expect(result.sessionPermission).toBe("Read");
    expect(result.note).toMatch(/not available/);
  });

  it("is a Read-permission tool — entering Plan mode doesn't require Write approval", () => {
    expect(enterPlanModeTool.requiredPermission).toBe("Read");
  });

  it("schema requires reason", () => {
    const schema = enterPlanModeTool.inputSchema as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(schema.required).toEqual(["reason"]);
  });
});
