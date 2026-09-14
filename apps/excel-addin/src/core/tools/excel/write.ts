import {
  formatA1,
  formatRange,
  parseRange,
  rangeColumnCount,
  rangeRowCount,
  type CellRef,
  type CellValue,
  type ExcelDataSource,
} from "../../context";
import { restorationArray } from "../undo";
import type { ToolDef } from "../types";
import {
  findFormulaProblems,
  findPlaceholderLiterals,
  PLACEHOLDER_EXPLANATION,
  type CellProblem,
} from "./formula-check";

/* -------------------------------- write_range ------------------------------ */

interface WriteRangeInput {
  sheetName: string;
  address: string;
  /**
   * Row-major 2D array. Strings starting with `=` are formulas; all others
   * are literal values (Excel parses numerics/booleans automatically).
   * Wire contract — at runtime, `values` is accepted as an alias and
   * JSON-encoded strings / unambiguous 1D arrays are coerced (see
   * normalizeGridInput).
   */
  formulas: string[][];
  /**
   * Optional: a larger range to fill with the same pattern via autoFill.
   * When set, `address` is written first as the seed, then the workbook
   * replicates the formula pattern across `copy_to_range`. Use for
   * "fill this formula across 500 rows" without sending 500 rows of data.
   * Address must be a strict superset of `address` (same starting cell).
   */
  copy_to_range?: string;
  /**
   * When true, refuses to overwrite any non-empty cell in `address`
   * (returns an error result the model can adapt to). Use for first-time
   * writes into a section you believe is empty; omit for revisions.
   * Defaults to false — the model has been writing freely until now.
   */
  confirm_overwrite?: boolean;
}

interface WriteRangeOutput {
  written: string;
  rowCount: number;
  columnCount: number;
  undoLabel: string;
  /** When copy_to_range was used, the resolved expanded range. */
  filled?: string;
  /**
   * One line per written row (capped), each starting with its absolute row
   * number: `row 3: Unit Type | Units | % of Units | Avg SF | +4 more`. The
   * anchor semantics mean the grid's extent is decided by the model's own
   * row count, and a model that writes a title row plus a header row then
   * assumes the header is on the anchor row builds every formula one row
   * off (observed 2026-09-10 — the entire table had to be rewritten). The
   * `written` address says where the block ends; this says what is on
   * which row, so the mental model and the sheet cannot drift apart.
   */
  layout?: string[];
  /**
   * Present when the input grid needed coercion (wrong key, JSON-encoded
   * string, 1D array). Tells the model what was auto-fixed so it converges
   * on the canonical shape instead of repeating the mistake.
   */
  note?: string;
}

