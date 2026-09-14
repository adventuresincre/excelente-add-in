import type { ExcelDataSource, RunScriptResult } from "../../context";
import type { ToolDef } from "../types";

/**
 * Add `runScript(code)` to ExcelDataSource semantically — but in practice
 * we route through a separate runner module so the in-memory data source
 * can no-op cleanly. The data source itself stays focused on cell-level
 * read/write primitives.
 */
interface RunExcelScriptInput {
  /**
   * One-line human description of what the script does. Surfaced on the
   * approval card so the user can review intent alongside the code.
   */
  description: string;
  /**
   * JavaScript code executed inside `Excel.run(async (ctx) => { ... })`.
   * The variable `ctx` (typed as `Excel.RequestContext`) is in scope; so
   * is `Excel`. Code MUST `await ctx.sync()` after queueing operations
   * and BEFORE reading any loaded properties — Office.js is batched.
   * Async/await is supported; the runtime wraps your code in an IIFE.
   *
   * Footguns the model should remember (see office-js-patterns skill):
   *   1. AWAIT every promise — a dropped one loses its writes silently
   *   2. Load → sync → use
   *   3. Collections need "items/<prop>" + sync before indexing
   *   4. Use .formulas (not .values) for "=" strings
   *   5. Suspend calc mode for multi-formula writes
   *   6. Read back to verify, and return the proof
   */
  code: string;
}

interface RunExcelScriptResult {
  ok: boolean;
  /**
   * Whatever the script's last expression returned, or `null` when it
   * returned nothing.
   *
   * ALWAYS present on success, and never `undefined` — tool results reach
   * the model through `JSON.stringify`, which DROPS undefined-valued keys.
   * That is not cosmetic: it made a script that silently discarded every
   * write indistinguishable from one that legitimately returned nothing,
   * because both serialized to exactly `{"ok":true}` (2026-09-04 rent-roll
   * incident). If you have nothing to report, report null and say so.
   */
  output?: unknown;
  /** When ok=false, the JS error message + line/col if available. */
  error?: string;
  /**
   * Set when the script returned no value, or when errors escaped as
   * unhandled rejections. Read this before assuming the workbook changed.
   */
  warning?: string;
}

/**
 * The Bash of Excel. Executes arbitrary Office.js code so the agent can
 * reach Excel APIs that don't have a specialized tool — charts,
 * conditional formatting, structural ops, calculation mode, anything.
 *
 * Permission: ALWAYS Write. Scripts are approval-gated regardless of
 * whether the code happens to mutate the workbook. Simpler than dynamic
 * classification, and the user reviews the actual code before approving.
 *
 * The approval card shows `description` (one-line summary) at the top
 * and the full `code` below in a collapsible disclosure.
 *
 * Snapshot + rollback are intentionally NOT included in v1 — capturing
 * full workbook state before every script would balloon undo memory. The
 * `undo` tool handles cell-level reverts via the snapshot stack; for
 * script-driven structural changes, callers should add their own undo
 * inside the script when reversibility matters.
 */
export const runExcelScriptTool: ToolDef<RunExcelScriptInput, RunExcelScriptResult> = {
  name: "run_excel_script",
  description:
    "Execute arbitrary Office.js code inside Excel.run() — the escape hatch for anything the " +
    "specialized tools don't cover: charts, conditional formatting, sheet create/delete, " +
    "row/column insert/delete, freeze panes, grouping, calc mode. NOT undoable — double-check " +
    "target ranges and touch only what the task needs.\n\n" +
    "`ctx: Excel.RequestContext` and `Excel` are in scope; queue operations, `await ctx.sync()`, " +
    "then read loaded properties. Load the office-js-patterns skill before writing scripts; the " +
    "six rules: AWAIT every promise; load→sync→use; collections need 'items/<prop>' + sync; .formulas not .values " +
    'for "=" strings; suspend calc for bulk writes; read back to verify.\n\n' +
    "AWAIT EVERY PROMISE. Your code already runs inside an async function — write it at the top " +
    "level and `await` directly. Do NOT define `async function main(){…}` and then call `main();` " +
    "without awaiting, and do NOT pass an async callback to `forEach`. Excel.run releases the " +
    "request context as soon as your code returns, so a dropped promise means every operation it " +
    "queued is DISCARDED. Bare unawaited calls are refused before the script runs; use " +
    "`for…of` instead of `forEach` when the body awaits.\n\n" +
    "Returns { ok, output } or { ok: false, error }. `output` is your return value, or null if " +
    "you returned nothing — in which case a `warning` says so. ok:true with output:null proves " +
    "only that nothing threw, NOT that the workbook changed: `return` a read-back value, a " +
    "count, or a sheet name whenever you need to confirm a write landed.",
  inputSchema: {
    type: "object",
    properties: {
      description: {
        type: "string",
        description:
          "One-line human-readable summary of what the script does. Shown to the user on the " +
          'approval card. Be specific: "Insert 3 rows at row 5 on Inputs" beats "Modify sheet."',
      },
      code: {
        type: "string",
        description:
          "JavaScript code that runs inside Excel.run(async (ctx) => { ... }). `ctx` and " +
          "`Excel` are in scope. Code can use async/await freely.",
      },
    },
    required: ["description", "code"],
    additionalProperties: false,
  },
  requiredPermission: "Write",
  async execute({ description, code }, { ds }) {
    void description; // Surfaced on the approval card; not used here.
    const dsWithRunner = ds as ExcelDataSource & {
      runScript?: (code: string) => Promise<RunScriptResult>;
    };
    if (!dsWithRunner.runScript) {
      return {
        ok: false,
        error:
          "run_excel_script is not supported in this data source (likely an in-memory test " +
          "context). In production the Office.js runner is wired in AppProvider.",
      };
    }
    try {
      const { output, swallowedErrors } = await dsWithRunner.runScript(code);

      // A dropped promise means workbook operations were queued against a
      // request context that Excel.run had already released. They are gone.
      // Reporting this as success is what turned a one-line bug into a lost
      // session, so it is a failure result.
      if (swallowedErrors.length > 0) {
        return {
          ok: false,
          error:
            `The script failed with ${swallowedErrors.length} error(s) that escaped as ` +
            `unhandled promise rejections: ${swallowedErrors.join("; ")}. ` +
            `This happens when a promise inside the script is never awaited — an async ` +
            `callback (\`forEach(async …)\`) is the usual cause. Excel.run released the ` +
            `request context before that work finished, so ANY workbook changes it queued ` +
            `were discarded. Rewrite so every promise is awaited (use a \`for…of\` loop ` +
            `instead of \`forEach\`), then re-run.`,
        };
      }

      const warnings: string[] = [];
      if (output === undefined) {
        warnings.push(
          "The script returned no value, so this result confirms only that it ran without " +
            "throwing — NOT that the workbook changed. `return` something that proves the " +
            "write landed (a read-back value, a count, a sheet name) if you need to verify."
        );
      }
      return {
        ok: true,
        // Never `undefined` — JSON.stringify would drop the key entirely.
        output: output === undefined ? null : output,
        ...(warnings.length > 0 && { warning: warnings.join(" ") }),
      };
    } catch (e) {
      const err = e as Error;
      return {
        ok: false,
        error: err.message ?? String(e),
      };
    }
  },
};
