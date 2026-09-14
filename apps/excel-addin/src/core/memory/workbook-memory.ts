import type { ExcelDataSource } from "../context";

/**
 * Name of the hidden sheet that stores workbook-level memory. Prefixed with
 * an underscore by convention to signal "system sheet — don't edit directly
 * unless you know what you're doing." Excel allows hidden sheets to be
 * unhidden manually if a user really wants to inspect or edit the contents.
 */
export const MEMORY_SHEET = "_excelente";

/** Address inside the memory sheet where the markdown body lives. */
const MEMORY_CELL = "A1";

/** Soft cap — Excel allows ~32,767 characters per cell. */
export const MEMORY_MAX_CHARS = 30_000;

/**
 * Read the workbook's memory (CLAUDE.md analog). Returns an empty string when
 * the memory sheet doesn't exist yet — this is the common case for new
 * workbooks, and downstream callers treat empty as "no memory yet."
 *
 * SECURITY: the returned string is UNTRUSTED. It comes out of the workbook
 * file, so on any shared or downloaded model it was authored by someone
 * other than the user now running the agent. Callers must not present it to
 * the model as instructions from the user — see `buildSystemPrompt`, which
 * fences it as reference data. The read-side cap below is enforced
 * independently of `writeWorkbookMemory`'s cap, because a hand-edited cell
 * (or one written by another tool) can hold ~32,767 characters regardless
 * of what our writer allows.
 */
export async function readWorkbookMemory(ds: ExcelDataSource): Promise<string> {
  const sheets = await ds.listSheets();
  if (!sheets.some((s) => s.name === MEMORY_SHEET)) return "";

  const data = await ds.getRange(MEMORY_SHEET, MEMORY_CELL);
  const cell = data.values[0]?.[0];
  if (typeof cell !== "string") return "";
  if (cell.length <= MEMORY_MAX_CHARS) return cell;
  return (
    cell.slice(0, MEMORY_MAX_CHARS) +
    `\n\n[truncated — workbook memory exceeded ${MEMORY_MAX_CHARS} characters]`
  );
}

/**
 * Overwrite the workbook's memory. Creates the hidden sheet if it doesn't
 * exist. Throws when `content` exceeds Excel's per-cell character limit —
 * the agent should split memory across topics or trim before writing rather
 * than silently truncating, so the error surfaces explicitly.
 */
export async function writeWorkbookMemory(ds: ExcelDataSource, content: string): Promise<void> {
  if (content.length > MEMORY_MAX_CHARS) {
    throw new Error(
      `Workbook memory is ${content.length} characters; Excel's per-cell limit is ~32,767. ` +
        `Trim it to ${MEMORY_MAX_CHARS} or fewer characters and try again.`
    );
  }
  await ds.ensureHiddenSheet(MEMORY_SHEET);
  await ds.setRange(MEMORY_SHEET, MEMORY_CELL, [[content]]);
}