export const writeRangeTool: ToolDef<WriteRangeInput, WriteRangeOutput> = {
  name: "write_range",
  description:
    "Write values/formulas to a range.\n\n" +
    "CRITICAL — `formulas` is ROW-MAJOR: outer array = rows, inner = columns. For " +
    '"A1:C2" (2 rows × 3 cols): "formulas": [["Header A", "Header B", "Header C"], ' +
    '["1", "=B2*2", "3"]] — DO NOT transpose.\n\n' +
    "`address` is an ANCHOR: it fixes the top-left cell, and your grid fixes the extent. " +
    'Pass just the corner ("A88") and skip the row math — the write covers exactly as many ' +
    "rows and columns as you send. A full range is accepted too and is resized to the grid " +
    "if they disagree. Every row must still have the SAME number of cells, and a transposed " +
    "grid is refused.\n\n" +
    'Strings starting with "=" are formulas; everything else is a literal (numerics/' +
    'booleans parsed); "" clears the cell. Send a whole table in ONE call — hundreds of rows ' +
    "is fine and far better than many small chunks.\n\n" +
    "Pattern fills: write the seed, pass `copy_to_range` — one call fills thousands of " +
    "cells. `confirm_overwrite: true` refuses to clobber non-empty cells. Pre-write " +
    "contents are snapshotted for `undo`.",
  inputSchema: {
    type: "object",
    properties: {
      sheetName: { type: "string" },
      address: {
        type: "string",
        description:
          'Anchor cell or A1-style range. "A88" writes a grid of any size with A88 as its top-left corner; "A88:N96" also works and is resized to fit the grid.',
      },
      formulas: {
        type: "array",
        description:
          'Row-major 2D array. For "A1:K18" (18 rows × 11 cols): 18 outer entries, each with 11 inner strings.',
        items: {
          type: "array",
          items: { type: "string" },
        },
      },
      copy_to_range: {
        type: "string",
        description:
          'Optional A1-style range to fill with the same pattern via autoFill (e.g., seed at "C2", fill to "C2:C500"). Must share start cell with `address` and strictly contain it.',
      },
      confirm_overwrite: {
        type: "boolean",
        description:
          "When true, refuses to overwrite non-empty cells in the target range. Defaults to false.",
      },
    },
    required: ["sheetName", "address", "formulas"],
    additionalProperties: false,
  },
  requiredPermission: "Write",
  async execute(input, { ds, undoStack }) {
    const { sheetName, address, copy_to_range, confirm_overwrite } = input;
    const range = parseRange(address);
    const declaredRows = rangeRowCount(range);
    const declaredCols = rangeColumnCount(range);

    const { grid: formulas, notes } = normalizeGridInput(
      input as unknown as Record<string, unknown>,
      declaredRows,
      declaredCols
    );

    const gotRows = Array.isArray(formulas) ? formulas.length : 0;
    const gotCols = gotRows > 0 && Array.isArray(formulas[0]) ? formulas[0].length : 0;

    // A ragged grid is always a real authoring mistake — one row genuinely
    // has the wrong number of cells relative to its siblings. Never guess;
    // but do say which rows are which length and which width was meant.
    if (formulas.some((row) => row.length !== gotCols)) {
      throw new Error(
        buildRaggedGridError(address, declaredCols, declaredRows > 1 || declaredCols > 1, formulas)
      );
    }

    // Transposition stays an error. Auto-fitting a swapped grid would write
    // a table sideways and report success — far worse than a clear refusal,
    // and the diagnosis below is what lets the model recover in one turn.
    const isTransposed =
      gotRows > 0 &&
      gotRows === declaredCols &&
      gotCols === declaredRows &&
      declaredRows !== declaredCols;
    if (isTransposed) {
      throw new Error(buildTransposedError(address, declaredRows, declaredCols, gotRows, gotCols));
    }
    if (gotRows === 0 || gotCols === 0) {
      throw new Error(buildEmptyGridError(address));
    }

    // Formulas Excel is certain to refuse are named here, cell by cell,
    // before anything is touched. Excel's own refusal covers the whole batch
    // with one sentence and no address.
    const problems = findFormulaProblems(formulas, range.topLeft);
    if (problems.length > 0) {
      throw new Error(buildFormulaProblemsError(sheetName, problems));
    }
    const placeholderLiterals = findPlaceholderLiterals(formulas, range.topLeft);
    if (placeholderLiterals.length > 0) {
      notes.push(
        `Literal text in ${placeholderLiterals.join(", ")} contains a redaction placeholder; ` +
          PLACEHOLDER_EXPLANATION
      );
    }

    // ANCHOR SEMANTICS. `address` fixes the top-left corner; the grid you
    // send fixes the extent. Requiring the two to agree made the model
    // hand-count rows for every chunk of a long table, and a single
    // off-by-one refused the whole call — 13 such refusals in one observed
    // session (2026-09-04), each one a wasted round-trip on a grid that was
    // already correct. The grid is the intent; trust it and report any
    // adjustment. Genuinely dangerous mismatches are caught above.
    const effectiveAddress = resizeAddress(address, gotRows, gotCols);
    if (gotRows !== declaredRows || gotCols !== declaredCols) {
      notes.push(
        `Address ${address} declared ${declaredRows}×${declaredCols} but the grid is ` +
          `${gotRows}×${gotCols}; wrote ${effectiveAddress} anchored at the same top-left cell. ` +
          `You can pass just the anchor cell (e.g. "${anchorCell(address)}") and skip the ` +
          `row math entirely.`
      );
    }

    // The actual write target — `effectiveAddress` for normal writes, or the
    // expanded range when `copy_to_range` is provided.
    const writeAddress = copy_to_range ?? effectiveAddress;
    if (copy_to_range) {
      validateCopyToRange(effectiveAddress, copy_to_range);
    }

    // Snapshot the FULL write target (including the copy-to area) for
    // undo. The seed itself plus everything we'll fill needs to be
    // recoverable.
    const prior = await ds.getRange(sheetName, writeAddress);

    if (confirm_overwrite) {
      const occupied = countNonEmptyCells(
        prior.values as CellValue[][],
        prior.formulas as string[][]
      );
      if (occupied > 0) {
        throw new Error(
          `write_range refused: ${occupied} non-empty cell${occupied === 1 ? "" : "s"} ` +
            `in ${sheetName}!${writeAddress} would be overwritten and confirm_overwrite=true. ` +
            `Either retry with confirm_overwrite=false (or omit it) to proceed, or pick a different range.`
        );
      }
    }

    undoStack.push({
      label: `Write ${sheetName}!${writeAddress}`,
      sheetName,
      address: writeAddress,
      priorFormulas: prior.formulas,
      priorValues: prior.values as CellValue[][],
    });

    try {
      await ds.setRange(sheetName, effectiveAddress, formulas);
    } catch (e) {
      throw new Error(
        await describeRejectedWrite(e, ds, sheetName, effectiveAddress, range.topLeft, formulas)
      );
    }
    if (copy_to_range) {
      await ds.fillRange(sheetName, effectiveAddress, copy_to_range);
    }

    const layout = describeLayout(formulas, range.topLeft);
    return {
      written: `${sheetName}!${effectiveAddress.toUpperCase()}`,
      rowCount: gotRows,
      columnCount: gotCols,
      undoLabel: `Write ${sheetName}!${writeAddress}`,
      ...(copy_to_range && { filled: `${sheetName}!${copy_to_range.toUpperCase()}` }),
      ...(layout && { layout }),
      ...(notes.length > 0 && { note: notes.join(" ") }),
    };
  },
};

