import { describe, expect, it } from "vitest";
import type { ToolContext } from "./types";
import { submitPlanTool, updatePlanStepTool } from "./plan";

const stubCtx = {} as ToolContext;

describe("submitPlanTool", () => {
  it("numbers the steps starting at 1 and marks them all pending", async () => {
    const out = await submitPlanTool.execute(
      {
        steps: [
          { title: "Read the assumptions" },
          { title: "Build the rent roll", details: "from the leases tab" },
        ],
      },
      stubCtx
    );
    expect(out.steps).toHaveLength(2);
    expect(out.steps[0]).toMatchObject({
      number: 1,
      title: "Read the assumptions",
      status: "pending",
    });
    expect(out.steps[1]).toMatchObject({
      number: 2,
      title: "Build the rent roll",
      details: "from the leases tab",
      status: "pending",
    });
    expect(out.planId).toMatch(/^plan-/);
  });

  it("rejects an empty plan", async () => {
    await expect(submitPlanTool.execute({ steps: [] }, stubCtx)).rejects.toThrow(/non-empty/i);
  });

  it("flags isWrite=false (no approval gate)", () => {
    expect(submitPlanTool.requiredPermission).toBe("Read");
  });
});

describe("updatePlanStepTool", () => {
  it("echoes the step + status on success with a directive `next` field", async () => {
    const out = await updatePlanStepTool.execute({ step: 2, status: "done" }, stubCtx);
    expect(out.ok).toBe(true);
    expect(out.step).toBe(2);
    expect(out.status).toBe("done");
    expect(typeof out.next).toBe("string");
  });

  it("rejects non-positive step numbers", async () => {
    await expect(updatePlanStepTool.execute({ step: 0, status: "done" }, stubCtx)).rejects.toThrow(
      /positive integer/i
    );
  });

  it("flags isWrite=false", () => {
    expect(updatePlanStepTool.requiredPermission).toBe("Read");
  });

  it("in-progress nudge tells the agent to commit to a write", async () => {
    const out = await updatePlanStepTool.execute({ step: 1, status: "in-progress" }, stubCtx);
    expect(out.next).toMatch(/do the work/i);
    expect(out.next).toMatch(/write_range/);
    expect(out.next).toMatch(/don'?t loop on reads/i);
  });

  it("done nudge tells the agent to immediately start the next step", async () => {
    const out = await updatePlanStepTool.execute({ step: 1, status: "done" }, stubCtx);
    expect(out.next).toMatch(/immediately/i);
    expect(out.next).toMatch(/next step/i);
    expect(out.next).toMatch(/do not send a chat message between steps/i);
  });

  it("blocked nudge tells the agent to chat about the blocker", async () => {
    const out = await updatePlanStepTool.execute(
      { step: 1, status: "blocked", note: "missing cap rate" },
      stubCtx
    );
    expect(out.next).toMatch(/unblock/i);
  });
});
