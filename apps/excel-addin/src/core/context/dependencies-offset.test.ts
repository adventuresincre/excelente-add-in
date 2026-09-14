import { describe, expect, it } from "vitest";
import { traceDependents, tracePrecedents } from "./dependencies";
import { inMemoryDataSource } from "./in-memory";

/**
 * A table that does not start at A1. Before 2026-09-10 the dependents scan
 * read A1:<columnCount><rowCount> — for this sheet A1:H7 — so the totals row
 * (row 8) and the revenue column (I) were never scanned, and a formula's
 * dependents in either simply did not exist.
 */
const offsetWorkbook = () =>
  inMemoryDataSource({
    sheets: [
      {
        name: "Mix",
        cells: {
          B2: { value: "Unit Mix" },
          B3: { value: "Unit Type" },
          C3: { value: "Units" },
          G3: { value: "Rent" },
          I3: { value: "Monthly Revenue" },
          B4: { value: "Studio" },
          C4: { value: 24 },
          G4: { value: 1400 },
          I4: { value: 33600, formula: "=C4*G4" },
          B5: { value: "1BR" },
          C5: { value: 60 },
          G5: { value: 1750 },
          I5: { value: 105000, formula: "=C5*G5" },
          B8: { value: "Total" },
          C8: { value: 84, formula: "=SUM(C4:C7)" },
          I8: { value: 138600, formula: "=SUM(I4:I7)" },
        },
      },
    ],
  });

describe("trace_dependencies on a table that does not start at A1", () => {
  it("finds dependents in the last column and the last row of the used range", async () => {
    const result = await traceDependents(offsetWorkbook(), { sheetName: "Mix", address: "C4" });
    const locations = result.entries.map((e) => e.location).sort();
    expect(locations).toEqual(["Mix!C8", "Mix!I4"]);
  });

  it("reports scanned formula cells with their absolute addresses", async () => {
    const result = await traceDependents(offsetWorkbook(), { sheetName: "Mix", address: "I4:I5" });
    expect(result.entries.map((e) => e.location)).toEqual(["Mix!I8"]);
    expect(result.entries[0].exampleFormula).toBe("=SUM(I4:I7)");
  });

  it("precedents still resolve on the same sheet", async () => {
    const result = await tracePrecedents(offsetWorkbook(), { sheetName: "Mix", address: "I8" });
    expect(result.entries.map((e) => e.location)).toContain("Mix!I4:I7");
  });
});
