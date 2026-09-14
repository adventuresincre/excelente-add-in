import { describe, expect, it } from "vitest";
import { inMemoryDataSource } from "../context";
import { applyRevert, createUndoStack, restorationArray } from "./undo";

describe("createUndoStack", () => {
  it("pushes and pops in LIFO order", () => {
    const stack = createUndoStack();
    stack.push({
      label: "a",
      sheetName: "S",
      address: "A1",
      priorFormulas: [[""]],
      priorValues: [[null]],
    });
    stack.push({
      label: "b",
      sheetName: "S",
      address: "A2",
      priorFormulas: [[""]],
      priorValues: [[null]],
    });
    expect(stack.size()).toBe(2);
    expect(stack.pop()?.label).toBe("b");
    expect(stack.pop()?.label).toBe("a");
    expect(stack.pop()).toBeNull();
  });

  it("respects capacity (oldest dropped)", () => {
    const stack = createUndoStack({ capacity: 2 });
    stack.push({
      label: "a",
      sheetName: "S",
      address: "A1",
      priorFormulas: [[""]],
      priorValues: [[null]],
    });
    stack.push({
      label: "b",
      sheetName: "S",
      address: "A2",
      priorFormulas: [[""]],
      priorValues: [[null]],
    });
    stack.push({
      label: "c",
      sheetName: "S",
      address: "A3",
      priorFormulas: [[""]],
      priorValues: [[null]],
    });
    expect(stack.size()).toBe(2);
    expect(stack.peek()?.label).toBe("c");
    stack.pop();
    expect(stack.peek()?.label).toBe("b"); // "a" was dropped
  });

  it("clear() empties the stack", () => {
    const stack = createUndoStack();
    stack.push({
      label: "a",
      sheetName: "S",
      address: "A1",
      priorFormulas: [[""]],
      priorValues: [[null]],
    });
    stack.clear();
    expect(stack.size()).toBe(0);
    expect(stack.pop()).toBeNull();
  });
});

describe("restorationArray", () => {
  it("restores formulas where present, else literal value", () => {
    const arr = restorationArray({
      label: "x",
      sheetName: "S",
      address: "A1:B1",
      priorFormulas: [["=SUM(C1:D1)", ""]],
      priorValues: [[null, 42]],
    });
    expect(arr).toEqual([["=SUM(C1:D1)", "42"]]);
  });

  it("emits empty string for cells with no prior content", () => {
    const arr = restorationArray({
      label: "x",
      sheetName: "S",
      address: "A1",
      priorFormulas: [[""]],
      priorValues: [[null]],
    });
    expect(arr).toEqual([[""]]);
  });
});

describe("applyRevert", () => {
  it("restores prior contents via the data source's setRange", async () => {
    const ds = inMemoryDataSource({
      sheets: [
        {
          name: "Sheet1",
          cells: {
            A1: { value: "new value" },
            A2: { value: 123 },
          },
        },
      ],
    });

    await applyRevert(ds, {
      label: "restore",
      sheetName: "Sheet1",
      address: "A1:A2",
      priorFormulas: [[""], [""]],
      priorValues: [["old value"], [null]],
    });

    const after = await ds.getRange("Sheet1", "A1:A2");
    expect(after.values[0][0]).toBe("old value");
    // null prior → empty string set → empty literal (null in the in-memory model).
    expect(after.values[1][0]).toBeNull();
  });
});
