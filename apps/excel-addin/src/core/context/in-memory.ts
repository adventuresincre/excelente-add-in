import {
  columnIndexToLetter,
  formatA1,
  formatRange,
  parseRange,
  rangeColumnCount,
  rangeRowCount,
} from "./address";
import type { ExcelDataSource, RangeFormat } from "./datasource";
import type { NamedRangeInfo, SheetSummary } from "./types";

/**
 * Excel's own defaults in POINTS, matching what Office.js reports, so a
 * fixture that sets nothing still reports what the real host would. 48pt is
 * the default column (= 8.43 character units = 64px) — measured in a live
 * host, not assumed.
 */
const DEFAULT_COLUMN_WIDTH = 48;
const DEFAULT_ROW_HEIGHT = 14.4;

export interface InMemorySheet {
  name: string;
  visible?: boolean;
  /** Cells keyed by A1 address. Cells absent from this map are empty. */
  cells?: Record<string, { value?: CellValue; formula?: string }>;
  /**
   * Column widths in POINTS, keyed by column letter ("A": 20). Points, not
   * the character units the Column Width dialog shows — that is the unit
   * Office.js reads and writes. Absent columns report the Excel default.
   */
  columnWidths?: Record<string, number>;
  /** Row heights in points, keyed by 1-based row number ("1": 14.4). */
  rowHeights?: Record<number, number>;
  /** Charts present on the sheet. `chartCount` is derived from `charts.length` when this is set. */
  charts?: { name: string; pngDataUrl: string }[];
  /** Legacy: count without names. If `charts` is set, this is ignored. */
  chartCount?: number;
  pivotCount?: number;
  /** Test-only history of setFormat invocations; populated by inMemoryDataSource. */
  appliedFormats?: { address: string; format: RangeFormat }[];
}

export interface InMemoryWorkbook {
  sheets: InMemorySheet[];
  namedRanges?: NamedRangeInfo[];
  activeSheet?: string;
  /** Simulated selection — defaults to A1 on the active sheet when omitted. */
  selection?: { sheetName: string; address: string };
}

export type CellValue = string | number | boolean | null;

/**
 * Test data source backed by an in-memory workbook structure.
 * Implements the same contract as `officeDataSource()` so context-engine
 * code can be tested without sideloading Excel.
 */
