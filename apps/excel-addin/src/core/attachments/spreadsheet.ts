import * as XLSX from "xlsx";

/**
 * Spreadsheet attachment handling. Two paths, both starting from an
 * uploaded file:
 *
 *   1. INSERT — the file's worksheets are added to the live workbook via
 *      Office.js `insertWorksheetsFromBase64`. Full fidelity (values,
 *      formulas, formatting). The agent then reads them with its normal
 *      workbook tools. This module just produces the base64 the data
 *      source needs.
 *
 *   2. TEXT — the file is parsed (SheetJS) into CSV-per-sheet text that
 *      gets injected into the conversation as a text content part. Works
 *      on every model (no vision needed), works on every supported
 *      format including binary .xlsb, but flattens to values (drops
 *      formulas + formatting). The universal fallback.
 *
 * SheetJS reads xlsx / xlsm / xls / xlsb / csv. The insert path relies on
 * Office.js, which is reliable for the XML formats (xlsx/xlsm) and
 * attempt-with-fallback for the binary ones (xls/xlsb).
 */

/** Extensions we treat as spreadsheets in the Composer's file picker. */
export const SPREADSHEET_EXTENSIONS = [".xlsx", ".xlsm", ".xls", ".xlsb", ".csv"];

/** MIME types browsers commonly tag spreadsheets with. */
const SPREADSHEET_MIMES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // xlsx
  "application/vnd.ms-excel.sheet.macroEnabled.12", // xlsm
  "application/vnd.ms-excel", // xls
  "application/vnd.ms-excel.sheet.binary.macroEnabled.12", // xlsb
  "text/csv",
  "application/csv",
]);

/**
 * Cap on rows-per-sheet emitted in the text path. A 100k-row rent roll
 * would blow the model's context; we truncate with a clear marker so the
 * agent knows there's more and can ask the user to insert the file
 * instead (full data, no truncation).
 */
const MAX_ROWS_PER_SHEET = 500;

export interface SpreadsheetSheet {
  name: string;
  csv: string;
  /** Total rows in the source sheet (pre-truncation), for the UI + agent. */
  totalRows: number;
  /** True when csv was truncated at MAX_ROWS_PER_SHEET. */
  truncated: boolean;
}

export interface ParsedSpreadsheet {
  filename: string;
  sheets: SpreadsheetSheet[];
}

/** True when the file looks like a spreadsheet by MIME or extension. */
export function isSpreadsheetFile(file: File): boolean {
  if (SPREADSHEET_MIMES.has(file.type)) return true;
  const lower = file.name.toLowerCase();
  return SPREADSHEET_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** CSV files are text-only — there are no worksheets to insert. */
export function isCsvFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(".csv") || file.type.includes("csv");
}

/**
 * Parse a spreadsheet file into CSV-per-sheet text for the text path.
 * Truncates each sheet at MAX_ROWS_PER_SHEET. Throws on a file SheetJS
 * can't read.
 */
export async function parseSpreadsheetToText(file: File): Promise<ParsedSpreadsheet> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array" });

  const sheets: SpreadsheetSheet[] = wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    // Full CSV first to count rows, then truncate the text if needed.
    const fullCsv = XLSX.utils.sheet_to_csv(ws, { blankrows: false });
    const lines = fullCsv.split("\n");
    const totalRows = lines.length;
    const truncated = totalRows > MAX_ROWS_PER_SHEET;
    const csv = truncated
      ? lines.slice(0, MAX_ROWS_PER_SHEET).join("\n") +
        `\n… [${totalRows - MAX_ROWS_PER_SHEET} more rows truncated — insert the file as worksheets to give the agent the full data]`
      : fullCsv;
    return { name, csv, totalRows, truncated };
  });

  return { filename: file.name, sheets };
}

/**
 * Read a file as a base64 string (no data-URL prefix) for the insert
 * path's `insertWorksheetsFromBase64` call.
 */
export async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  // Chunked to avoid "Maximum call stack" on large files when spreading
  // into String.fromCharCode.
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Count worksheets without a full parse — used for the decision card label. */
export async function countWorksheets(file: File): Promise<number> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array", bookSheets: true });
  return wb.SheetNames.length;
}

/**
 * Build the text-content block for a parsed spreadsheet. Lead with a
 * header naming the file + sheets, then each sheet's CSV under its own
 * marker so the agent can tell them apart.
 */
export function renderSpreadsheetText(parsed: ParsedSpreadsheet): string {
  const header = `[Attached spreadsheet "${parsed.filename}" — ${parsed.sheets.length} sheet${parsed.sheets.length === 1 ? "" : "s"}, read as text below]`;
  const blocks = parsed.sheets.map(
    (s) => `\n=== Sheet: ${s.name} (${s.totalRows} rows) ===\n${s.csv}`
  );
  return [header, ...blocks].join("\n");
}

/** Byte cap for the insert path — base64 through the Office.js bridge gets
 * slow/fragile past a few MB, so we guard. ~25MB raw file. */
export const INSERT_SIZE_LIMIT_BYTES = 25 * 1024 * 1024;
