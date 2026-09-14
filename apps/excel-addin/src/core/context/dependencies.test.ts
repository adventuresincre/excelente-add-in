import { describe, expect, it } from "vitest";
import {
  extractFormulaRefs,
  renderDependencyTrace,
  traceDependents,
  tracePrecedents,
} from "./dependencies";
import { inMemoryDataSource } from "./in-memory";
import type { InMemoryWorkbook } from "./in-memory";

/* ---------------------------- extractFormulaRefs --------------------------- */

describe("extractFormulaRefs", () => {
  it("extracts simple cell references", () => {
    const ext = extractFormulaRefs("=B2*C2");
    expect(ext.refs.map((r) => r.text)).toEqual(["B2", "C2"]);
    expect(ext.refs.every((r) => r.kind === "cell" && r.sheetName === undefined)).toBe(true);
  });

  it("extracts range references as a single token", () => {
    const ext = extractFormulaRefs("=SUM(B2:B10)");
    expect(ext.refs).toHaveLength(1);
    expect(ext.refs[0]).toMatchObject({ left: "B2", right: "B10", kind: "cell" });
  });

  it("extracts sheet-qualified and quoted-sheet references", () => {
    const ext = extractFormulaRefs("='My Sheet'!A1+Data!B2");
    expect(ext.refs).toHaveLength(2);
    expect(ext.refs[0].sheetName).toBe("My Sheet");
    expect(ext.refs[1].sheetName).toBe("Data");
  });

  it("does not mistake function names for references", () => {
    const ext = extractFormulaRefs("=LOG10(C3)");
    expect(ext.refs.map((r) => r.text)).toEqual(["C3"]);
    expect(ext.idents).toEqual([]);
  });

  it("skips references inside string literals and flags INDIRECT as dynamic", () => {
    const ext = extractFormulaRefs('=INDIRECT("B2")');
    expect(ext.refs).toHaveLength(0);
    expect(ext.dynamic).toEqual(["INDIRECT"]);
  });

  it("extracts whole-column and whole-row references", () => {
    expect(extractFormulaRefs("=SUM(B:B)").refs[0]).toMatchObject({
      kind: "col",
      left: "B",
      right: "B",
    });
    expect(extractFormulaRefs("=SUM(Data!C:D)").refs[0]).toMatchObject({
      kind: "col",
      sheetName: "Data",
    });
    expect(extractFormulaRefs("=SUM(2:3)").refs[0]).toMatchObject({
      kind: "row",
      left: "2",
      right: "3",
    });
    expect(extractFormulaRefs("=SUM(Data!2:3)").refs[0]).toMatchObject({
      kind: "row",
      sheetName: "Data",
    });
  });

  it("collects bare identifiers as named-range candidates", () => {
    const ext = extractFormulaRefs("=ExitCap*NOI_Total");
    expect(ext.idents).toEqual(["ExitCap", "NOI_Total"]);
    expect(ext.refs).toHaveLength(0);
  });

  it("captures structured table references without resolving them", () => {
    const ext = extractFormulaRefs("=SUM(Table1[Total])");
    expect(ext.structured).toEqual(["Table1[Total]"]);
    expect(ext.refs).toHaveLength(0);
  });

  it("marks unquoted external-workbook references as external", () => {
    const ext = extractFormulaRefs("=[Budget.xlsx]Q1!C3+B2");
    expect(ext.refs).toHaveLength(2);
    expect(ext.refs[0]).toMatchObject({ sheetName: "Q1", external: true });
    expect(ext.refs[1]).toMatchObject({ text: "B2", external: false });
  });

  it("keeps absolute markers in the verbatim text", () => {
    const ext = extractFormulaRefs("=$B$5*A$2");
    expect(ext.refs.map((r) => r.text)).toEqual(["$B$5", "A$2"]);
  });
});

/* ------------------------------ test workbook ------------------------------ */