export function inMemoryDataSource(wb: InMemoryWorkbook): ExcelDataSource & {
  /** Test-only: fire a saved event so subscribed handlers run. */
  emitSaved: () => void;
  /** Test-only: fire a sheet-change event so subscribed handlers run. */
  emitSheetChange: (event: { sheetName: string; address: string; changeType?: string }) => void;
  /** Test-only: move the simulated selection and notify subscribers. */
  emitSelectionChange: (sel: { sheetName: string; address: string } | null) => void;
} {
  const savedListeners = new Set<() => void>();
  const changedListeners = new Set<
    (event: { sheetName: string; address: string; changeType?: string }) => void
  >();
  const selectionListeners = new Set<
    (sel: { sheetName: string; address: string } | null) => void
  >();
  return {
    async createSheet(name, opts) {
      const taken = new Set(wb.sheets.map((s) => s.name.toLowerCase()));
      let finalName = name;
      if (taken.has(name.toLowerCase())) {
        let n = 2;
        while (taken.has(`${name} (${n})`.toLowerCase())) n++;
        finalName = `${name} (${n})`;
      }
      const sheet: InMemorySheet = { name: finalName, cells: {} };
      const at = opts?.position;
      if (at === undefined || at >= wb.sheets.length) wb.sheets.push(sheet);
      else wb.sheets.splice(Math.max(0, at), 0, sheet);
      if (opts?.activate !== false) wb.activeSheet = finalName;
      return { name: finalName, ...(finalName !== name && { renamedFrom: name }) };
    },

    async listSheets() {
      return wb.sheets.map((s, i): SheetSummary => {
        const { rows, cols, address } = computeUsedRange(s.cells);
        const chartCount = s.charts?.length ?? s.chartCount ?? 0;
        return {
          name: s.name,
          position: i,
          visible: s.visible !== false,
          rowCount: rows,
          columnCount: cols,
          usedRange: address,
          hasCharts: chartCount > 0,
          hasPivots: (s.pivotCount ?? 0) > 0,
        };
      });
    },

    async getNamedRanges() {
      return wb.namedRanges ?? [];
    },

    async getActiveSheet() {
      return wb.activeSheet ?? wb.sheets[0]?.name ?? null;
    },

    async getSelection() {
      if (wb.selection) return wb.selection;
      const sheetName = wb.activeSheet ?? wb.sheets[0]?.name;
      if (!sheetName) return null;
      return { sheetName, address: "A1" };
    },

    async getRange(sheetName, address) {
      const sheet = wb.sheets.find((s) => s.name === sheetName);
      if (!sheet) throw new Error(`Sheet not found: ${sheetName}`);

      const range = parseRange(address);
      const rows = rangeRowCount(range);
      const cols = rangeColumnCount(range);

      const values: CellValue[][] = [];
      const formulas: string[][] = [];

      for (let r = 0; r < rows; r++) {
        const valueRow: CellValue[] = [];
        const formulaRow: string[] = [];
        for (let c = 0; c < cols; c++) {
          const a1 = formatA1({
            col: range.topLeft.col + c,
            row: range.topLeft.row + r,
          });
          const cell = sheet.cells?.[a1];
          valueRow.push(cell?.value ?? null);
          formulaRow.push(cell?.formula ?? "");
        }
        values.push(valueRow);
        formulas.push(formulaRow);
      }

      // Excel's own defaults, so a fixture that sets nothing still reports
      // plausible dimensions rather than undefined — the production source
      // always returns a number per column.
      const columnWidths = Array.from({ length: cols }, (_, c) => {
        const letter = columnIndexToLetter(range.topLeft.col + c);
        return sheet.columnWidths?.[letter] ?? DEFAULT_COLUMN_WIDTH;
      });
      const rowHeights = Array.from(
        { length: rows },
        (_, r) => sheet.rowHeights?.[range.topLeft.row + r + 1] ?? DEFAULT_ROW_HEIGHT
      );

      return {
        address: `${sheetName}!${address.toUpperCase()}`,
        values,
        formulas,
        rowCount: rows,
        columnCount: cols,
        columnWidths,
        rowHeights,
      };
    },

    async getRangeDimensions(sheetName, address) {
      const sheet = wb.sheets.find((s) => s.name === sheetName);
      if (!sheet) throw new Error(`Sheet not found: ${sheetName}`);
      const used = computeUsedRange(sheet.cells).address;
      const local = address && address.length > 0 ? address : used;
      if (!local) throw new Error(`Sheet "${sheetName}" has no used range`);
      const range = parseRange(local);
      const cols = rangeColumnCount(range);
      const rows = rangeRowCount(range);
      return {
        address: `${sheetName}!${local.toUpperCase()}`,
        columnWidths: Array.from({ length: cols }, (_, c) => {
          const letter = columnIndexToLetter(range.topLeft.col + c);
          return sheet.columnWidths?.[letter] ?? DEFAULT_COLUMN_WIDTH;
        }),
        rowHeights: Array.from(
          { length: rows },
          (_, r) => sheet.rowHeights?.[range.topLeft.row + r + 1] ?? DEFAULT_ROW_HEIGHT
        ),
      };
    },

    async listCharts(sheetName) {
      const sheet = wb.sheets.find((s) => s.name === sheetName);
      if (!sheet) throw new Error(`Sheet not found: ${sheetName}`);
      return (sheet.charts ?? []).map((c, i) => ({ name: c.name, index: i }));
    },

    async getChartImage(sheetName, selector) {
      const sheet = wb.sheets.find((s) => s.name === sheetName);
      if (!sheet) throw new Error(`Sheet not found: ${sheetName}`);
      const charts = sheet.charts ?? [];
      const chart =
        "chartName" in selector
          ? charts.find((c) => c.name === selector.chartName)
          : charts[selector.chartIndex];
      if (!chart) {
        const which =
          "chartName" in selector ? `"${selector.chartName}"` : `index ${selector.chartIndex}`;
        throw new Error(`Chart ${which} not found on sheet "${sheetName}"`);
      }
      return chart.pngDataUrl;
    },

    async getRangeImage(sheetName, address) {
      const sheet = wb.sheets.find((s) => s.name === sheetName);
      if (!sheet) throw new Error(`Sheet not found: ${sheetName}`);
      // In tests, we don't render an actual image. Return a deterministic
      // placeholder so callers see a non-empty data URL and assertions can
      // exercise the result shape without depending on a renderer.
      const label = address && address.length > 0 ? `${sheetName}!${address}` : sheetName;
      const placeholder = `placeholder-${label}`;
      const b64 =
        typeof Buffer !== "undefined"
          ? Buffer.from(placeholder).toString("base64")
          : btoa(placeholder);
      return `data:image/png;base64,${b64}`;
    },

    async setFormat(sheetName, address, format) {
      const sheet = wb.sheets.find((s) => s.name === sheetName);
      if (!sheet) throw new Error(`Sheet not found: ${sheetName}`);
      // Track applied formats per range so tests can inspect what the tool
      // requested; we don't simulate any visual rendering.
      if (!sheet.appliedFormats) sheet.appliedFormats = [];
      sheet.appliedFormats.push({ address, format });
    },

    async ensureHiddenSheet(name) {
      const existing = wb.sheets.find((s) => s.name === name);
      if (existing) return;
      wb.sheets.push({ name, visible: false });
    },

    supportsWorksheetInsert() {
      // The in-memory source has no Office.js host — report supported so
      // tests can exercise the insert path against the stub below.
      return true;
    },

    async insertWorksheetsFromBase64() {
      // Tests don't have a real source workbook to parse; simulate a
      // single inserted sheet so callers can assert the wiring. Real
      // behavior lives in the Office.js implementation.
      const name = `Imported${wb.sheets.length}`;
      wb.sheets.push({ name, visible: true });
      return [name];
    },

    onWorkbookSaved(handler) {
      savedListeners.add(handler);
      return () => {
        savedListeners.delete(handler);
      };
    },

    onSheetChanged(handler) {
      changedListeners.add(handler);
      return () => {
        changedListeners.delete(handler);
      };
    },

    onSelectionChanged(handler) {
      selectionListeners.add(handler);
      return () => {
        selectionListeners.delete(handler);
      };
    },

    async setRange(sheetName, address, formulas) {
      const sheet = wb.sheets.find((s) => s.name === sheetName);
      if (!sheet) throw new Error(`Sheet not found: ${sheetName}`);

      const range = parseRange(address);
      const expectedRows = rangeRowCount(range);
      const expectedCols = rangeColumnCount(range);

      if (formulas.length !== expectedRows) {
        throw new Error(
          `setRange: row count mismatch — got ${formulas.length}, expected ${expectedRows} for ${address}`
        );
      }
      for (let r = 0; r < expectedRows; r++) {
        if (formulas[r].length !== expectedCols) {
          throw new Error(
            `setRange: col count mismatch on row ${r} — got ${formulas[r].length}, expected ${expectedCols}`
          );
        }
      }

      if (!sheet.cells) sheet.cells = {};

      for (let r = 0; r < expectedRows; r++) {
        for (let c = 0; c < expectedCols; c++) {
          const raw = formulas[r][c];
          const a1 = formatA1({
            col: range.topLeft.col + c,
            row: range.topLeft.row + r,
          });
          if (raw.startsWith("=")) {
            // Formula. We don't simulate evaluation; preserve any prior value.
            const prior = sheet.cells[a1]?.value ?? null;
            sheet.cells[a1] = { value: prior, formula: raw };
          } else {
            // Literal value. Coerce to number if numeric, else string, else null.
            sheet.cells[a1] = { value: coerceLiteral(raw) };
          }
        }
      }
    },

    async fillRange(sheetName, seedAddress, targetAddress) {
      const sheet = wb.sheets.find((s) => s.name === sheetName);
      if (!sheet) throw new Error(`Sheet not found: ${sheetName}`);
      if (!sheet.cells) sheet.cells = {};

      const seed = parseRange(seedAddress);
      const target = parseRange(targetAddress);
      const seedRows = rangeRowCount(seed);
      const seedCols = rangeColumnCount(seed);
      const targetRows = rangeRowCount(target);
      const targetCols = rangeColumnCount(target);

      // Simulate fillDefault: tile the seed across the target. Real Excel
      // autoFill adjusts relative references in formulas; the in-memory
      // model doesn't simulate that — tests should target deterministic
      // tiling, not formula-relative behavior. Production uses Excel's own
      // autoFill which DOES adjust references.
      for (let r = 0; r < targetRows; r++) {
        for (let c = 0; c < targetCols; c++) {
          const srcA1 = formatA1({
            col: seed.topLeft.col + (c % seedCols),
            row: seed.topLeft.row + (r % seedRows),
          });
          const dstA1 = formatA1({
            col: target.topLeft.col + c,
            row: target.topLeft.row + r,
          });
          const srcCell = sheet.cells[srcA1];
          if (srcCell) sheet.cells[dstA1] = { ...srcCell };
        }
      }
    },

    emitSaved() {
      for (const l of savedListeners) l();
    },

    emitSheetChange(event) {
      for (const l of changedListeners) l(event);
    },

    emitSelectionChange(sel) {
      // Keep getSelection consistent with what subscribers were told.
      wb.selection = sel ?? undefined;
      for (const l of selectionListeners) l(sel);
    },
  };
}

