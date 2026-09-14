import type { ExcelDataSource } from "./datasource";
import type { WorkbookOutline } from "./types";

/**
 * Cheap workbook-level outline — sheet names, dimensions, named ranges, and
 * "has charts / pivots" flags. Target output size: ~1k tokens regardless of
 * workbook size, so the agent can always afford to load this.
 */
export async function getWorkbookOutline(ds: ExcelDataSource): Promise<WorkbookOutline> {
  const [sheets, namedRanges, activeSheet] = await Promise.all([
    ds.listSheets(),
    ds.getNamedRanges(),
    ds.getActiveSheet(),
  ]);
  return {
    sheets,
    namedRanges,
    activeSheet: activeSheet ?? undefined,
  };
}

/**
 * Render the outline to a compact text form suitable for system-prompt
 * injection. Stays under ~1k tokens for typical CRE workbooks.
 */
export function renderWorkbookOutline(outline: WorkbookOutline): string {
  const lines: string[] = [];
  lines.push("# Workbook outline");
  if (outline.activeSheet) {
    lines.push(`Active sheet: ${outline.activeSheet}`);
  }
  lines.push("");
  lines.push(`## Sheets (${outline.sheets.length})`);
  for (const s of outline.sheets) {
    // The address is the fact the agent needs; the bare dimensions invited a
    // guess that every sheet starts at A1 (2026-09-10: a B2:I8 table was read
    // as A2:H8 and its last column declared "blank").
    const dim =
      s.rowCount === 0
        ? "empty"
        : s.usedRange
          ? `${s.usedRange} (${s.rowCount}×${s.columnCount})`
          : `${s.rowCount}×${s.columnCount}`;
    const flags: string[] = [];
    if (!s.visible) flags.push("hidden");
    if (s.hasCharts) flags.push("charts");
    if (s.hasPivots) flags.push("pivots");
    const flagStr = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
    lines.push(`- ${s.name} — ${dim}${flagStr}`);
  }
  if (outline.namedRanges.length > 0) {
    lines.push("");
    lines.push(`## Named ranges (${outline.namedRanges.length})`);
    for (const n of outline.namedRanges) {
      const comment = n.comment ? ` — ${n.comment}` : "";
      lines.push(`- ${n.name} = ${n.refersTo}${comment}`);
    }
  }
  return lines.join("\n");
}
