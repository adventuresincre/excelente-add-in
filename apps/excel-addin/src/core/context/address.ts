/**
 * A1-style address parsing.
 *
 * Excel column letters: A=0, B=1, ..., Z=25, AA=26, AB=27, ..., AAA=702.
 */

export interface CellRef {
  /** Zero-indexed column. */
  col: number;
  /** Zero-indexed row. */
  row: number;
}

export interface RangeRef {
  topLeft: CellRef;
  bottomRight: CellRef;
}

export function columnLetterToIndex(letters: string): number {
  if (!/^[A-Z]+$/.test(letters)) {
    throw new Error(`Invalid column letters: ${letters}`);
  }
  let n = 0;
  for (const ch of letters) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}

export function columnIndexToLetter(index: number): string {
  if (index < 0 || !Number.isInteger(index)) {
    throw new Error(`Invalid column index: ${index}`);
  }
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

const A1_RE = /^\$?([A-Z]+)\$?(\d+)$/;

/**
 * Strip a leading sheet qualifier ("Sheet1!", "'My Sheet'!") from an address,
 * returning the sheet-local part. Office.js `Worksheet.getRange` and our A1
 * parser both expect a sheet-local address; a sheet-qualified one throws
 * `InvalidArgument` ("The argument is invalid or missing or has an incorrect
 * format"). Models routinely pass a qualified address (e.g. "DCF Template!B2:P36")
 * since that's how they refer to ranges — tolerate it here. A sheet-local A1
 * address never contains "!", so taking everything after the last "!" is safe
 * and handles unquoted sheet names with spaces too.
 */
export function stripSheetQualifier(address: string): string {
  const bang = address.lastIndexOf("!");
  return bang >= 0 ? address.slice(bang + 1) : address;
}

export function parseA1(address: string): CellRef {
  const m = A1_RE.exec(stripSheetQualifier(address.trim()).toUpperCase());
  if (!m) throw new Error(`Invalid A1 address: ${address}`);
  return {
    col: columnLetterToIndex(m[1]),
    row: parseInt(m[2], 10) - 1,
  };
}

export function formatA1(ref: CellRef): string {
  return `${columnIndexToLetter(ref.col)}${ref.row + 1}`;
}

export function parseRange(address: string): RangeRef {
  const trimmed = stripSheetQualifier(address.trim());
  const parts = trimmed.split(":");
  if (parts.length === 1) {
    const cell = parseA1(parts[0]);
    return { topLeft: cell, bottomRight: cell };
  }
  if (parts.length !== 2) {
    throw new Error(`Invalid range address: ${address}`);
  }
  const a = parseA1(parts[0]);
  const b = parseA1(parts[1]);
  return {
    topLeft: { col: Math.min(a.col, b.col), row: Math.min(a.row, b.row) },
    bottomRight: { col: Math.max(a.col, b.col), row: Math.max(a.row, b.row) },
  };
}

export function formatRange(ref: RangeRef): string {
  if (ref.topLeft.col === ref.bottomRight.col && ref.topLeft.row === ref.bottomRight.row) {
    return formatA1(ref.topLeft);
  }
  return `${formatA1(ref.topLeft)}:${formatA1(ref.bottomRight)}`;
}

export function rangeRowCount(ref: RangeRef): number {
  return ref.bottomRight.row - ref.topLeft.row + 1;
}

export function rangeColumnCount(ref: RangeRef): number {
  return ref.bottomRight.col - ref.topLeft.col + 1;
}
