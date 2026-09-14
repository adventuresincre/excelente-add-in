import { describe, expect, it, vi } from "vitest";
import { inMemoryDataSource, type CellValue, type InMemoryWorkbook } from "./in-memory";
import type { ExcelDataSource } from "./datasource";
import { readRange } from "./range-read";

/** Wrap a data source to count `getRange` calls. */
function instrument(base: ExcelDataSource): { ds: ExcelDataSource; calls: string[] } {
  const calls: string[] = [];
  const ds: ExcelDataSource = {
    listSheets: () => base.listSheets(),
    getNamedRanges: () => base.getNamedRanges(),
    getActiveSheet: () => base.getActiveSheet(),
    getSelection: () => base.getSelection(),
    createSheet: (name, opts) => base.createSheet(name, opts),
    setRange: (sheetName, address, formulas) => base.setRange(sheetName, address, formulas),
    setFormat: (sheetName, address, format) => base.setFormat(sheetName, address, format),
    listCharts: (sheetName) => base.listCharts(sheetName),
    getChartImage: (sheetName, selector) => base.getChartImage(sheetName, selector),
    ensureHiddenSheet: (name) => base.ensureHiddenSheet(name),
    onWorkbookSaved: (handler) => base.onWorkbookSaved(handler),
    onSheetChanged: (handler) => base.onSheetChanged(handler),
    onSelectionChanged: (handler) => base.onSelectionChanged(handler),
    fillRange: (sheetName, seed, target) => base.fillRange(sheetName, seed, target),
    getRangeImage: (sheetName, address) => base.getRangeImage(sheetName, address),
    supportsWorksheetInsert: () => base.supportsWorksheetInsert(),
    insertWorksheetsFromBase64: (b64) => base.insertWorksheetsFromBase64(b64),
    async getRange(sheetName, address) {
      calls.push(address);
      return base.getRange(sheetName, address);
    },
  };
  return { ds, calls };
}

function buildGrid(rows: number, cols: number): InMemoryWorkbook {
  const cells: Record<string, { value?: CellValue; formula?: string }> = {};
  for (let r = 1; r <= rows; r++) {
    for (let c = 0; c < cols; c++) {
      const colLetter = String.fromCharCode(65 + c);
      cells[`${colLetter}${r}`] = { value: r * 100 + c };
    }
  }
  return { sheets: [{ name: "Sheet1", cells }] };
}

describe("readRange", () => {
  it("passes through a small range as a single chunk", async () => {
    const { ds, calls } = instrument(inMemoryDataSource(buildGrid(10, 5)));
    const data = await readRange(ds, "Sheet1", "A1:E10");
    expect(calls).toHaveLength(1);
    expect(data.rowCount).toBe(10);
    expect(data.columnCount).toBe(5);
    expect(data.values[0]).toEqual([100, 101, 102, 103, 104]);
    expect(data.values[9]).toEqual([1000, 1001, 1002, 1003, 1004]);
  });

  it("slices a large range by rows", async () => {
    const { ds, calls } = instrument(inMemoryDataSource(buildGrid(1000, 10)));
    // 10,000 cells with chunkSize 3,000 -> stripes of 300 rows -> 4 chunks.
    const data = await readRange(ds, "Sheet1", "A1:J1000", { chunkSize: 3000 });
    expect(calls).toHaveLength(4);
    expect(calls).toEqual(["A1:J300", "A301:J600", "A601:J900", "A901:J1000"]);
    expect(data.rowCount).toBe(1000);
    expect(data.columnCount).toBe(10);
    // Spot-check first, middle, last rows
    expect(data.values[0][0]).toBe(100);
    expect(data.values[500][3]).toBe(50103);
    expect(data.values[999][9]).toBe(100009);
  });

  it("preserves formulas across chunks", async () => {
    const cells: Record<string, { value?: CellValue; formula?: string }> = {};
    for (let r = 1; r <= 200; r++) {
      cells[`A${r}`] = { value: r, formula: r > 1 ? `=A${r - 1}+1` : undefined };
    }
    const { ds } = instrument(inMemoryDataSource({ sheets: [{ name: "S", cells }] }));
    const data = await readRange(ds, "S", "A1:A200", { chunkSize: 50 });
    expect(data.rowCount).toBe(200);
    expect(data.formulas[0][0]).toBe("");
    expect(data.formulas[1][0]).toBe("=A1+1");
    expect(data.formulas[199][0]).toBe("=A199+1");
  });

  it("uses at most rowsPerChunk = 1 when a single row exceeds chunkSize", async () => {
    const { ds, calls } = instrument(inMemoryDataSource(buildGrid(5, 26)));
    // chunkSize=10 < cols=26 -> rowsPerChunk floors to 1; expect 5 chunks
    await readRange(ds, "Sheet1", "A1:Z5", { chunkSize: 10 });
    expect(calls).toHaveLength(5);
    expect(calls[0]).toBe("A1:Z1");
    expect(calls[4]).toBe("A5:Z5");
  });

  it("respects the concurrency cap", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const base = inMemoryDataSource(buildGrid(1000, 10));
    const ds: ExcelDataSource = {
      listSheets: () => base.listSheets(),
      getNamedRanges: () => base.getNamedRanges(),
      getActiveSheet: () => base.getActiveSheet(),
      getSelection: () => base.getSelection(),
      createSheet: (name, opts) => base.createSheet(name, opts),
      setRange: (sheetName, address, formulas) => base.setRange(sheetName, address, formulas),
      setFormat: (sheetName, address, format) => base.setFormat(sheetName, address, format),
      listCharts: (sheetName) => base.listCharts(sheetName),
      getChartImage: (sheetName, selector) => base.getChartImage(sheetName, selector),
      ensureHiddenSheet: (name) => base.ensureHiddenSheet(name),
      onWorkbookSaved: (handler) => base.onWorkbookSaved(handler),
      onSheetChanged: (handler) => base.onSheetChanged(handler),
      onSelectionChanged: (handler) => base.onSelectionChanged(handler),
      fillRange: (sheetName, seed, target) => base.fillRange(sheetName, seed, target),
      getRangeImage: (sheetName, address) => base.getRangeImage(sheetName, address),
      supportsWorksheetInsert: () => base.supportsWorksheetInsert(),
      insertWorksheetsFromBase64: (b64) => base.insertWorksheetsFromBase64(b64),
      async getRange(sheetName, address) {
        inFlight++;
        if (inFlight > maxInFlight) maxInFlight = inFlight;
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
        return base.getRange(sheetName, address);
      },
    };
    await readRange(ds, "Sheet1", "A1:J1000", { chunkSize: 1000, concurrency: 2 });
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });
});

describe("readRange — total-cell ceiling", () => {
  it("refuses a whole-sheet address before planning any chunks", async () => {
    // inspect_workbook is a Read tool: it runs with no approval prompt, so
    // a bad address from the model reaches this directly.
    const getRange = vi.fn();
    const ds = { getRange } as unknown as ExcelDataSource;

    await expect(readRange(ds, "Sheet1", "A1:XFD1048576")).rejects.toThrow(
      /over the .* read limit/
    );
    // Fails before any Office.js call and before stripe planning.
    expect(getRange).not.toHaveBeenCalled();
  });

  it("allows a large-but-reasonable range", async () => {
    const ds = inMemoryDataSource({ sheets: [{ name: "Sheet1" }] });
    await expect(readRange(ds, "Sheet1", "A1:J1000")).resolves.toBeDefined();
  });
});
