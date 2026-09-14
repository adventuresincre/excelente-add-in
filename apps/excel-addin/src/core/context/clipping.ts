import { columnIndexToLetter, formatA1, formatRange, parseRange } from "./address";
import type { RangeRef } from "./address";
import type { ExcelDataSource } from "./datasource";

/** Largest strip we will read to see whether data continues past a range. */
const MAX_STRIP_CELLS = 2_000;

/**
 * One sentence, or null, saying whether a range read stopped short of data.
 *
 * A range read returns exactly what was asked for, and a model that asked
 * for the wrong rectangle has no way to know. 2026-09-10: the agent read
 * A2:H8 of a B2:I8 table, saw totals formulas pointing at column I, and
 * concluded column I was blank and the formulas were bugs. The sheet's used
 * range is one cheap lookup; when the requested range ends inside it, the
 * cell just past each short edge is read and, if anything is there, named.
 * Nothing is said when the read already covers the block.
 */
export async function describeClipping(
  ds: ExcelDataSource,
  sheetName: string,
  requestedAddress: string
): Promise<string | null> {
  const sheets = await ds.listSheets();
  const used = sheets.find((s) => s.name === sheetName)?.usedRange;
  if (!used) return null;
  const req = parseRange(requestedAddress);
  const box = parseRange(used);

  const rowSpan = {
    top: Math.max(req.topLeft.row, box.topLeft.row),
    bottom: Math.min(req.bottomRight.row, box.bottomRight.row),
  };
  const colSpan = {
    left: Math.max(req.topLeft.col, box.topLeft.col),
    right: Math.min(req.bottomRight.col, box.bottomRight.col),
  };

  const findings: string[] = [];
  const probe = async (label: string, rect: RangeRef): Promise<void> => {
    const hit = await firstNonEmpty(ds, sheetName, rect);
    if (hit) findings.push(`${label}: ${hit}`);
  };

  if (req.bottomRight.col < box.bottomRight.col && rowSpan.top <= rowSpan.bottom) {
    const col = req.bottomRight.col + 1;
    await probe(`to the right in column ${columnIndexToLetter(col)}`, {
      topLeft: { col, row: rowSpan.top },
      bottomRight: { col, row: rowSpan.bottom },
    });
  }
  if (req.bottomRight.row < box.bottomRight.row && colSpan.left <= colSpan.right) {
    const row = req.bottomRight.row + 1;
    await probe(`below in row ${row + 1}`, {
      topLeft: { col: colSpan.left, row },
      bottomRight: { col: colSpan.right, row },
    });
  }
  if (req.topLeft.col > box.topLeft.col && rowSpan.top <= rowSpan.bottom) {
    const col = req.topLeft.col - 1;
    await probe(`to the left in column ${columnIndexToLetter(col)}`, {
      topLeft: { col, row: rowSpan.top },
      bottomRight: { col, row: rowSpan.bottom },
    });
  }
  if (req.topLeft.row > box.topLeft.row && colSpan.left <= colSpan.right) {
    const row = req.topLeft.row - 1;
    await probe(`above in row ${row + 1}`, {
      topLeft: { col: colSpan.left, row },
      bottomRight: { col: colSpan.right, row },
    });
  }

  if (findings.length === 0) return null;
  return (
    `Your range stops short of this sheet's used range (${used}). Data continues ` +
    `${findings.join("; ")}. Re-read the full block before judging formulas that reference it.`
  );
}

/** `I3 = "Monthly Revenue"` for the first populated cell in `rect`, or null. */
async function firstNonEmpty(
  ds: ExcelDataSource,
  sheetName: string,
  rect: RangeRef
): Promise<string | null> {
  const cells =
    (rect.bottomRight.row - rect.topLeft.row + 1) * (rect.bottomRight.col - rect.topLeft.col + 1);
  if (cells <= 0 || cells > MAX_STRIP_CELLS) return null;
  const data = await ds.getRange(sheetName, formatRange(rect));
  for (let r = 0; r < data.values.length; r++) {
    for (let c = 0; c < data.values[r].length; c++) {
      const value = data.values[r][c];
      const formula = data.formulas[r]?.[c] ?? "";
      if (formula || (value !== null && value !== undefined && value !== "")) {
        const address = formatA1({ col: rect.topLeft.col + c, row: rect.topLeft.row + r });
        return `${address} = ${JSON.stringify(value)}${formula ? ` [${formula}]` : ""}`;
      }
    }
  }
  return null;
}