function coerceLiteral(raw: string): CellValue {
  if (raw === "") return null;
  if (raw === "TRUE") return true;
  if (raw === "FALSE") return false;
  const n = Number(raw);
  if (Number.isFinite(n) && raw.trim() !== "") return n;
  return raw;
}

/**
 * Bounding box of the populated cells, matching Office's `getUsedRange`: the
 * counts are the box's own extent, and `address` says where it sits. A sheet
 * whose only cells are B2:I8 reports 7×8 at "B2:I8", not 8×9.
 */
function computeUsedRange(cells: InMemorySheet["cells"]): {
  rows: number;
  cols: number;
  address: string | null;
} {
  if (!cells) return { rows: 0, cols: 0, address: null };
  let minRow = Infinity;
  let minCol = Infinity;
  let maxRow = -1;
  let maxCol = -1;
  for (const key of Object.keys(cells)) {
    const m = /^([A-Z]+)(\d+)$/.exec(key.toUpperCase());
    if (!m) continue;
    const col = lettersToIndex(m[1]);
    const row = parseInt(m[2], 10) - 1;
    if (col > maxCol) maxCol = col;
    if (row > maxRow) maxRow = row;
    if (col < minCol) minCol = col;
    if (row < minRow) minRow = row;
  }
  if (maxRow < 0) return { rows: 0, cols: 0, address: null };
  return {
    rows: maxRow - minRow + 1,
    cols: maxCol - minCol + 1,
    address: formatRange({
      topLeft: { col: minCol, row: minRow },
      bottomRight: { col: maxCol, row: maxRow },
    }),
  };
}

function lettersToIndex(letters: string): number {
  // Mirror of columnLetterToIndex without the regex round-trip
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// Silence "unused" warning for columnIndexToLetter import: keep it available
// for downstream test helpers that may want it.
export { columnIndexToLetter };
