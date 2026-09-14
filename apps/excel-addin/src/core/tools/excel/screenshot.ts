import { formatRange, parseRange, stripSheetQualifier } from "../../context";
import type { ExcelDataSource } from "../../context";
import { paintRangeHeaders } from "./paint-headers";
import type { ContentPart } from "../../openrouter";
import type { ToolDef } from "../types";

/**
 * Rows and columns captured around `address` on each side. An exact crop
 * shows the agent only what it already believes is there; the stray column,
 * the orphaned helper row and the gutter that was never set are all just
 * outside it (2026-09-10: a leftover Monthly Revenue column sat one column
 * right of every screenshot the agent took).
 */
export const DEFAULT_SCREENSHOT_MARGIN = 3;

interface ScreenshotInput {
  sheetName: string;
  /** A1-style range, e.g. "B2:K15". Omit (and omit chart selectors) to capture the whole used range. */
  address?: string;
  /** Rows/columns of surrounding context on each side of `address` (default 3; 0 = exact crop). */
  margin?: number;
  /** Capture a chart instead of a range. Find names via inspect_workbook(scope="sheet"). */
  chartName?: string;
  chartIndex?: number;
  /** Optional focused question for the vision model. */
  what_to_check?: string;
}

/**
 * Result varies by mode:
 *   - Vision routing active → string (the vision model's text description).
 *   - Direct (no vision model configured) → ContentPart[] so the primary
 *     sees the image inline.
 */
type ScreenshotOutput = string | ContentPart[];

/**
 * Unified screenshot tool. Captures either a range (default) or a chart
 * (when chartName/chartIndex is given) as a PNG, then either routes it to a
 * vision model and returns the text description, or returns the image inline
 * for a vision-capable primary. Consolidates the former screenshot_range +
 * take_chart_screenshot + list_charts trio — chart names now surface in the
 * sheet outline (inspect_workbook scope="sheet").
 */
export const screenshotTool: ToolDef<ScreenshotInput, ScreenshotOutput> = {
  name: "screenshot",
  description:
    "Capture a range or a chart as a PNG so you can see what the user sees. Default is a range " +
    "(`address`, or omit it for the whole used range); pass `chartName`/`chartIndex` to capture " +
    'a chart instead (find chart names via inspect_workbook(scope="sheet")). Use after ' +
    "non-trivial writes — sensitivity tables, formatted sections, conditional formatting, charts. " +
    "Returns a text description (vision-routed) or the image itself. Pass `what_to_check` to focus " +
    "on a specific concern. Images cost tokens — screenshot the touched section, not every cell. " +
    "A margin of 3 rows and columns around `address` is included so neighbouring content shows; " +
    "look at it. LOOK FOR CLIPPED TEXT: a label wider than its column is cut off mid-word " +
    '("Vacancy ra", "Total Mont") and a number too wide shows as ######; both mean the column ' +
    "needs format_range with autofitColumns. Text only clips once the cell to its right is " +
    "filled, so a label that looked fine when written can be broken by the time you screenshot. " +
    "Row numbers and column letters ARE drawn on, so name the exact column when you report a " +
    'problem — say "column K is too narrow", not "a column is too narrow". They are painted by ' +
    "Excelente, not part of Excel's own capture, and are absent if the host could not report " +
    "dimensions. The image still shows no column WIDTH — read that with " +
    'inspect_workbook(scope="range").',
  inputSchema: {
    type: "object",
    properties: {
      sheetName: { type: "string" },
      address: {
        type: "string",
        description:
          'A1-style range, e.g. "B2:K15". Omit (with no chart selector) for the whole sheet.',
      },
      margin: {
        type: "number",
        description:
          "Rows and columns of surrounding context captured on each side of `address` " +
          "(default 3). Pass 0 for an exact crop.",
      },
      chartName: {
        type: "string",
        description:
          'Capture this chart instead of a range. Names come from inspect_workbook(scope="sheet").',
      },
      chartIndex: {
        type: "number",
        description: "Zero-based chart index — alternative to chartName.",
      },
      what_to_check: {
        type: "string",
        description:
          "Optional question to focus the vision model, e.g. 'totals formatted as currency with parens for negatives'.",
      },
    },
    required: ["sheetName"],
    additionalProperties: false,
  },
  requiredPermission: "Read",
  async execute(
    { sheetName, address, margin, chartName, chartIndex, what_to_check },
    { ds, visionCall }
  ) {
    const isChart = typeof chartName === "string" || typeof chartIndex === "number";

    let pngDataUrl: string;
    let context: string;
    if (isChart) {
      const selector =
        typeof chartName === "string" ? { chartName } : { chartIndex: chartIndex as number };
      pngDataUrl = await ds.getChartImage(sheetName, selector);
      const label =
        typeof chartName === "string" ? `chart "${chartName}"` : `chart at index ${chartIndex}`;
      context = `Screenshot of ${label} on sheet "${sheetName}".`;
    } else {
      // Models often pass a sheet-qualified address ("DCF Template!B2:P36");
      // the datasource tolerates it, and we normalize here so the label reads
      // cleanly instead of doubling the sheet name.
      const local = address ? stripSheetQualifier(address) : address;
      const captured = local && local.length > 0 ? padAddress(local, margin) : local;
      pngDataUrl = await ds.getRangeImage(sheetName, captured);
      // Paint on the row numbers and column letters Office.js cannot give us.
      // Fail-soft on every step: an unpainted screenshot is a small loss, a
      // thrown error mid-verification is not.
      pngDataUrl = await withHeaders(ds, sheetName, captured, pngDataUrl);
      if (!local || local.length === 0) {
        context = `Screenshot of ${sheetName} (used range).`;
      } else if (captured === local.toUpperCase()) {
        context = `Screenshot of ${sheetName}!${local}.`;
      } else {
        context =
          `Screenshot of ${sheetName}!${local}, captured as ${captured} — a margin of ` +
          `${marginOf(margin)} rows and columns is included so you see what sits next to the range.`;
      }
    }

    if (visionCall) {
      const description = await visionCall({
        imageDataUrl: pngDataUrl,
        context,
        question: what_to_check,
      });
      return `${context}\n\nVision model report:\n${description}`;
    }

    return [
      { type: "text", text: context },
      { type: "image_url", image_url: { url: pngDataUrl } },
    ];
  },
};

