import { describe, expect, it } from "vitest";
import { inMemoryDataSource, type InMemoryWorkbook } from "../../context";
import { createUndoStack } from "../undo";
import { findCellsTool } from "./find";

function unitMixWorkbook(): InMemoryWorkbook {
  return {
    sheets: [
      {
        name: "Sheet1",
        cells: {
          B2: { value: "Unit Mix" },
          B3: { value: "Unit Type" },
          C3: { value: "Units" },
          I3: { value: "Monthly Revenue" },
          B4: { value: "Studio" },
          C4: { value: 24 },
          I4: { value: 33600, formula: "=C4*G4" },
          B8: { value: "Total" },
          C8: { value: 140, formula: "=SUM(C4:C7)" },
          I8: { value: 277000, formula: "=SUM(I4:I7)" },
        },
      },
      {
        name: "Notes",
        cells: { A1: { value: "See the unit mix on Sheet1" } },
      },
    ],
  };
}

const ctx = () => ({ ds: inMemoryDataSource(unitMixWorkbook()), undoStack: createUndoStack() });

describe("find_cells", () => {
  it("locates a label anywhere in the workbook by absolute address", async () => {
    const result = await findCellsTool.execute({ query: "unit mix" }, ctx());
    expect(result.matches).toEqual([
      'Sheet1!B2 = "Unit Mix"',
      'Notes!A1 = "See the unit mix on Sheet1"',
    ]);
    expect(result.count).toBe(2);
    expect(result.truncated).toBe(false);
  });

  it("searches formulas too and shows the formula in brackets", async () => {
    const result = await findCellsTool.execute({ query: "SUM(", sheetName: "Sheet1" }, ctx());
    expect(result.matches).toEqual([
      "Sheet1!C8 = 140 [=SUM(C4:C7)]",
      "Sheet1!I8 = 277000 [=SUM(I4:I7)]",
    ]);
  });

  it("finds every formula that mentions a cell — the dependents question, cheaply", async () => {
    const result = await findCellsTool.execute({ query: "C4" }, ctx());
    expect(result.matches).toEqual(["Sheet1!I4 = 33600 [=C4*G4]", "Sheet1!C8 = 140 [=SUM(C4:C7)]"]);
  });

  it("supports regular expressions", async () => {
    const result = await findCellsTool.execute({ query: "^total$", regex: true }, ctx());
    expect(result.matches).toEqual(['Sheet1!B8 = "Total"']);
  });

  it("rejects a bad regex with a message that names the fix", async () => {
    await expect(findCellsTool.execute({ query: "(", regex: true }, ctx())).rejects.toThrow(
      /not a valid regular expression.*Drop `regex`/
    );
  });

  it("caps the list but still reports the full count", async () => {
    const result = await findCellsTool.execute({ query: "e", limit: 2 }, ctx());
    expect(result.matches).toHaveLength(2);
    expect(result.count).toBeGreaterThan(2);
    expect(result.truncated).toBe(true);
  });

  it("names the available sheets when sheetName is wrong", async () => {
    await expect(findCellsTool.execute({ query: "x", sheetName: "Nope" }, ctx())).rejects.toThrow(
      /sheet "Nope" not found. Sheets: Sheet1, Notes/
    );
  });

  it("returns no matches, not an error, when nothing fits", async () => {
    const result = await findCellsTool.execute({ query: "zzz" }, ctx());
    expect(result).toEqual({ matches: [], count: 0, truncated: false });
  });

  it("is a Read-permission tool", () => {
    expect(findCellsTool.requiredPermission).toBe("Read");
  });
});