/**
 * Model!B2..B4 are inputs; Model!D2..D4 is a filled-down formula column;
 * Model!E1 sums a containing range; Summary reads Model cross-sheet and via
 * the ExitCap named range.
 */
const makeWorkbook = (): InMemoryWorkbook => ({
  sheets: [
    {
      name: "Model",
      cells: {
        B1: { value: "Rent" },
        B2: { value: 100 },
        B3: { value: 110 },
        B4: { value: 120 },
        C2: { value: 2 },
        C3: { value: 2 },
        C4: { value: 2 },
        D2: { value: 200, formula: "=B2*C2" },
        D3: { value: 220, formula: "=B3*C3" },
        D4: { value: 240, formula: "=B4*C4" },
        E1: { value: 330, formula: "=SUM(B2:B4)" },
        F1: { value: 330, formula: "=SUM(B:B)" },
      },
    },
    {
      name: "Summary",
      cells: {
        A1: { value: "NOI" },
        B1: { value: 2400, formula: "=Model!D2*12" },
        C1: { value: 0.13, formula: "=ExitCap*2" },
      },
    },
    {
      name: "Inputs",
      cells: {
        A1: { value: "Exit Cap" },
        B1: { value: 0.065 },
      },
    },
  ],
  namedRanges: [
    { name: "ExitCap", scope: "workbook", refersTo: "=Inputs!$B$1" },
    { name: "GrowthCurve", scope: "workbook", refersTo: "=0.03" },
  ],
});

/* ------------------------------- precedents -------------------------------- */

describe("tracePrecedents", () => {
  it("lists the direct inputs of a formula cell", async () => {
    const ds = inMemoryDataSource(makeWorkbook());
    const result = await tracePrecedents(ds, { sheetName: "Model", address: "D2" });
    const locations = result.entries.map((e) => e.location).sort();
    expect(locations).toEqual(["Model!B2", "Model!C2"]);
    expect(result.entries.every((e) => e.depth === 1)).toBe(true);
  });

  it("reports a range reference as one entry with its cell count", async () => {
    const ds = inMemoryDataSource(makeWorkbook());
    const result = await tracePrecedents(ds, { sheetName: "Model", address: "E1" });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({ location: "Model!B2:B4", cellCount: 3 });
  });

  it("resolves named ranges and reports the name as the link", async () => {
    const ds = inMemoryDataSource(makeWorkbook());
    const result = await tracePrecedents(ds, { sheetName: "Summary", address: "C1" });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      location: "Inputs!B1",
      viaName: "ExitCap",
    });
  });

  it("clamps whole-column references to the used range for display", async () => {
    const ds = inMemoryDataSource(makeWorkbook());
    const result = await tracePrecedents(ds, { sheetName: "Model", address: "F1" });
    expect(result.entries).toHaveLength(1);
    // Model's used range spans rows 1-4 → B:B displays as B1:B4.
    expect(result.entries[0].location).toBe("Model!B1:B4");
    expect(result.entries[0].cellCount).toBe(4);
  });

  it("follows the chain transitively at depth 2", async () => {
    const wb = makeWorkbook();
    wb.sheets[1].cells!.D1 = { value: 4800, formula: "=B1*2" }; // Summary!D1 → Summary!B1 → Model!D2
    const ds = inMemoryDataSource(wb);
    const result = await tracePrecedents(ds, { sheetName: "Summary", address: "D1" }, { depth: 2 });
    const d1 = result.entries.filter((e) => e.depth === 1).map((e) => e.location);
    const d2 = result.entries.filter((e) => e.depth === 2).map((e) => e.location);
    expect(d1).toEqual(["Summary!B1"]);
    expect(d2).toEqual(["Model!D2"]);
  });

  it("returns no entries when the target holds no formulas", async () => {
    const ds = inMemoryDataSource(makeWorkbook());
    const result = await tracePrecedents(ds, { sheetName: "Inputs", address: "B1" });
    expect(result.entries).toHaveLength(0);
  });

  it("reports references to unknown sheets as unresolved", async () => {
    const wb = makeWorkbook();
    wb.sheets[0].cells!.G1 = { value: 1, formula: "=Missing!A1" };
    const ds = inMemoryDataSource(wb);
    const result = await tracePrecedents(ds, { sheetName: "Model", address: "G1" });
    expect(result.entries).toHaveLength(0);
    expect(result.unresolved).toEqual([{ text: "Missing!A1", reason: "unknown-sheet" }]);
  });

  it("warns when formulas use INDIRECT/OFFSET", async () => {
    const wb = makeWorkbook();
    wb.sheets[0].cells!.G1 = { value: 1, formula: '=INDIRECT("B"&ROW())' };
    const ds = inMemoryDataSource(wb);
    const result = await tracePrecedents(ds, { sheetName: "Model", address: "G1" });
    expect(result.warnings.some((w) => w.includes("INDIRECT/OFFSET"))).toBe(true);
  });

  it("throws on a sheet that does not exist", async () => {
    const ds = inMemoryDataSource(makeWorkbook());
    await expect(tracePrecedents(ds, { sheetName: "Nope", address: "A1" })).rejects.toThrow(
      "Sheet not found: Nope"
    );
  });
});

