import { formatRange, parseRange, rangeColumnCount, rangeRowCount, type RangeRef } from "./address";
import type { ExcelDataSource } from "./datasource";
import type { CellValue } from "./in-memory";
import type { RangeData } from "./types";

export interface ReadRangeOptions {
  /** Max cells per Office.js sync. Default 50,000. */
  chunkSize?: number;
  /** Max concurrent chunk reads. Default 4. */
  concurrency?: number;
  /** Hard ceiling on total cells. Default {@link MAX_READ_CELLS}. */
  maxCells?: number;
}

/**
 * Hard ceiling on a single range read.
 *
 * `chunkSize` bounds each Office.js sync but says nothing about the total,
 * and the address comes from the model — a Read tool that runs with no
 * approval prompt. `A1:XFD1048576` parses fine and works out to ~17 billion
 * cells, so the stripe planning alone (millions of objects, built before any
 * `context.sync()`) hangs or OOMs the task pane.
 *
 * One million cells is far past any real workbook read the agent needs and
 * still well under the point where planning gets expensive. Hitting it means
 * the address was a mistake, so the error says how to narrow it.
 */
export const MAX_READ_CELLS = 1_000_000;

/**
 * Read an arbitrary range, chunking large ranges into Office.js-friendly
 * batches and running them in parallel.
 *
 * Small ranges (< chunkSize) pass through as a single `getRange` call.
 * Large ranges are sliced into horizontal row stripes.
 */
export async function readRange(
  ds: ExcelDataSource,
  sheetName: string,
  address: string,
  opts: ReadRangeOptions = {}
): Promise<RangeData> {
  const chunkSize = opts.chunkSize ?? 50_000;
  const concurrency = opts.concurrency ?? 4;
  const maxCells = opts.maxCells ?? MAX_READ_CELLS;
  const range = parseRange(address);
  const totalRows = rangeRowCount(range);
  const totalCols = rangeColumnCount(range);
  const totalCells = totalRows * totalCols;

  // Reject before planning stripes — the planning itself is what falls over
  // on a whole-sheet address.
  if (totalCells > maxCells) {
    throw new Error(
      `Range ${address} covers ${totalCells.toLocaleString()} cells, over the ` +
        `${maxCells.toLocaleString()}-cell read limit. Narrow the address to the ` +
        `region you actually need — use inspect_workbook at sheet scope first to ` +
        `find the used range, then read within it.`
    );
  }

  if (totalCells <= chunkSize) {
    return ds.getRange(sheetName, formatRange(range));
  }

  const stripes = sliceByRows(range, chunkSize, totalCols);
  const chunks = await runConcurrently(
    stripes.map((stripe) => () => ds.getRange(sheetName, formatRange(stripe))),
    concurrency
  );

  return mergeStripes(chunks, sheetName, range, totalRows, totalCols);
}

/**
 * Slice a range into horizontal stripes whose cell count fits inside the
 * chunk budget. If a single row exceeds the budget the stripe is still one
 * row tall — Office.js will just have to handle it.
 */
function sliceByRows(range: RangeRef, chunkSize: number, totalCols: number): RangeRef[] {
  const rowsPerChunk = Math.max(1, Math.floor(chunkSize / totalCols));
  const stripes: RangeRef[] = [];
  for (let r = range.topLeft.row; r <= range.bottomRight.row; r += rowsPerChunk) {
    const endRow = Math.min(range.bottomRight.row, r + rowsPerChunk - 1);
    stripes.push({
      topLeft: { col: range.topLeft.col, row: r },
      bottomRight: { col: range.bottomRight.col, row: endRow },
    });
  }
  return stripes;
}

async function runConcurrently<T>(tasks: (() => Promise<T>)[], concurrency: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));
  return results;
}

function mergeStripes(
  chunks: RangeData[],
  sheetName: string,
  range: RangeRef,
  totalRows: number,
  totalCols: number
): RangeData {
  const values: CellValue[][] = new Array(totalRows);
  const formulas: string[][] = new Array(totalRows);
  let r = 0;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.rowCount; i++) {
      values[r] = chunk.values[i] as CellValue[];
      formulas[r] = chunk.formulas[i];
      r++;
    }
  }
  return {
    address: `${sheetName}!${formatRange(range)}`,
    values,
    formulas,
    rowCount: totalRows,
    columnCount: totalCols,
  };
}
