import {
  describeClipping,
  getSheetOutline,
  getWorkbookOutline,
  readRange,
  renderSheetOutline,
  renderWorkbookOutline,
} from "../../context";
import type { SelectionInfo } from "../../context";
import type { ToolDef } from "../types";
import { findCellsTool } from "./find";
import { traceDependenciesTool } from "./trace";

/* --------------------------- inspect_workbook ----------------------------- */

type InspectScope = "workbook" | "sheet" | "range";
type InspectDetail = "outline" | "full";
type InspectFormat = "structured" | "csv";

interface InspectWorkbookInput {
  scope: InspectScope;
  detail?: InspectDetail;
  sheetName?: string;
  address?: string;
  /**
   * Output shape for range reads. "structured" returns
   * { values, formulas } (default — preserves formulas). "csv" returns a
   * single CSV string (~2× cheaper tokens for bulk data; drops formulas).
   * Ignored for outline scopes.
   */
  format?: InspectFormat;
}

type InspectWorkbookResult =
  | string
  | {
      address: string;
      values: unknown[][];
      formulas: string[][];
      /** Excel character units, one per column left to right. */
      columnWidths?: number[];
      /** Points, one per row top to bottom. */
      rowHeights?: number[];
      /** Present when the read stopped short of populated cells. */
      note?: string;
    };

/**
 * Unified read tool that consolidates the previous read_workbook_outline /
 * read_sheet_outline / read_range trio behind a single (scope, detail) axis.
 *
 * Supported combinations:
 *   scope=workbook, detail=outline  → workbook outline (~1k tokens)
 *   scope=sheet,    detail=outline  → sheet outline (~5k tokens; requires sheetName)
 *   scope=range,    detail=full     → exact values + formulas (requires sheetName + address)
 *
 * Other combinations (e.g. scope=range + detail=outline, scope=workbook +
 * detail=full) are rejected with a clear error — they don't map to anything
 * meaningful and surfacing the constraint up front is friendlier than
 * generating an empty / oversized response.
 */