/* --------------------------- what landed where ----------------------------- */

const LAYOUT_MAX_ROWS = 10;
const LAYOUT_MAX_CELLS = 4;
const LAYOUT_CELL_CHARS = 18;

/**
 * Absolute row numbers paired with the first few cells of each row. Omitted
 * for a single row, where `written` already says everything; capped so a
 * 500-row table costs ten lines, not five hundred.
 */
function describeLayout(grid: string[][], topLeft: CellRef): string[] | undefined {
  if (grid.length < 2) return undefined;
  const line = (r: number): string => {
    const cells = grid[r];
    const shown = cells.slice(0, LAYOUT_MAX_CELLS).map((cell) => {
      const s = String(cell ?? "");
      if (s === "") return '""';
      return s.length > LAYOUT_CELL_CHARS ? `${s.slice(0, LAYOUT_CELL_CHARS - 1)}…` : s;
    });
    const more =
      cells.length > LAYOUT_MAX_CELLS ? ` | +${cells.length - LAYOUT_MAX_CELLS} more` : "";
    return `row ${topLeft.row + r + 1}: ${shown.join(" | ")}${more}`;
  };
  if (grid.length <= LAYOUT_MAX_ROWS) return grid.map((_, r) => line(r));
  const headCount = LAYOUT_MAX_ROWS - 3;
  const head = Array.from({ length: headCount }, (_, r) => line(r));
  const tail = [grid.length - 2, grid.length - 1].map(line);
  return [...head, `… ${grid.length - headCount - 2} more rows …`, ...tail];
}

/* ------------------------ locating what Excel rejected --------------------- */

/**
 * Probe budget for isolating rejected cells by bisection. A grid of 4,000
 * cells with two bad formulas resolves in about 25 probes; past this we
 * stop and report the range, rather than turn one failure into hundreds of
 * Office round-trips.
 */
const MAX_LOCATE_PROBES = 48;

/**
 * Turn Excel's batch-level refusal into a list of cells. Office.js applies a
 * `formulas` assignment atomically, so after a failure nothing from the
 * batch is on the sheet; each half that passes is written as we go, and
 * only the halves that fail are split further. The result is the good
 * cells on the sheet and the bad ones named — the model fixes those alone
 * instead of guessing at the whole range.
 */
async function locateRejectedCells(
  ds: ExcelDataSource,
  sheetName: string,
  topLeft: CellRef,
  grid: string[][],
  budget: { left: number }
): Promise<CellProblem[] | null> {
  const rows = grid.length;
  const cols = grid[0].length;
  if (rows === 1 && cols === 1) {
    return [{ address: formatA1(topLeft), content: grid[0][0], problem: "rejected by Excel" }];
  }
  const halves: { topLeft: CellRef; grid: string[][] }[] = [];
  if (rows >= cols) {
    const mid = Math.floor(rows / 2);
    halves.push({ topLeft, grid: grid.slice(0, mid) });
    halves.push({ topLeft: { col: topLeft.col, row: topLeft.row + mid }, grid: grid.slice(mid) });
  } else {
    const mid = Math.floor(cols / 2);
    halves.push({ topLeft, grid: grid.map((row) => row.slice(0, mid)) });
    halves.push({
      topLeft: { col: topLeft.col + mid, row: topLeft.row },
      grid: grid.map((row) => row.slice(mid)),
    });
  }
  const found: CellProblem[] = [];
  for (const half of halves) {
    if (budget.left <= 0) return null;
    budget.left--;
    const address = formatRange({
      topLeft: half.topLeft,
      bottomRight: {
        col: half.topLeft.col + half.grid[0].length - 1,
        row: half.topLeft.row + half.grid.length - 1,
      },
    });
    try {
      await ds.setRange(sheetName, address, half.grid);
    } catch {
      const inner = await locateRejectedCells(ds, sheetName, half.topLeft, half.grid, budget);
      if (inner === null) return null;
      found.push(...inner);
    }
  }
  return found;
}

