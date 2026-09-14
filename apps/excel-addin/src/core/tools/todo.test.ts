import { describe, expect, it } from "vitest";
import { inMemoryDataSource } from "../context";
import { createUndoStack } from "./undo";
import { todoWriteTool } from "./todo";

const ctx = () => ({
  ds: inMemoryDataSource({ sheets: [{ name: "Sheet1" }] }),
  undoStack: createUndoStack(),
});

describe("todo_write", () => {
  it("echoes the normalized list back as the result", async () => {
    const result = await todoWriteTool.execute(
      {
        items: [
          { text: "Read assumptions" },
          { text: "Write DCF", status: "in-progress" },
          { text: "Verify outputs", status: "done" },
        ],
      },
      ctx()
    );
    expect(result.items).toEqual([
      { text: "Read assumptions", status: "pending" },
      { text: "Write DCF", status: "in-progress" },
      { text: "Verify outputs", status: "done" },
    ]);
  });

  it("defaults missing status to 'pending'", async () => {
    const result = await todoWriteTool.execute({ items: [{ text: "x" }] }, ctx());
    expect(result.items[0].status).toBe("pending");
  });

  it("is Read-permission (no approval gate, no mode change)", () => {
    expect(todoWriteTool.requiredPermission).toBe("Read");
  });

  it("schema requires items array", () => {
    const schema = todoWriteTool.inputSchema as { required: string[] };
    expect(schema.required).toEqual(["items"]);
  });
});
