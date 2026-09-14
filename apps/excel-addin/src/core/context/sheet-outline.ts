import { columnIndexToLetter, formatA1, parseRange } from "./address";
import type { ExcelDataSource } from "./datasource";
import { normalizeFormula } from "./formula-norm";
import type { CellValue } from "./in-memory";

const MAX_TOP_LABELS = 30;
const MAX_LEFT_LABELS = 60;
const MAX_BODY_SAMPLES = 12;
const MAX_CLUSTER_SAMPLES = 3;

export interface FormulaCluster {
  /** Normalized pattern — the key the agent should think about. */
  pattern: string;
  /** A verbatim example formula from one cell in the cluster. */
  example: string;
  /** Cell address of `example`. */
  exampleAddress: string;
  /** Bounding-box address of all cells in the cluster, e.g. "B5:B104". */
  rangeAddress: string;
  /** True if every cell inside `rangeAddress` matches the pattern (no holes). */
  isRectangle: boolean;
  count: number;
  sampleValues: CellValue[];
}

export interface SampleCell {
  address: string;
  value: CellValue;
}

export interface SheetOutline {
  name: string;
  rowCount: number;
  columnCount: number;
  formulaCount: number;
  /**
   * Sheet-local address of the used range ("B2:I8"); null for an empty
   * sheet. Everything below is positioned relative to its top-left corner.
   */
  usedRange: string | null;
  /** Up to 30 cells from the first row of the used range, used as column labels by the agent. */
  topRowLabels: (CellValue | null)[];
  /** Up to 60 cells from the first column of the used range. */
  leftColumnLabels: (CellValue | null)[];
  /** Sorted by descending count — most-used patterns first. */
  formulaClusters: FormulaCluster[];
  /** Up to 12 non-formula values from the body (excluding row 1 / col A). */
  bodySamples: SampleCell[];
  /** Chart names on the sheet — the `screenshot` tool selects by name. */
  charts: string[];
}

/**
 * Hierarchical context level 2: detailed per-sheet outline.
 *
 * Reads the used range once, then walks cells to:
 *   1. Capture top row + left column labels
 *   2. Cluster formulas by normalized pattern (drag-fill clusters collapse)
 *   3. Bound each cluster's cells with min/max corners
 *   4. Sample a few body values so the agent knows what the data looks like
 *
 * Target output size: ~5k tokens per sheet, regardless of cell count.
 *
 * Performance: reads the entire used range in one `Excel.run`. For very
 * large sheets (>1M cells) callers should chunk via `core/context/range.ts`
 * once that module lands (Phase 2.3).
 */
export async function getSheetOutline(
  ds: ExcelDataSource,
  sheetName: string
): Promise<SheetOutline> {
  const sheets = await ds.listSheets();
  const summary = sheets.find((s) => s.name === sheetName);
  if (!summary) throw new Error(`Sheet not found: ${sheetName}`);

  // Chart names come from the charts collection, not the cell grid — fetch
  // them only when the cheap `hasCharts` flag says there's something to list.
  const charts = summary.hasCharts ? (await ds.listCharts(sheetName)).map((c) => c.name) : [];

  if (summary.rowCount === 0 || summary.columnCount === 0) {
    return {
      name: sheetName,
      rowCount: 0,
      columnCount: 0,
      formulaCount: 0,
      usedRange: null,
      topRowLabels: [],
      leftColumnLabels: [],
      formulaClusters: [],
      bodySamples: [],
      charts,
    };
  }

  // Read the used range where it actually is. This used to read
  // A1:<columnCount><rowCount>, which for a table at B2:I8 is A1:H7 — the
  // outline then described row 1 and column A (empty) and never saw column I
  // or the totals row, and the agent "fixed" formulas that referenced them.
  const usedRange =
    summary.usedRange ?? `A1:${columnIndexToLetter(summary.columnCount - 1)}${summary.rowCount}`;
  const origin = parseRange(usedRange).topLeft;
  const data = await ds.getRange(sheetName, usedRange);

  const topRowLabels: (CellValue | null)[] = [];
  const leftColumnLabels: (CellValue | null)[] = [];
  const bodySamples: SampleCell[] = [];
  const clusterMap = new Map<string, ClusterAccumulator>();
  let formulaCount = 0;

  for (let r = 0; r < data.rowCount; r++) {
    for (let c = 0; c < data.columnCount; c++) {
      const value = (data.values[r]?.[c] ?? null) as CellValue;
      const formula = data.formulas[r]?.[c] ?? "";
      // Absolute sheet coordinates; r/c are offsets inside the used range.
      const ac = origin.col + c;
      const ar = origin.row + r;
      const address = formatA1({ col: ac, row: ar });

      if (r === 0 && topRowLabels.length < MAX_TOP_LABELS) {
        topRowLabels.push(value);
      }
      if (c === 0 && leftColumnLabels.length < MAX_LEFT_LABELS) {
        leftColumnLabels.push(value);
      }

      if (formula) {
        formulaCount++;
        const pattern = normalizeFormula(formula, { col: ac, row: ar });
        let entry = clusterMap.get(pattern);
        if (!entry) {
          entry = {
            example: formula,
            exampleAddress: address,
            cells: [],
            minCol: ac,
            maxCol: ac,
            minRow: ar,
            maxRow: ar,
          };
          clusterMap.set(pattern, entry);
        }
        entry.cells.push({ col: ac, row: ar, value });
        if (ac < entry.minCol) entry.minCol = ac;
        if (ac > entry.maxCol) entry.maxCol = ac;
        if (ar < entry.minRow) entry.minRow = ar;
        if (ar > entry.maxRow) entry.maxRow = ar;
      } else if (value !== null && r > 0 && c > 0 && bodySamples.length < MAX_BODY_SAMPLES) {
        bodySamples.push({ address, value });
      }
    }
  }

  const formulaClusters: FormulaCluster[] = [];
  for (const [pattern, entry] of clusterMap) {
    const width = entry.maxCol - entry.minCol + 1;
    const height = entry.maxRow - entry.minRow + 1;
    const isRect = entry.cells.length === width * height;
    const tl = formatA1({ col: entry.minCol, row: entry.minRow });
    const br = formatA1({ col: entry.maxCol, row: entry.maxRow });
    formulaClusters.push({
      pattern,
      example: entry.example,
      exampleAddress: entry.exampleAddress,
      rangeAddress: tl === br ? tl : `${tl}:${br}`,
      isRectangle: isRect,
      count: entry.cells.length,
      sampleValues: entry.cells.slice(0, MAX_CLUSTER_SAMPLES).map((c) => c.value),
    });
  }
  formulaClusters.sort((a, b) => b.count - a.count);

  return {
    name: sheetName,
    rowCount: summary.rowCount,
    columnCount: summary.columnCount,
    formulaCount,
    usedRange,
    topRowLabels,
    leftColumnLabels,
    formulaClusters,
    bodySamples,
    charts,
  };
}

