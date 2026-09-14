import { formatA1, parseRange, readRange } from "../../context";
import type { ToolDef } from "../types";

/* -------------------------------- find_cells ------------------------------- */

interface FindCellsInput {
  query: string;
  /** Limit the search to one sheet. Default: every sheet. */
  sheetName?: string;
  /** Treat `query` as a JavaScript regular expression (case-insensitive). */
  regex?: boolean;
  /** Maximum hits to return (default 40, max 200). The total count is always reported. */
  limit?: number;
}

interface FindCellsOutput {
  /** One line per hit: `Sheet1!B2 = "Unit Mix"`, formulas shown in brackets. */
  matches: string[];
  /** Total hits across the searched sheets, including any not listed. */
  count: number;
  truncated: boolean;
  /** Sheets skipped because their used range exceeds the scan cap. */
  skipped?: string[];
}

const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 200;
/** Per-sheet cap on cells scanned; a sheet larger than this is reported, not searched. */
const MAX_SHEET_CELLS = 250_000;

/**
 * grep for the workbook. Computed on demand against the live cells — never a
 * snapshot, so it cannot go stale after a write — and cheap enough to be the
 * first call for "find the unit mix table": one hit at `Sheet1!B2 = "Unit
 * Mix"` replaces a workbook outline, a sheet outline and a guessed range read
 * (2026-09-10: that guess was one column short and the agent "fixed" correct
 * formulas as a result).
 */
export const findCellsTool: ToolDef<FindCellsInput, FindCellsOutput> = {
  name: "find_cells",
  description:
    "Search every cell of the workbook (values and formulas) for text — the grep of the " +
    "workbook. Case-insensitive substring by default; `regex: true` for a pattern. Returns " +
    'one line per hit like `Sheet1!B2 = "Unit Mix"` (formula hits show the formula in ' +
    "brackets) plus the total count. Use it FIRST to locate a table, a label, an input, or " +
    "every formula that mentions a cell, then read exactly that block with inspect_workbook.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: 'Text to look for, e.g. "Unit Mix", "NOI", "$C$8".',
      },
      sheetName: {
        type: "string",
        description: "Search only this sheet. Omit to search the whole workbook.",
      },
      regex: {
        type: "boolean",
        description: "Interpret `query` as a case-insensitive regular expression.",
      },
      limit: {
        type: "number",
        description: "Maximum hits to list (default 40, max 200).",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
  requiredPermission: "Read",
  async execute({ query, sheetName, regex, limit }, { ds }) {
    if (typeof query !== "string" || query.length === 0) {
      throw new Error("find_cells: `query` must be a non-empty string.");
    }
    const cap = Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit ?? DEFAULT_LIMIT)));
    const test = buildMatcher(query, regex === true);

    const sheets = await ds.listSheets();
    const targets = sheetName ? sheets.filter((s) => s.name === sheetName) : sheets;
    if (sheetName && targets.length === 0) {
      throw new Error(
        `find_cells: sheet "${sheetName}" not found. Sheets: ${sheets.map((s) => s.name).join(", ")}.`
      );
    }

    const matches: string[] = [];
    const skipped: string[] = [];
    let count = 0;

    for (const sheet of targets) {
      if (!sheet.usedRange) continue;
      if (sheet.rowCount * sheet.columnCount > MAX_SHEET_CELLS) {
        skipped.push(`${sheet.name} (${sheet.usedRange})`);
        continue;
      }
      const origin = parseRange(sheet.usedRange).topLeft;
      const data = await readRange(ds, sheet.name, sheet.usedRange);
      for (let r = 0; r < data.values.length; r++) {
        for (let c = 0; c < data.values[r].length; c++) {
          const value = data.values[r][c];
          const formula = data.formulas[r]?.[c] ?? "";
          const text = value === null || value === undefined ? "" : String(value);
          if (!(test(text) || (formula && test(formula)))) continue;
          count++;
          if (matches.length < cap) {
            const address = formatA1({ col: origin.col + c, row: origin.row + r });
            matches.push(
              `${sheet.name}!${address} = ${JSON.stringify(value)}${formula ? ` [${formula}]` : ""}`
            );
          }
        }
      }
    }

    return {
      matches,
      count,
      truncated: count > matches.length,
      ...(skipped.length > 0 && { skipped }),
    };
  },
};

function buildMatcher(query: string, regex: boolean): (text: string) => boolean {
  if (regex) {
    let re: RegExp;
    try {
      re = new RegExp(query, "i");
    } catch (e) {
      throw new Error(
        `find_cells: "${query}" is not a valid regular expression (${(e as Error).message}). ` +
          `Drop \`regex\` for a plain substring search.`
      );
    }
    return (text) => text.length > 0 && re.test(text);
  }
  const needle = query.toLowerCase();
  return (text) => text.length > 0 && text.toLowerCase().includes(needle);
}