/**
 * The message for a write Excel refused. Excel's InvalidArgument names no
 * cell; when the address is already known-good (it was parsed and
 * snapshotted moments earlier) the refusal is about content, so isolate the
 * cells and report them with what they contained. Anything else — sheet
 * gone, host error — is passed through with the range attached.
 */
async function describeRejectedWrite(
  error: unknown,
  ds: ExcelDataSource,
  sheetName: string,
  address: string,
  topLeft: CellRef,
  grid: string[][]
): Promise<string> {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: unknown } | null)?.code;
  const where = `${sheetName}!${address.toUpperCase()}`;
  const aboutContent = code === "InvalidArgument" || /invalid/i.test(message);
  if (!aboutContent) return `write_range failed on ${where}: ${message}`;

  const rejected = await locateRejectedCells(ds, sheetName, topLeft, grid, {
    left: MAX_LOCATE_PROBES,
  });
  if (rejected === null || rejected.length === 0) {
    return (
      `write_range failed on ${where}: Excel rejected the batch ("${message}") and the ` +
      `offending cell could not be isolated. Check every formula for balanced parentheses ` +
      `and valid references, then resend.`
    );
  }
  const total = grid.length * grid[0].length;
  const others = total - rejected.length;
  const list = rejected.map((p) => `${p.address} = ${JSON.stringify(p.content)}`).join("; ");
  return (
    `write_range partially failed on ${where}: Excel rejected ${rejected.length} ` +
    `cell${rejected.length === 1 ? "" : "s"} — ${list}. Excel could not parse ` +
    `${rejected.length === 1 ? "it" : "them"} ("${message}"): check parentheses, quotes and ` +
    `references. ` +
    (others > 0
      ? `The other ${others} cell${others === 1 ? " was" : "s were"} written; resend only the listed cells.`
      : `Nothing was written.`)
  );
}

function buildFormulaProblemsError(sheetName: string, problems: CellProblem[]): string {
  const list = problems
    .slice(0, 8)
    .map((p) => `${p.address} ${p.problem}: ${JSON.stringify(p.content)}`)
    .join("; ");
  const more = problems.length > 8 ? ` (and ${problems.length - 8} more)` : "";
  const placeholder = problems.some((p) => p.problem.startsWith("contains ["));
  return (
    `write_range refused: ${problems.length} formula${problems.length === 1 ? "" : "s"} on ` +
    `${sheetName} would be rejected by Excel — ${list}${more}. Nothing was written. ` +
    (placeholder ? `About the placeholder: ${PLACEHOLDER_EXPLANATION} ` : "") +
    `Fix the listed cells and resend the grid.`
  );
}

/* ------------------------- input grid normalization ------------------------ */

/**
 * Accept the cell grid in the shapes models actually send. The wire contract
 * is `formulas: string[][]`, but models routinely (a) put the grid under
 * `values` — the tool is described as writing "values/formulas", so the guess
 * is reasonable — (b) double-encode the array as a JSON string, or (c) send a
 * flat 1D array for a single-row/column range. Before this normalizer, all
 * three collapsed into one misleading "you sent an empty `formulas` array"
 * error that echoed nothing of what actually arrived — observed live
 * (2026-07-02): a model looped the identical failing call because, from its
 * side, it HAD sent the grid. Coerce what is unambiguous, note the coercion
 * in the result so the model converges on the contract, and when nothing is
 * usable, report exactly what arrived instead.
 */
