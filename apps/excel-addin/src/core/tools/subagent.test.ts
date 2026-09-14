import { describe, expect, it, vi } from "vitest";
import { inMemoryDataSource } from "../context";
import { createUndoStack } from "./undo";
import { spawnSubagentTool } from "./subagent";

const ds = inMemoryDataSource({ sheets: [{ name: "Sheet1" }] });

describe("spawnSubagentTool (typed)", () => {
  it("dispatches an Explore child with the read-only allowlist and Read permission", async () => {
    const runSubagent = vi
      .fn()
      .mockResolvedValue({ summary: "found B12 references C5", cost: 0.001, turns: 1 });

    const result = await spawnSubagentTool.execute(
      { type: "Explore", task: "Find where the cap rate lives" },
      { ds, undoStack: createUndoStack(), runSubagent }
    );

    expect(runSubagent).toHaveBeenCalledOnce();
    const call = runSubagent.mock.calls[0][0];
    expect(call.prompt).toBe("Find where the cap rate lives");
    expect(call.sessionPermission).toBe("Read");
    expect(call.systemPrompt).toMatch(/Explore sub-agent/);
    // No write tools in the Explore allowlist.
    expect(call.toolAllowlist).not.toContain("write_range");
    expect(call.toolAllowlist).not.toContain("format_range");
    expect(result).toEqual({ summary: "found B12 references C5", cost: 0.001, turns: 1 });
  });

  it("dispatches a Builder child with Write permission and write tools in the allowlist", async () => {
    const runSubagent = vi.fn().mockResolvedValue({ summary: "built it", turns: 2 });

    await spawnSubagentTool.execute(
      { type: "Builder", task: "Write the IRR formula at Calcs!H12" },
      { ds, undoStack: createUndoStack(), runSubagent }
    );

    const call = runSubagent.mock.calls[0][0];
    expect(call.sessionPermission).toBe("Write");
    expect(call.toolAllowlist).toContain("write_range");
    expect(call.systemPrompt).toMatch(/Builder sub-agent/);
  });

  it("forwards max_turns", async () => {
    const runSubagent = vi.fn().mockResolvedValue({ summary: "x", turns: 0 });

    await spawnSubagentTool.execute(
      { type: "Reviewer", task: "Look at Sheet1!A1:Z50", max_turns: 3 },
      { ds, undoStack: createUndoStack(), runSubagent }
    );

    expect(runSubagent.mock.calls[0][0].maxTurns).toBe(3);
  });

  it("returns an error object when ctx.runSubagent is not provided", async () => {
    const result = await spawnSubagentTool.execute(
      { type: "Explore", task: "x" },
      { ds, undoStack: createUndoStack() }
    );
    expect(result).toEqual({ error: expect.stringMatching(/not available/) });
  });

  it("refuses to spawn when invoked inside a sub-agent runtime (recursion lock)", async () => {
    const runSubagent = vi.fn();
    const result = await spawnSubagentTool.execute(
      { type: "Explore", task: "infinite recursion attempt" },
      { ds, undoStack: createUndoStack(), runSubagent, isSubagent: true }
    );

    // Result is a structured error the parent can adapt to, not a throw.
    expect(result).toEqual({
      error: expect.stringMatching(/Sub-agents cannot spawn sub-agents/),
    });
    // Critically, runSubagent must NOT have been called.
    expect(runSubagent).not.toHaveBeenCalled();
  });

  it("is marked as a read tool — picking a Builder type is the elevation, not the spawn itself", () => {
    expect(spawnSubagentTool.requiredPermission).toBe("Read");
  });

  it("schema enforces the typed shape (type + task required; no freeform allowlist)", () => {
    const schema = spawnSubagentTool.inputSchema as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(schema.required.sort()).toEqual(["task", "type"]);
    expect(Object.keys(schema.properties).sort()).toEqual(["max_turns", "task", "type"]);
    // No more freeform tool_allowlist — type is the contract.
    expect(Object.keys(schema.properties)).not.toContain("tool_allowlist");
  });
});