/**
 * Adds a row/column header gutter to a range capture, or returns the capture
 * untouched if anything about it is unavailable — no canvas (Node), a host
 * that will not report dimensions, an address that will not parse.
 *
 * Applied on BOTH delivery paths on purpose. A vision-routed describer needs
 * the letters even more than a vision-capable primary does: it is asked to
 * describe a grid it has no other handle on, and without headers it has been
 * observed inventing them.
 */
async function withHeaders(
  ds: { getRangeDimensions?: ExcelDataSource["getRangeDimensions"] },
  sheetName: string,
  capturedAddress: string | undefined,
  pngDataUrl: string
): Promise<string> {
  if (typeof ds.getRangeDimensions !== "function") return pngDataUrl;
  try {
    const dims = await ds.getRangeDimensions(sheetName, capturedAddress);
    const ref = parseRange(stripSheetQualifier(dims.address));
    return await paintRangeHeaders(pngDataUrl, {
      startCol: ref.topLeft.col,
      startRow: ref.topLeft.row + 1, // parseRange rows are 0-based; Excel's are 1-based
      columnWidths: dims.columnWidths,
      rowHeights: dims.rowHeights,
    });
  } catch {
    return pngDataUrl;
  }
}

function marginOf(margin: number | undefined): number {
  if (typeof margin !== "number" || !Number.isFinite(margin) || margin < 0) {
    return DEFAULT_SCREENSHOT_MARGIN;
  }
  return Math.floor(margin);
}

/** Grow `address` by `margin` rows and columns on every side, stopping at row 1 / column A. */
export function padAddress(address: string, margin: number | undefined): string {
  const m = marginOf(margin);
  const ref = parseRange(address);
  if (m === 0) return formatRange(ref);
  return formatRange({
    topLeft: { col: Math.max(0, ref.topLeft.col - m), row: Math.max(0, ref.topLeft.row - m) },
    bottomRight: { col: ref.bottomRight.col + m, row: ref.bottomRight.row + m },
  });
}

export const screenshotTools = [screenshotTool];