function normalizeGridInput(
  input: Record<string, unknown>,
  expectedRows: number,
  expectedCols: number
): { grid: string[][]; notes: string[] } {
  const notes: string[] = [];

  for (const key of ["formulas", "values"] as const) {
    let raw = input[key];
    if (raw === undefined || raw === null) continue;

    // (b) JSON-encoded string containing the array.
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (!trimmed.startsWith("[")) continue;
      try {
        raw = JSON.parse(trimmed);
      } catch {
        continue; // unparseable — the missing-grid report below covers it
      }
      notes.push(
        `\`${key}\` arrived as a JSON-encoded string and was auto-decoded — send a raw JSON array next time.`
      );
    }

    if (!Array.isArray(raw) || raw.length === 0) continue;

    // (c) 1D array of scalars — wrap only when the address disambiguates.
    if (!Array.isArray(raw[0])) {
      const isScalarList = raw.every(
        (v) => v === null || ["string", "number", "boolean"].includes(typeof v)
      );
      if (!isScalarList) continue;
      if (expectedRows === 1 && raw.length === expectedCols) {
        notes.push(
          `\`${key}\` arrived as a flat 1D array and was wrapped as one row — send a 2D array ([[...]]) next time.`
        );
        raw = [raw];
      } else if (expectedCols === 1 && raw.length === expectedRows) {
        notes.push(
          `\`${key}\` arrived as a flat 1D array and was reshaped to one column — send a 2D array ([[a],[b],...]) next time.`
        );
        raw = (raw as unknown[]).map((v) => [v]);
      } else {
        continue; // ambiguous for a multi-row, multi-column range
      }
    }

    if (key === "values" && !notes.some((n) => n.startsWith("`values`"))) {
      notes.push("Grid accepted from `values` — the canonical parameter is `formulas`.");
    }
    return { grid: raw as string[][], notes };
  }

  throw new Error(buildMissingGridError(input));
}

/**
 * No usable grid anywhere in the call — say precisely what arrived under
 * each candidate key so the model can see its own mistake (the generic
 * "empty array" wording sent models into identical-retry loops).
 */
function buildMissingGridError(input: Record<string, unknown>): string {
  const keys = Object.keys(input);
  const describe = (k: string): string => {
    const v = input[k];
    if (v === undefined || v === null) return `\`${k}\` was ABSENT`;
    if (typeof v === "string") return `\`${k}\` arrived as a string (not a JSON array)`;
    if (Array.isArray(v)) {
      if (v.length === 0) return `\`${k}\` arrived as an EMPTY array []`;
      return `\`${k}\` arrived as an array whose entries could not be read as rows`;
    }
    return `\`${k}\` arrived as ${typeof v}`;
  };
  return (
    `write_range failed: no usable cell grid in the call. ` +
    `Keys received: [${keys.join(", ") || "none"}]. ` +
    `${describe("formulas")}; ${describe("values")}.\n` +
    `Provide the grid as \`formulas\`: a raw row-major 2D JSON array — outer = rows, ` +
    `inner = columns, e.g. for a 1-row × 3-column range: "formulas": [["a", "b", "c"]]. ` +
    `Do not JSON-encode the array as a string.\n\nResubmit write_range with a \`formulas\` 2D array.`
  );
}

/**
 * Validate that `copy_to_range` shares its starting cell with `address`
 * and strictly contains it. Throws a clear error otherwise so the model
 * can adjust. We only validate the textual form here; the actual fill is
 * delegated to the data source which uses Excel.Range.autoFill in
 * production.
 */
function validateCopyToRange(address: string, copyToRange: string): void {
  const seed = parseRange(address);
  const target = parseRange(copyToRange);
  if (seed.topLeft.col !== target.topLeft.col || seed.topLeft.row !== target.topLeft.row) {
    throw new Error(
      `copy_to_range "${copyToRange}" must share starting cell with address "${address}".`
    );
  }
  const targetRows = rangeRowCount(target);
  const targetCols = rangeColumnCount(target);
  const seedRows = rangeRowCount(seed);
  const seedCols = rangeColumnCount(seed);
  if (targetRows < seedRows || targetCols < seedCols) {
    throw new Error(
      `copy_to_range "${copyToRange}" must strictly contain address "${address}" — got ${targetRows}×${targetCols} target, ${seedRows}×${seedCols} seed.`
    );
  }
}

function countNonEmptyCells(values: CellValue[][], formulas: string[][]): number {
  let n = 0;
  for (let r = 0; r < values.length; r++) {
    for (let c = 0; c < values[r].length; c++) {
      const v = values[r][c];
      const f = formulas[r]?.[c] ?? "";
      if (f.length > 0) {
        n++;
      } else if (v !== null && v !== "" && v !== undefined) {
        n++;
      }
    }
  }
  return n;
}

