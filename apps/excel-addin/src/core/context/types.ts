/* --------------------------------- Workbook -------------------------------- */

export interface SheetSummary {
  /** Sheet name as it appears on the tab. */
  name: string;
  /** Zero-indexed tab position. */
  position: number;
  visible: boolean;
  /** Bounding rows of the used range, 0 if the sheet is empty. */
  rowCount: number;
  /** Bounding columns of the used range, 0 if the sheet is empty. */
  columnCount: number;
  /**
   * Sheet-local address of the used range, e.g. "B2:I8"; null when empty.
   * The counts above are its extent, NOT an extent from A1 — a table that
   * starts at B2 has rowCount 7 and columnCount 8 and nothing in row 1 or
   * column A. Every consumer that walks cells must anchor on this address
   * (2026-09-10: the sheet outline and trace_dependencies both assumed A1 and
   * silently skipped the last column and row of any offset table).
   */
  usedRange: string | null;
  hasCharts: boolean;
  hasPivots: boolean;
}

export interface NamedRangeInfo {
  name: string;
  /** "workbook" for workbook-scope names, otherwise the sheet name. */
  scope: "workbook" | string;
  /** RefersTo formula, e.g. "=Sheet1!$A$1:$B$10". */
  refersTo: string;
  comment?: string;
}

export interface WorkbookOutline {
  sheets: SheetSummary[];
  namedRanges: NamedRangeInfo[];
  /** Active sheet at time of capture, if known. */
  activeSheet?: string;
}

/* ---------------------------------- Range ---------------------------------- */

export interface RangeData {
  /** Sheet-qualified address, e.g. "Sheet1!A1:C5". */
  address: string;
  /** Row-major. Cells without a value are represented as null. */
  values: (string | number | boolean | null)[][];
  /** Row-major. Empty string when the cell has no formula. */
  formulas: string[][];
  rowCount: number;
  columnCount: number;
  /**
   * Width of each column in the range, left to right, in POINTS — the unit
   * Office.js speaks, NOT the character units Excel's Column Width dialog
   * shows. Measured in a live host 2026-09-10: an untouched column reports
   * 48 (= 8.43 character units = 64px). `format_range`'s `columnWidth` takes
   * points too, so read and write agree; only the dialog differs.
   *
   * Column width was previously unreadable by any tool: it is not a cell
   * value, and `Range.getImage` renders cells without the row/column
   * headers, so it is not in a screenshot either. An agent could set a width
   * and then had no way to check it held, which is the exact opposite of the
   * "verify by reading, never by assuming" rule the house conventions are
   * built on — and the conventions specify widths (column A is a width-2
   * rail).
   *
   * Undefined when the host could not report them, or when the range is
   * wider than `MAX_DIMENSION_PROBE` columns — absent, never guessed.
   */
  columnWidths?: number[];
  /** Height of each row, top to bottom, in points. Same caveats as `columnWidths`. */
  rowHeights?: number[];
}

/**
 * Ceiling on per-column / per-row dimension probing.
 *
 * Office.js reports a uniform `range.format.columnWidth` only when every
 * column already matches, and null otherwise — so the per-column values have
 * to be loaded one proxy at a time. They all settle in a single `sync()`, so
 * the cost is payload rather than round trips, but an unbounded read of a
 * 10,000-row block would still marshal 10,000 objects for a number nobody
 * asked about. Past this, the arrays are omitted.
 */
export const MAX_DIMENSION_PROBE = 200;
