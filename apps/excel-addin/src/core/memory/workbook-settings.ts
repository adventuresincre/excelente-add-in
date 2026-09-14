import type { ExcelDataSource } from "../context";
import type { ReasoningLevel } from "../storage";
import { MEMORY_SHEET } from "./workbook-memory";

/**
 * Per-workbook settings overrides. When present, take precedence over
 * the global OfficeRuntime.storage settings — so a model picked here
 * applies to this workbook only, leaving other workbooks alone.
 *
 * Stored as a JSON blob in cell `B1` of the hidden `_excelente` sheet so
 * the markdown memory body in `A1` stays clean and human-readable. Both
 * travel with the workbook file.
 *
 * SECURITY — this record is UNTRUSTED INPUT. It ships inside the `.xlsx`,
 * so whoever authored or last touched the file controls it, not the user
 * opening it. Only add a field here when a hostile value for it is
 * harmless. Anything that would relax a safety control (approval gates,
 * permission levels, tool allowlists) must NOT live here: see the
 * deliberately-dropped `autoApproveWrites` in `sanitizeOverrides`.
 */
export interface WorkbookOverrides {
  /** OpenRouter model id, e.g. "anthropic/claude-opus-4-7". */
  model?: string;
  /** Reasoning level for models that support it. */
  reasoning?: ReasoningLevel;
}

/** Cell address in the `_excelente` sheet where overrides JSON lives. */
const OVERRIDES_CELL = "B1";

/**
 * Read the workbook's settings overrides. Returns an empty object when no
 * overrides have been written yet — the common case for new workbooks.
 * Malformed JSON returns empty (with a console warning) rather than
 * throwing, since stale or hand-edited content shouldn't crash startup.
 */
export async function readWorkbookOverrides(ds: ExcelDataSource): Promise<WorkbookOverrides> {
  const sheets = await ds.listSheets();
  if (!sheets.some((s) => s.name === MEMORY_SHEET)) return {};

  let cell: unknown;
  try {
    const data = await ds.getRange(MEMORY_SHEET, OVERRIDES_CELL);
    cell = data.values[0]?.[0];
  } catch {
    return {};
  }
  if (typeof cell !== "string" || cell.length === 0) return {};

  try {
    const parsed = JSON.parse(cell);
    return sanitizeOverrides(parsed);
  } catch (e) {
    console.warn(
      `Workbook overrides in ${MEMORY_SHEET}!${OVERRIDES_CELL} are not valid JSON: ${(e as Error).message}`
    );
    return {};
  }
}

/**
 * Write the workbook's settings overrides. The hidden `_excelente` sheet
 * is created on first call (via the same ensureHiddenSheet path memory
 * uses). Pass an empty object to clear overrides — they fall back to the
 * global OfficeRuntime.storage settings.
 */
export async function writeWorkbookOverrides(
  ds: ExcelDataSource,
  overrides: WorkbookOverrides
): Promise<void> {
  await ds.ensureHiddenSheet(MEMORY_SHEET);
  const json = JSON.stringify(sanitizeOverrides(overrides));
  await ds.setRange(MEMORY_SHEET, OVERRIDES_CELL, [[json]]);
}

/**
 * Strip unknown keys + coerce wrong types to undefined. Defensive against
 * hand-edited JSON or future-format settings: we only honor fields we
 * recognize, so an old client doesn't choke on a newer format's keys.
 *
 * This allowlist is a SECURITY BOUNDARY, not just format hygiene — see the
 * `WorkbookOverrides` doc comment. `autoApproveWrites` used to be honored
 * here and is now deliberately dropped: because `B1` ships inside the
 * `.xlsx`, a workbook could carry `{"autoApproveWrites":true}` and silently
 * turn off the write-approval prompt for everyone who opened it — consent
 * the user never gave, granted by whoever authored the file. Sharing
 * templates is the product's core workflow, so that flag cannot come from
 * the file. Auto-approve is now exclusively a per-session choice the user
 * makes in the UI ("Approve all" on an approval card), which resets on
 * every new run. Legacy workbooks carrying the key parse fine — the value
 * is read and discarded.
 */
function sanitizeOverrides(raw: unknown): WorkbookOverrides {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  const out: WorkbookOverrides = {};

  if (typeof obj.model === "string" && obj.model.length > 0) {
    out.model = obj.model;
  }
  if (
    obj.reasoning === "off" ||
    obj.reasoning === "low" ||
    obj.reasoning === "medium" ||
    obj.reasoning === "high"
  ) {
    out.reasoning = obj.reasoning;
  }
  return out;
}