/* ------------------------- error-message helpers --------------------------- */

/**
 * Two shapes still refuse outright, because guessing at either would write a
 * table the model did not intend and report success. Everything else — a row
 * or column count that simply disagrees with `address` — is resolved by
 * anchoring to the top-left cell and trusting the grid.
 */
function buildTransposedError(
  address: string,
  declaredRows: number,
  declaredCols: number,
  gotRows: number,
  gotCols: number
): string {
  return (
    `write_range failed: your grid is TRANSPOSED. Address ${address} is ` +
    `${declaredRows} rows × ${declaredCols} columns, and you sent ${gotRows} outer entries ` +
    `× ${gotCols} inner entries — outer matches the column count and inner matches the row ` +
    `count, so rows and columns are swapped.
` +
    `Swap them so the OUTER array is rows: ${renderShapeTemplate(declaredRows, declaredCols)}

` +
    `(If ${gotRows}×${gotCols} is genuinely what you meant, keep the grid and pass just the ` +
    `anchor cell "${anchorCell(address)}" — the address is resized to whatever you send.)`
  );
}

function buildEmptyGridError(address: string): string {
  return (
    `write_range failed: the grid is empty, so there is nothing to write to ${address}. ` +
    "`formulas` must be a non-empty 2D array — outer = rows, inner = columns, " +
    'e.g. [["a", "b"], ["c", "d"]].'
  );
}

/* ------------------------- anchor-address arithmetic ----------------------- */

/**
 * Resize a range address to exactly `rows` × `cols`, keeping its top-left
 * cell and any sheet qualifier. This is what makes `address` an ANCHOR: the
 * caller names the corner, the grid names the extent.
 */
function resizeAddress(address: string, rows: number, cols: number): string {
  const trimmed = address.trim();
  const bang = trimmed.lastIndexOf("!");
  const qualifier = bang >= 0 ? trimmed.slice(0, bang + 1) : "";
  try {
    const ref = parseRange(trimmed);
    return (
      qualifier +
      formatRange({
        topLeft: ref.topLeft,
        bottomRight: {
          col: ref.topLeft.col + cols - 1,
          row: ref.topLeft.row + rows - 1,
        },
      })
    );
  } catch {
    // Unparseable input — the data source will report the bad address.
    return address;
  }
}

/** The top-left cell of an address, as the model would type it. */
function anchorCell(address: string): string {
  const trimmed = address.trim();
  try {
    const ref = parseRange(trimmed);
    return formatRange({ topLeft: ref.topLeft, bottomRight: ref.topLeft }).split(":")[0];
  } catch {
    return trimmed;
  }
}

/**
 * A ragged grid, described truthfully. The previous wording blamed the
 * address ("address C3:I7 requires every row to have exactly 6 cells") when
 * the 6 was really the length of row 0 and C:I is seven columns wide — the
 * model corrected its rows to 6 and was refused again (observed 2026-09-10).
 * Say which rows have which length, then name the width the model most
 * likely meant: the declared range's width when some row already matches
 * it, otherwise the commonest row length.
 */
function buildRaggedGridError(
  address: string,
  declaredCols: number,
  isRangeAddress: boolean,
  grid: string[][]
): string {
  const lengths = grid.map((row) => row.length);
  const groups: string[] = [];
  let start = 0;
  for (let r = 1; r <= lengths.length; r++) {
    if (r === lengths.length || lengths[r] !== lengths[start]) {
      const label = r - 1 === start ? `row ${start}` : `rows ${start}–${r - 1}`;
      groups.push(`${label}: ${lengths[start]}`);
      start = r;
    }
  }
  const shownGroups = groups.length > 6 ? [...groups.slice(0, 6), "…"] : groups;

  const counts = new Map<number, number>();
  for (const n of lengths) counts.set(n, (counts.get(n) ?? 0) + 1);
  const commonest = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
  const target = isRangeAddress && lengths.includes(declaredCols) ? declaredCols : commonest;
  const why =
    isRangeAddress && target === declaredCols
      ? `Address ${address} spans ${declaredCols} column${declaredCols === 1 ? "" : "s"}`
      : `Most rows have ${target}`;
  const fixes = [...counts.keys()]
    .filter((n) => n !== target)
    .sort((a, b) => a - b)
    .map((n) =>
      n < target
        ? `pad the ${n}-cell rows with ${target - n} × ""`
        : `trim the ${n}-cell rows by ${n - target}`
    );
  return (
    `write_range failed: the rows of your \`formulas\` grid have different lengths ` +
    `(cells per row — ${shownGroups.join("; ")}). Every row must have the same number of cells. ` +
    `${why}, so make every row ${target} cells: ${fixes.join(", ")}. Nothing was written.`
  );
}

