import type { CellValue, ExcelDataSource } from "../context";

/**
 * Per-session snapshot stack. Office.js's native undo doesn't see writes from
 * add-ins, so we maintain our own stack of pre-write snapshots that the
 * `undo` tool restores.
 */
export interface UndoEntry {
  /** Human-readable label rendered in the UI. */
  label: string;
  sheetName: string;
  address: string;
  /** Pre-write formulas — empty string for cells that had a literal value. */
  priorFormulas: string[][];
  /** Pre-write values — used to restore cells that didn't have a formula. */
  priorValues: CellValue[][];
}

/**
 * Compose a `setRange`-ready string array from a snapshot. Cells with a
 * formula restore the formula directly; cells with only a value restore
 * that value as its string form (Excel will re-parse numbers/booleans).
 */
export function restorationArray(entry: UndoEntry): string[][] {
  return entry.priorFormulas.map((row, r) =>
    row.map((formula, c) =>
      formula !== "" ? formula : valueToString(entry.priorValues[r]?.[c] ?? null)
    )
  );
}

function valueToString(v: CellValue): string {
  if (v === null) return "";
  if (v === true) return "TRUE";
  if (v === false) return "FALSE";
  return String(v);
}

export interface UndoStack {
  push(entry: UndoEntry): void;
  pop(): UndoEntry | null;
  peek(): UndoEntry | null;
  size(): number;
  clear(): void;
}

export interface UndoStackOptions {
  /** Maximum entries retained. Older entries drop. Default 50. */
  capacity?: number;
}

/**
 * Restore a single undo entry by writing its prior contents back to the
 * workbook. Public so the UI can drive undo directly (header button,
 * ChangeCard revert, `/undo` slash command) without routing through a
 * model-mediated tool call.
 */
export async function applyRevert(ds: ExcelDataSource, entry: UndoEntry): Promise<void> {
  await ds.setRange(entry.sheetName, entry.address, restorationArray(entry));
}

export function createUndoStack(opts: UndoStackOptions = {}): UndoStack {
  const capacity = opts.capacity ?? 50;
  const entries: UndoEntry[] = [];

  return {
    push(entry) {
      entries.push(entry);
      if (entries.length > capacity) entries.shift();
    },
    pop() {
      return entries.pop() ?? null;
    },
    peek() {
      return entries.length > 0 ? entries[entries.length - 1] : null;
    },
    size() {
      return entries.length;
    },
    clear() {
      entries.length = 0;
    },
  };
}
