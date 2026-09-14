import { describe, expect, it, vi } from "vitest";
import { inMemoryDataSource } from "../context";
import { createUndoStack } from "./undo";
import { proposeSkillTool } from "./skill-management";

const baseCtx = () => ({
  ds: inMemoryDataSource({ sheets: [{ name: "Sheet1" }] }),
  undoStack: createUndoStack(),
});

describe("propose_skill — create", () => {
  it("delegates to proposeSkill with kind='create' and returns accepted result", async () => {
    const proposeSkill = vi
      .fn()
      .mockResolvedValue({ outcome: "accepted", name: "underwriting-checklist" });

    const result = await proposeSkillTool.execute(
      {
        kind: "create",
        name: "underwriting-checklist",
        description: "Run the standard 12-step UW pass",
        whenToUse: "User says 'underwrite' or 'audit this deal'",
        body: "# Underwriting checklist\n\n## When to use\n...",
      },
      { ...baseCtx(), proposeSkill }
    );

    expect(proposeSkill).toHaveBeenCalledOnce();
    expect(proposeSkill.mock.calls[0][0]).toMatchObject({
      kind: "create",
      name: "underwriting-checklist",
    });
    expect(result).toEqual({ accepted: true, name: "underwriting-checklist" });
  });

  it("returns dismissed when the user rejects the proposal", async () => {
    const proposeSkill = vi.fn().mockResolvedValue({ outcome: "dismissed" });
    const result = await proposeSkillTool.execute(
      { kind: "create", name: "x", description: "d", body: "b" },
      { ...baseCtx(), proposeSkill }
    );
    expect(result).toEqual({ dismissed: true });
  });

  it("returns dismissed when proposeSkill is not in context (test environments)", async () => {
    const result = await proposeSkillTool.execute(
      { kind: "create", name: "x", description: "d", body: "b" },
      baseCtx()
    );
    expect(result).toEqual({ dismissed: true });
  });

  it("forwards references when provided", async () => {
    const proposeSkill = vi.fn().mockResolvedValue({ outcome: "accepted", name: "x" });
    await proposeSkillTool.execute(
      {
        kind: "create",
        name: "x",
        description: "d",
        body: "b",
        references: { "refs/data.md": "## data" },
      },
      { ...baseCtx(), proposeSkill }
    );
    expect(proposeSkill.mock.calls[0][0].references).toEqual({ "refs/data.md": "## data" });
  });
});

describe("propose_skill — update", () => {
  it("delegates with kind='update' when a reason is given", async () => {
    const proposeSkill = vi.fn().mockResolvedValue({ outcome: "accepted", name: "dcf-modeling" });

    const result = await proposeSkillTool.execute(
      {
        kind: "update",
        name: "dcf-modeling",
        description: "Build a multi-period DCF",
        body: "# Updated playbook\n",
        reason: "Add stabilized-vs-development branching",
      },
      { ...baseCtx(), proposeSkill }
    );

    expect(proposeSkill.mock.calls[0][0]).toMatchObject({ kind: "update", name: "dcf-modeling" });
    expect(result).toEqual({ accepted: true, name: "dcf-modeling" });
  });

  it("dismisses an update with no reason without calling proposeSkill", async () => {
    const proposeSkill = vi.fn();
    const result = await proposeSkillTool.execute(
      { kind: "update", name: "dcf-modeling", description: "d", body: "b" },
      { ...baseCtx(), proposeSkill }
    );
    expect(result).toEqual({ dismissed: true });
    expect(proposeSkill).not.toHaveBeenCalled();
  });
});

describe("propose_skill — shape", () => {
  it("requires kind, name, description, body", () => {
    const schema = proposeSkillTool.inputSchema as { required: string[] };
    expect(schema.required.sort()).toEqual(["body", "description", "kind", "name"]);
  });

  it("is Read-permission (the approval is the proposal card, not a permission gate)", () => {
    expect(proposeSkillTool.requiredPermission).toBe("Read");
  });
});