/**
 * Produce a JSON-ish stub showing what the correct `formulas` array should
 * look like. Truncates middle rows when the table is large so the message
 * stays compact but the structure stays clear.
 */
function renderShapeTemplate(rows: number, cols: number): string {
  const sampleRow = "[" + Array(cols).fill('""').join(", ") + "]";
  if (rows <= 3) {
    return (
      "[\n" +
      Array(rows)
        .fill("  " + sampleRow)
        .join(",\n") +
      "\n]  // " +
      rows +
      " rows × " +
      cols +
      " cols"
    );
  }
  // Show first 2, ellipsis, last 1 to convey shape without bloating tokens.
  return (
    "[\n" +
    "  " +
    sampleRow +
    ",   // row 0\n" +
    "  " +
    sampleRow +
    ",   // row 1\n" +
    `  // ... ${rows - 3} more rows, each with exactly ${cols} cells ...\n` +
    "  " +
    sampleRow +
    "    // row " +
    (rows - 1) +
    "\n" +
    `]  // ${rows} rows × ${cols} cols total`
  );
}

/* ----------------------------------- undo ---------------------------------- */

interface UndoOutput {
  restored?: string;
  message: string;
}

export const undoTool: ToolDef<Record<string, never>, UndoOutput> = {
  name: "undo",
  description:
    "Restore the most recent write_range to its prior contents (one entry per write, LIFO). " +
    "Only write_range writes are captured — formatting and run_excel_script changes are not. " +
    "Use when the user asks to undo.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  requiredPermission: "Write",
  async execute(_input, { ds, undoStack }) {
    const entry = undoStack.pop();
    if (!entry) {
      return { message: "Nothing to undo." };
    }
    await ds.setRange(entry.sheetName, entry.address, restorationArray(entry));
    return {
      restored: `${entry.sheetName}!${entry.address}`,
      message: `Restored ${entry.sheetName}!${entry.address}.`,
    };
  },
};

/* ------------------------------ format_range ------------------------------ */

interface FormatRangeInput {
  sheetName: string;
  address: string;
  numberFormat?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontColor?: string;
  fillColor?: string;
  horizontalAlignment?: "left" | "center" | "right";
  verticalAlignment?: "top" | "middle" | "bottom";
  wrapText?: boolean;
  columnWidth?: number;
  autofitColumns?: boolean;
}

interface FormatRangeOutput {
  formatted: string;
  applied: string[];
}