/**
 * Render the outline as compact text for system-prompt injection.
 */
export function renderSheetOutline(outline: SheetOutline): string {
  const lines: string[] = [];
  lines.push(`# Sheet: ${outline.name}`);
  if (outline.rowCount === 0) {
    lines.push("(empty)");
    return lines.join("\n");
  }
  // The address comes first because it is the fact the agent acts on; the
  // dimensions alone read as "starts at A1" to every model that saw them.
  const where = outline.usedRange ? `Used range: ${outline.usedRange} — ` : "";
  lines.push(
    `${where}${outline.rowCount} rows × ${outline.columnCount} columns; ${outline.formulaCount} formula cells`
  );

  const origin = outline.usedRange ? parseRange(outline.usedRange).topLeft : { col: 0, row: 0 };
  if (outline.topRowLabels.some((v) => v !== null)) {
    lines.push("");
    lines.push(`## Row ${origin.row + 1} labels (by column)`);
    lines.push(formatLabelRow(outline.topRowLabels, (i) => columnIndexToLetter(origin.col + i)));
  }
  if (outline.leftColumnLabels.some((v) => v !== null)) {
    lines.push("");
    lines.push(`## Column ${columnIndexToLetter(origin.col)} labels (by row)`);
    lines.push(formatLabelRow(outline.leftColumnLabels, (i) => String(origin.row + i + 1)));
  }

  if (outline.formulaClusters.length > 0) {
    lines.push("");
    lines.push(`## Formula clusters (${outline.formulaClusters.length})`);
    for (const c of outline.formulaClusters) {
      const shape = c.isRectangle ? "rect" : "sparse";
      const samples = c.sampleValues
        .map((v) => formatValue(v))
        .filter((s) => s !== "")
        .slice(0, 3)
        .join(", ");
      lines.push(
        `- ${c.rangeAddress} (${c.count} cells, ${shape}) example ${c.exampleAddress}: \`${c.example}\``
      );
      if (samples) lines.push(`  values: ${samples}`);
    }
  }

  if (outline.bodySamples.length > 0) {
    lines.push("");
    lines.push("## Body samples");
    lines.push(outline.bodySamples.map((s) => `${s.address}=${formatValue(s.value)}`).join(", "));
  }

  if (outline.charts.length > 0) {
    lines.push("");
    lines.push(`## Charts (${outline.charts.length})`);
    lines.push(outline.charts.map((c) => `"${c}"`).join(", "));
  }

  return lines.join("\n");
}

interface ClusterAccumulator {
  example: string;
  exampleAddress: string;
  cells: { col: number; row: number; value: CellValue }[];
  minCol: number;
  maxCol: number;
  minRow: number;
  maxRow: number;
}

/** Each label tagged with its column letter or row number, so the agent can
 * address a labelled column without counting: `B:"Unit Type" | C:"Units"`. */
function formatLabelRow(labels: (CellValue | null)[], tag: (index: number) => string): string {
  return labels.map((v, i) => `${tag(i)}:${v === null ? "·" : formatValue(v)}`).join(" | ");
}

function formatValue(v: CellValue): string {
  if (v === null) return "";
  if (typeof v === "string") return v.length > 30 ? `"${v.slice(0, 27)}…"` : `"${v}"`;
  return String(v);
}