/* ------------------------------- dependents -------------------------------- */

describe("traceDependents", () => {
  it("finds direct same-sheet and cross-sheet dependents", async () => {
    const ds = inMemoryDataSource(makeWorkbook());
    const result = await traceDependents(ds, { sheetName: "Model", address: "D2" });
    expect(result.entries.map((e) => e.location)).toEqual(["Summary!B1"]);
    expect(result.entries[0].exampleFormula).toBe("=Model!D2*12");
  });

  it("finds dependents through containing range references", async () => {
    const ds = inMemoryDataSource(makeWorkbook());
    const result = await traceDependents(ds, { sheetName: "Model", address: "B3" });
    const locations = result.entries.map((e) => e.location).sort();
    // B3 feeds D3 (direct), E1 (via SUM(B2:B4)), and F1 (via SUM(B:B)).
    expect(locations).toEqual(["Model!D3", "Model!E1", "Model!F1"]);
  });

  it("finds dependents through named ranges", async () => {
    const ds = inMemoryDataSource(makeWorkbook());
    const result = await traceDependents(ds, { sheetName: "Inputs", address: "B1" });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      location: "Summary!C1",
      viaName: "ExitCap",
    });
  });

  it("is exact for filled-down formulas — only the matching row depends", async () => {
    const ds = inMemoryDataSource(makeWorkbook());
    const result = await traceDependents(ds, { sheetName: "Model", address: "C3" });
    expect(result.entries.map((e) => e.location)).toEqual(["Model!D3"]);
    expect(result.entries[0].cellCount).toBe(1);
  });

  it("collapses a filled-down dependent column into one cluster entry", async () => {
    const ds = inMemoryDataSource(makeWorkbook());
    const result = await traceDependents(ds, { sheetName: "Model", address: "C2:C4" });
    const cluster = result.entries.find((e) => e.location === "Model!D2:D4");
    expect(cluster).toBeDefined();
    expect(cluster).toMatchObject({ cellCount: 3, exampleFormula: "=B2*C2" });
  });

  it("matches sheet names case-insensitively", async () => {
    const wb = makeWorkbook();
    wb.sheets[1].cells!.E1 = { value: 1, formula: "=MODEL!B2+1" };
    const ds = inMemoryDataSource(wb);
    const result = await traceDependents(ds, { sheetName: "model", address: "B2" });
    expect(result.entries.map((e) => e.location)).toContain("Summary!E1");
    expect(result.target).toBe("Model!B2");
  });

  it("follows dependents transitively at depth 2", async () => {
    const ds = inMemoryDataSource(makeWorkbook());
    // B2 → D2 (depth 1) → Summary!B1 (=Model!D2*12, depth 2)
    const result = await traceDependents(ds, { sheetName: "Model", address: "B2" }, { depth: 2 });
    const d2 = result.entries.filter((e) => e.depth === 2).map((e) => e.location);
    expect(d2).toContain("Summary!B1");
  });

  it("does not re-report cells already matched at a shallower depth", async () => {
    const ds = inMemoryDataSource(makeWorkbook());
    const result = await traceDependents(
      ds,
      { sheetName: "Model", address: "B2:C4" },
      { depth: 3 }
    );
    const seen = new Set<string>();
    for (const e of result.entries) {
      const key = `${e.location}|${e.exampleAddress}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("respects scopeSheets", async () => {
    const ds = inMemoryDataSource(makeWorkbook());
    const result = await traceDependents(
      ds,
      { sheetName: "Model", address: "D2" },
      { scopeSheets: ["Model"] }
    );
    expect(result.entries).toHaveLength(0); // the only dependent lives on Summary
    expect(result.scannedSheets).toEqual(["Model"]);
  });

  it("returns no entries when nothing reads the target", async () => {
    const ds = inMemoryDataSource(makeWorkbook());
    const result = await traceDependents(ds, { sheetName: "Summary", address: "C1" });
    expect(result.entries).toHaveLength(0);
    expect(result.scannedFormulaCells).toBeGreaterThan(0);
  });

  it("warns about structured references it cannot see through", async () => {
    const wb = makeWorkbook();
    wb.sheets[0].cells!.G1 = { value: 1, formula: "=SUM(Table1[Total])" };
    const ds = inMemoryDataSource(wb);
    const result = await traceDependents(ds, { sheetName: "Model", address: "B2" });
    expect(result.warnings.some((w) => w.includes("structured or external"))).toBe(true);
    expect(result.unresolved).toContainEqual({
      text: "Table1[Total]",
      reason: "structured",
    });
  });

  it("ignores names that refer to constants rather than ranges", async () => {
    const wb = makeWorkbook();
    wb.sheets[0].cells!.G1 = { value: 0.03, formula: "=GrowthCurve+0" };
    const ds = inMemoryDataSource(wb);
    // GrowthCurve refersTo "=0.03" — not a range, so tracing any cell must
    // not crash, and the G1 formula reports the name as unresolvable.
    const result = await traceDependents(ds, { sheetName: "Inputs", address: "B1" });
    expect(result.unresolved).toContainEqual({
      text: "GrowthCurve",
      reason: "name-not-range",
    });
  });
});

/* --------------------------------- render ---------------------------------- */

describe("renderDependencyTrace", () => {
  it("renders entries grouped by depth with scan stats", async () => {
    const ds = inMemoryDataSource(makeWorkbook());
    const result = await traceDependents(ds, { sheetName: "Model", address: "B2" }, { depth: 2 });
    const text = renderDependencyTrace(result);
    expect(text).toContain("# Dependents of Model!B2 (what reads Model!B2)");
    expect(text).toContain("Direct (depth 1):");
    expect(text).toContain("Depth 2:");
    expect(text).toContain("Summary!B1");
    expect(text).toMatch(/Scanned 3 sheet\(s\), \d+ formula cell\(s\)\./);
  });

  it("says so when there are no dependents", async () => {
    const ds = inMemoryDataSource(makeWorkbook());
    const result = await traceDependents(ds, { sheetName: "Summary", address: "C1" });
    expect(renderDependencyTrace(result)).toContain("No dependents found");
  });

  it("shows the via link for range and named references", async () => {
    const ds = inMemoryDataSource(makeWorkbook());
    const viaRange = await tracePrecedents(ds, { sheetName: "Model", address: "E1" });
    expect(renderDependencyTrace(viaRange)).toContain("via B2:B4");
    const viaName = await traceDependents(ds, { sheetName: "Inputs", address: "B1" });
    expect(renderDependencyTrace(viaName)).toContain('via name "ExitCap"');
  });
});