export const formatRangeTool: ToolDef<FormatRangeInput, FormatRangeOutput> = {
  name: "format_range",
  description:
    "Apply uniform formatting to every cell in a range — number format, font, fill, " +
    "alignment, wrap, column width. Only the properties you pass are applied. Finish any " +
    "numeric block with autofitColumns: true so nothing renders as ######. Common number formats: " +
    '"$#,##0", "0.0%", "#,##0", "$#,##0;($#,##0);-" (negatives in parens, zero as dash), ' +
    '"@" (text). NOT restored by the undo tool — only Excel\'s native Ctrl+Z.',
  inputSchema: {
    type: "object",
    properties: {
      sheetName: { type: "string" },
      address: { type: "string", description: 'A1-style range, e.g. "A1:H9".' },
      numberFormat: { type: "string", description: 'Excel format string, e.g. "$#,##0".' },
      bold: { type: "boolean" },
      italic: { type: "boolean" },
      underline: { type: "boolean" },
      fontColor: { type: "string", description: 'Hex like "#FFFFFF".' },
      fillColor: { type: "string", description: 'Hex like "#1F4E79".' },
      horizontalAlignment: { type: "string", enum: ["left", "center", "right"] },
      verticalAlignment: { type: "string", enum: ["top", "middle", "bottom"] },
      wrapText: { type: "boolean" },
      columnWidth: {
        type: "number",
        description: "Column width in points, applied to every column in the range.",
      },
      autofitColumns: {
        type: "boolean",
        description:
          "Size every column in the range to fit its widest cell. Run it over the whole " +
          "block after writing — label and header columns too, not only numeric ones. A " +
          "too-narrow number renders as ######; a too-narrow label truncates only once " +
          "its neighbour is filled, so it looks fine when written and breaks later.",
      },
    },
    required: ["sheetName", "address"],
    additionalProperties: false,
  },
  requiredPermission: "Write",
  async execute(input, { ds }) {
    const { sheetName, address, ...format } = input;
    try {
      await ds.setFormat(sheetName, address, format);
    } catch (e) {
      // Office.js reports a bad address and a bad format string with the
      // same sentence and no echo of either. Attach both so the model can
      // see which argument to change instead of retrying the call as sent.
      const message = e instanceof Error ? e.message : String(e);
      const sent = Object.entries(format)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(", ");
      throw new Error(
        `format_range failed on ${sheetName}!${address} (${sent || "no properties"}): ${message}. ` +
          `Check that the address is a plain A1 range on an existing sheet` +
          (format.numberFormat !== undefined
            ? ` and that numberFormat is a valid Excel format string.`
            : `.`)
      );
    }

    const applied: string[] = [];
    if (format.numberFormat !== undefined) applied.push(`numberFormat=${format.numberFormat}`);
    if (format.bold !== undefined) applied.push(`bold=${format.bold}`);
    if (format.italic !== undefined) applied.push(`italic=${format.italic}`);
    if (format.underline !== undefined) applied.push(`underline=${format.underline}`);
    if (format.fontColor !== undefined) applied.push(`fontColor=${format.fontColor}`);
    if (format.fillColor !== undefined) applied.push(`fillColor=${format.fillColor}`);
    if (format.horizontalAlignment !== undefined)
      applied.push(`hAlign=${format.horizontalAlignment}`);
    if (format.verticalAlignment !== undefined) applied.push(`vAlign=${format.verticalAlignment}`);
    if (format.wrapText !== undefined) applied.push(`wrapText=${format.wrapText}`);
    if (format.columnWidth !== undefined) applied.push(`columnWidth=${format.columnWidth}`);
    if (format.autofitColumns !== undefined)
      applied.push(`autofitColumns=${format.autofitColumns}`);

    return {
      formatted: `${sheetName}!${address.toUpperCase()}`,
      applied,
    };
  },
};

/* ------------------------------ create_sheet ------------------------------ */

interface CreateSheetInput {
  name: string;
  position?: number;
  activate?: boolean;
}

interface CreateSheetOutput {
  sheetName: string;
  message: string;
  note?: string;
}

/**
 * Create a worksheet. A first-class tool on purpose.
 *
 * Before this existed, `run_excel_script` was the ONLY way to add a tab. When
 * a script silently failed (see run-script.ts), the agent had no route to a
 * named sheet at all and dumped a finished 134-unit rent-roll analysis onto
 * `Sheet1` — the deliverable the user actually received (2026-09-04). A build
 * that cannot make a tab cannot lay out a model.
 */
export const createSheetTool: ToolDef<CreateSheetInput, CreateSheetOutput> = {
  name: "create_sheet",
  description:
    "Create a new worksheet and return its actual name. Use this — not run_excel_script — " +
    "whenever a build needs its own tab. If the name is taken, a numbered suffix is added " +
    'rather than failing ("Analysis" → "Analysis (2)"), so the call always yields somewhere ' +
    "to write. Excel may also rewrite characters it disallows, so ALWAYS use the returned " +
    "`sheetName` for subsequent writes instead of the name you asked for.",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: 'Desired sheet name, e.g. "Rent Roll" or "Unit Mix".',
      },
      position: {
        type: "number",
        description: "Zero-based tab position. Omit to append at the end of the workbook.",
      },
      activate: {
        type: "boolean",
        description:
          "Bring the new sheet to the front. Defaults to true — the user should see what " +
          "you just made.",
      },
    },
    required: ["name"],
    additionalProperties: false,
  },
  requiredPermission: "Write",
  async execute({ name, position, activate }, { ds }) {
    const { name: sheetName, renamedFrom } = await ds.createSheet(name, { position, activate });
    return {
      sheetName,
      message: `Created sheet "${sheetName}".`,
      ...(renamedFrom && {
        note:
          `"${renamedFrom}" was already taken or contained characters Excel does not allow, ` +
          `so the sheet is named "${sheetName}". Use that name in every following call.`,
      }),
    };
  },
};

/* ------------------------------ bundle export ------------------------------ */

export const writeTools = [writeRangeTool, formatRangeTool, createSheetTool, undoTool];