export const inspectWorkbookTool: ToolDef<InspectWorkbookInput, InspectWorkbookResult> = {
  name: "inspect_workbook",
  description:
    "Read the workbook at one of three scopes:\n" +
    '  scope="workbook" — outline: sheet names, dimensions, named ranges, chart/pivot flags ' +
    "(~1k tokens). Call first on any workbook task.\n" +
    '  scope="sheet" — outline of one sheet: top-row + left-column labels, formula clusters, ' +
    "sample values (~5k tokens; requires sheetName).\n" +
    '  scope="range" — exact values + formulas, plus columnWidths and rowHeights, both in ' +
    "POINTS (not the character units the Column Width dialog shows; a default column is 48). " +
    "Widths are the ONLY way to verify a layout " +
    "convention: they are not cell values and a screenshot renders cells without the " +
    'row/column headers. (Requires sheetName + address like "B5:D10".) ' +
    "Use when outlines aren't enough.\n" +
    'Range output is { address, values, formulas }; pass format="csv" for values-only CSV ' +
    "(~2× cheaper) when reading data tables (T-12, rent roll, comps).",
  inputSchema: {
    type: "object",
    properties: {
      scope: {
        type: "string",
        enum: ["workbook", "sheet", "range"],
        description: "Which level of the workbook to read.",
      },
      detail: {
        type: "string",
        enum: ["outline", "full"],
        description:
          "Defaults to match scope (workbook/sheet → outline, range → full); other combinations are rejected.",
      },
      sheetName: {
        type: "string",
        description: 'Sheet name. Required when scope is "sheet" or "range".',
      },
      address: {
        type: "string",
        description: 'A1-style range, e.g. "B5:D10". Required when scope is "range".',
      },
      format: {
        type: "string",
        enum: ["structured", "csv"],
        description:
          '"structured" (default) keeps formulas; "csv" is values-only and cheaper. Range scope only.',
      },
    },
    required: ["scope"],
    additionalProperties: false,
  },
  requiredPermission: "Read",
  async execute(input, { ds }) {
    const scope = input.scope;
    const detail: InspectDetail = input.detail ?? (scope === "range" ? "full" : "outline");

    if (scope === "workbook") {
      if (detail !== "outline") {
        throw new Error(
          `inspect_workbook: scope="workbook" only supports detail="outline" (got "${detail}"). ` +
            `For full data, narrow to scope="sheet" or scope="range".`
        );
      }
      const outline = await getWorkbookOutline(ds);
      return renderWorkbookOutline(outline);
    }

    if (scope === "sheet") {
      if (detail !== "outline") {
        throw new Error(
          `inspect_workbook: scope="sheet" currently supports detail="outline" only (got "${detail}"). ` +
            `For full cell data, use scope="range" with an address.`
        );
      }
      if (!input.sheetName) {
        throw new Error('inspect_workbook: scope="sheet" requires sheetName.');
      }
      const outline = await getSheetOutline(ds, input.sheetName);
      return renderSheetOutline(outline);
    }

    // scope === "range"
    if (detail !== "full") {
      throw new Error(`inspect_workbook: scope="range" requires detail="full" (got "${detail}").`);
    }
    if (!input.sheetName || !input.address) {
      throw new Error('inspect_workbook: scope="range" requires both sheetName and address.');
    }
    const data = await readRange(ds, input.sheetName, input.address);
    // Say so when the read stopped short of populated cells. The probe is
    // advisory: if it fails for any reason the read itself still returns.
    const note = await describeClipping(ds, input.sheetName, input.address).catch(() => null);
    // Default to structured ({ values, formulas }) — Wave 9b rollback of
    // the Wave 8c CSV-by-default. Agents reading existing models almost
    // always need formula visibility; CSV stays available for data-table
    // dumps via explicit format="csv".
    const format = input.format ?? "structured";
    if (format === "csv") {
      const csv = renderCsv(data.address, data.values as unknown[][]);
      return note ? `${csv}\n# NOTE: ${note}` : csv;
    }
    // Dimensions are the only way to CHECK a layout convention. They are not
    // cell values, and `Range.getImage` renders cells without the row/column
    // headers, so before this a width could be set and never verified.
    return {
      address: data.address,
      values: data.values,
      formulas: data.formulas,
      ...(data.columnWidths && { columnWidths: data.columnWidths }),
      ...(data.rowHeights && { rowHeights: data.rowHeights }),
      ...(note && { note }),
    };
  },
};

/**
 * Render a 2D values array as CSV. RFC-4180-ish: cells containing a comma,
 * quote, or newline get double-quoted with internal quotes doubled; null
 * cells become empty fields. First line is the resolved range address so
 * the agent doesn't lose track of where the data came from.
 */
function renderCsv(addressLabel: string, values: unknown[][]): string {
  const lines = [`# ${addressLabel}`];
  for (const row of values) {
    lines.push(row.map(csvField).join(","));
  }
  return lines.join("\n");
}

function csvField(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/* ------------------------------ get_selection ------------------------------ */

export const getSelectionTool: ToolDef<
  Record<string, never>,
  SelectionInfo | { selected: false }
> = {
  name: "get_selection",
  description:
    'Returns the sheet and address of the user\'s current Excel selection. Useful when the user refers to "this cell" or "this range" without naming an address.',
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  requiredPermission: "Read",
  async execute(_input, { ds }) {
    const sel = await ds.getSelection();
    return sel ?? { selected: false };
  },
};

/* ------------------------------ bundle export ------------------------------ */

/** All read-only Excel tools. inspect_workbook is the level-shifting reader
 * (workbook → sheet → range), and it already surfaces sheet names, named
 * ranges, and chart names — so the former list_sheets / list_named_ranges /
 * list_charts inventory tools are gone (pure subsets). `trace_dependencies`
 * lives in ./trace.ts but ships here so every registry gets it without extra
 * wiring. */
export const readTools = [
  inspectWorkbookTool,
  findCellsTool,
  getSelectionTool,
  traceDependenciesTool,
];
