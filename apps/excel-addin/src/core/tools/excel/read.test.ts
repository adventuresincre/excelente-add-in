import { describe, expect, it } from "vitest";
import { inMemoryDataSource } from "../../context";
import { createToolRegistry } from "../registry";
import { createUndoStack } from "../undo";
import { getSelectionTool, inspectWorkbookTool, readTools } from "./read";

const ctx = (ds: ReturnType<typeof inMemoryDataSource>) => ({ ds, undoStack: createUndoStack() });

const makeDs = () =>
  inMemoryDataSource({
    sheets: [
      {
        name: "Summary",
        cells: {
          A1: { value: "Label" },
          B1: { value: "Jan" },
          C1: { value: "Feb" },
          A2: { value: "Rev" },
          B2: { value: 100 },
          C2: { value: 150 },
          B3: { value: 200, formula: "=B2*2" },
          C3: { value: 300, formula: "=C2*2" },
        },
        chartCount: 1,
      },
      { name: "Notes", cells: { A1: { value: "Hello" } } },
    ],
    namedRanges: [{ name: "Revenue", scope: "workbook", refersTo: "=Summary!$B$2:$C$2" }],
    activeSheet: "Summary",
    selection: { sheetName: "Summary", address: "B3" },
  });

describe("inspect_workbook tool", () => {
  it("scope=workbook returns the workbook outline text", async () => {
    const ds = makeDs();
    const result = (await inspectWorkbookTool.execute({ scope: "workbook" }, ctx(ds))) as string;
    expect(typeof result).toBe("string");
    expect(result).toContain("# Workbook outline");
    expect(result).toContain("Summary");
    expect(result).toContain("Notes");
    expect(result).toContain("Revenue =");
  });

  it("scope=workbook defaults detail to outline", async () => {
    const ds = makeDs();
    const result = (await inspectWorkbookTool.execute({ scope: "workbook" }, ctx(ds))) as string;
    expect(result).toContain("# Workbook outline");
  });

  it("scope=sheet returns the sheet outline (requires sheetName)", async () => {
    const ds = makeDs();
    const result = (await inspectWorkbookTool.execute(
      { scope: "sheet", sheetName: "Summary" },
      ctx(ds)
    )) as string;
    expect(result).toContain("# Sheet: Summary");
    expect(result).toContain("B3:C3");
    expect(result).toContain("`=B2*2`");
  });

  it("scope=sheet without sheetName throws a clear error", async () => {
    const ds = makeDs();
    await expect(inspectWorkbookTool.execute({ scope: "sheet" }, ctx(ds))).rejects.toThrow(
      /requires sheetName/
    );
  });

  it("scope=range returns structured { values, formulas } by default", async () => {
    const ds = makeDs();
    const result = await inspectWorkbookTool.execute(
      {
        scope: "range",
        sheetName: "Summary",
        address: "B2:C3",
        detail: "full",
      },
      ctx(ds)
    );
    expect(result).toMatchObject({
      address: "Summary!B2:C3",
      values: [
        [100, 150],
        [200, 300],
      ],
      formulas: [
        ["", ""],
        ["=B2*2", "=C2*2"],
      ],
    });
  });

  it("scope=range with format=csv returns a CSV string (drops formulas)", async () => {
    const ds = makeDs();
    const result = await inspectWorkbookTool.execute(
      { scope: "range", sheetName: "Summary", address: "B2:C2", format: "csv" },
      ctx(ds)
    );
    expect(typeof result).toBe("string");
    // First line is the address comment; subsequent lines are CSV rows.
    expect(result).toMatch(/^# Summary!B2:C2\s*\n100,150/);
  });

  it("scope=range without sheetName + address throws", async () => {
    const ds = makeDs();
    await expect(inspectWorkbookTool.execute({ scope: "range" }, ctx(ds))).rejects.toThrow(
      /requires both sheetName and address/
    );
  });

  it("scope=workbook + detail=full rejects with a guiding error", async () => {
    const ds = makeDs();
    await expect(
      inspectWorkbookTool.execute({ scope: "workbook", detail: "full" }, ctx(ds))
    ).rejects.toThrow(/scope="sheet" or scope="range"/);
  });

  it("is a Read-permission tool", () => {
    expect(inspectWorkbookTool.requiredPermission).toBe("Read");
  });

  it("scope=range + format=csv returns a CSV string instead of {values,formulas}", async () => {
    const ds = makeDs();
    const result = await inspectWorkbookTool.execute(
      { scope: "range", sheetName: "Summary", address: "B2:C3", format: "csv" },
      ctx(ds)
    );
    expect(typeof result).toBe("string");
    const csv = result as string;
    // Header line names the resolved address; data follows.
    expect(csv).toContain("Summary!B2:C3");
    expect(csv).toContain("100,150");
    expect(csv).toContain("200,300");
  });

  it("CSV format escapes cells containing commas / quotes / newlines", async () => {
    const ds = inMemoryDataSource({
      sheets: [
        {
          name: "S",
          cells: {
            A1: { value: "hello, world" },
            B1: { value: 'she said "hi"' },
            A2: { value: "line1\nline2" },
            B2: { value: "plain" },
          },
        },
      ],
    });
    const result = (await inspectWorkbookTool.execute(
      { scope: "range", sheetName: "S", address: "A1:B2", format: "csv" },
      ctx(ds)
    )) as string;
    expect(result).toContain('"hello, world"');
    expect(result).toContain('"she said ""hi"""');
    expect(result).toContain('"line1\nline2"');
    expect(result).toContain("plain");
  });
});

describe("inspect_workbook range reads say when they stop short of data", () => {
  // The 2026-09-10 case: a B2:I8 table read as A2:H8. The agent saw totals
  // formulas referencing column I, which it had not read, and called them bugs.
  const tableDs = () =>
    inMemoryDataSource({
      sheets: [
        {
          name: "Sheet1",
          cells: {
            B2: { value: "Unit Mix" },
            B3: { value: "Unit Type" },
            H3: { value: "Rent PSF" },
            I3: { value: "Monthly Revenue" },
            B4: { value: "Studio" },
            H4: { value: 2.55 },
            I4: { value: 33600, formula: "=C4*G4" },
            B8: { value: "Total" },
            H8: { value: 2.27, formula: "=I8/F8" },
            I8: { value: 277000, formula: "=SUM(I4:I7)" },
          },
        },
      ],
    });

  it("names the column just past a short read, with what is in it", async () => {
    const result = await inspectWorkbookTool.execute(
      { scope: "range", sheetName: "Sheet1", address: "A2:H8" },
      ctx(tableDs())
    );
    expect(result).toMatchObject({ address: "Sheet1!A2:H8" });
    const note = (result as { note?: string }).note ?? "";
    expect(note).toContain("used range (B2:I8)");
    expect(note).toContain('to the right in column I: I3 = "Monthly Revenue"');
    expect(note).not.toContain("to the left");
  });

  it("names rows above and below, and formulas show in brackets", async () => {
    const result = await inspectWorkbookTool.execute(
      { scope: "range", sheetName: "Sheet1", address: "B3:I7" },
      ctx(tableDs())
    );
    const note = (result as { note?: string }).note ?? "";
    expect(note).toContain('above in row 2: B2 = "Unit Mix"');
    expect(note).toContain('below in row 8: B8 = "Total"');
    expect(note).not.toContain("to the right");
  });

  it("stays silent when the read covers the block", async () => {
    const full = await inspectWorkbookTool.execute(
      { scope: "range", sheetName: "Sheet1", address: "B2:I8" },
      ctx(tableDs())
    );
    expect((full as { note?: string }).note).toBeUndefined();
    const wider = await inspectWorkbookTool.execute(
      { scope: "range", sheetName: "Sheet1", address: "A1:K12" },
      ctx(tableDs())
    );
    expect((wider as { note?: string }).note).toBeUndefined();
  });

  it("appends the note to CSV output as a comment line", async () => {
    const csv = await inspectWorkbookTool.execute(
      { scope: "range", sheetName: "Sheet1", address: "B2:H8", format: "csv" },
      ctx(tableDs())
    );
    expect(typeof csv).toBe("string");
    expect(csv as string).toMatch(/\n# NOTE: Your range stops short .*column I/);
  });
});

describe("other read tools — exec output", () => {
  it("get_selection returns the current selection", async () => {
    const ds = makeDs();
    const sel = await getSelectionTool.execute({}, ctx(ds));
    expect(sel).toEqual({ sheetName: "Summary", address: "B3" });
  });
});

describe("read tools — registry shape", () => {
  it("readTools registers 4 distinct read-only tools", () => {
    const reg = createToolRegistry(readTools);
    expect(reg.all()).toHaveLength(4);
    expect(reg.all().map((t) => t.name)).toContain("trace_dependencies");
    expect(reg.all().map((t) => t.name)).toContain("find_cells");
    for (const tool of reg.all()) {
      expect(tool.requiredPermission).toBe("Read");
    }
  });

  it("each tool has a valid JSON Schema input", () => {
    for (const tool of readTools) {
      expect(tool.inputSchema).toMatchObject({ type: "object" });
      expect(typeof tool.description).toBe("string");
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });

  it("toWireFormat emits the OpenRouter tool shape for the LLM (inspect_workbook is first)", () => {
    const reg = createToolRegistry(readTools);
    const wire = reg.toWireFormat();
    expect(wire).toHaveLength(4);
    expect(wire[0]).toMatchObject({
      type: "function",
      function: { name: "inspect_workbook" },
    });
  });
});

/**
 * Column width was unreadable by any tool before this: it is not a cell
 * value, and `Range.getImage` renders cells WITHOUT the row/column headers,
 * so it was not in a screenshot either. An agent could set a width and had
 * no way to confirm it held — while the house conventions specify one
 * (column A is a width-2 rail).
 */
describe("scope=range reports dimensions", () => {
  const laidOut = () =>
    inMemoryDataSource({
      sheets: [
        {
          name: "Unit Mix",
          // The A.CRE rail: A is a narrow gutter, B holds long labels.
          columnWidths: { A: 2, B: 24, C: 10 },
          rowHeights: { 1: 14.4, 2: 22 },
          cells: {
            B2: { value: "Unit Mix" },
            B3: { value: "Unit mix type" },
            C3: { value: "Conventional" },
          },
        },
      ],
    });

  it("returns one width per column and one height per row, in range order", async () => {
    const ds = laidOut();
    const result = (await inspectWorkbookTool.execute(
      { scope: "range", sheetName: "Unit Mix", address: "A1:C3" },
      ctx(ds)
    )) as { columnWidths: number[]; rowHeights: number[] };

    expect(result.columnWidths).toEqual([2, 24, 10]);
    expect(result.rowHeights).toEqual([14.4, 22, 14.4]);
  });

  // The whole point: a convention that cannot be checked is a convention
  // that silently rots.
  it("makes the width-2 rail verifiable", async () => {
    const ds = laidOut();
    const result = (await inspectWorkbookTool.execute(
      { scope: "range", sheetName: "Unit Mix", address: "A1:A1" },
      ctx(ds)
    )) as { columnWidths: number[] };
    expect(result.columnWidths[0]).toBe(2);
  });

  it("offsets correctly for a range that does not start at A1", async () => {
    const ds = laidOut();
    const result = (await inspectWorkbookTool.execute(
      { scope: "range", sheetName: "Unit Mix", address: "B2:C3" },
      ctx(ds)
    )) as { columnWidths: number[]; rowHeights: number[] };
    expect(result.columnWidths).toEqual([24, 10]);
    expect(result.rowHeights).toEqual([22, 14.4]);
  });

  // CSV is the values-only cheap path; dimensions would be noise there.
  it("omits dimensions from the csv rendering", async () => {
    const ds = laidOut();
    const result = await inspectWorkbookTool.execute(
      { scope: "range", sheetName: "Unit Mix", address: "B2:C3", format: "csv" },
      ctx(ds)
    );
    expect(typeof result).toBe("string");
    expect(result as string).not.toContain("columnWidths");
  });
});
