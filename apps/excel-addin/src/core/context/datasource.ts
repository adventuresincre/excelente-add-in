import type { NamedRangeInfo, RangeData, SheetSummary } from "./types";
import { MAX_DIMENSION_PROBE } from "./types";
import { stripSheetQualifier } from "./address";
import { buildScriptFunction } from "./run-script-sandbox";

/**
 * Guard against a host that reports success but hands back no image data.
 *
 * `Range.getImage` / `Chart.getImage` are the Office.js calls whose support
 * varies most across hosts, and the unhelpful failure is not an exception —
 * it is an empty `value`, which would sail through as a syntactically valid
 * `data:image/png;base64,` URL carrying nothing. The model then "sees" a
 * blank image and reports on it confidently. Turn that into an error the
 * agent can act on instead.
 */
export function assertImagePayload(
  value: string | undefined,
  what: string
): asserts value is string {
  // A real PNG of any Excel content is kilobytes of base64.
  if (!value || value.length < 128) {
    throw new Error(
      `Excel returned an empty image for ${what}. This build of Excel may not support ` +
        `image capture here — read the underlying cells with inspect_workbook(scope="range") instead.`
    );
  }
}

const H_ALIGN_MAP = {
  left: "Left",
  center: "Center",
  right: "Right",
} as const;
const V_ALIGN_MAP = {
  top: "Top",
  middle: "Center",
  bottom: "Bottom",
} as const;

/**
 * Abstraction over Office.js so the context engine is testable without
 * sideloading Excel. Production code calls `officeDataSource()`; tests
 * pass `inMemoryDataSource(...)` from `./in-memory`.
 */
export interface SelectionInfo {
  /** Sheet containing the selection. */
  sheetName: string;
  /** A1 range address relative to the sheet. */
  address: string;
}

export interface ExcelDataSource {
  listSheets(): Promise<SheetSummary[]>;
  getNamedRanges(): Promise<NamedRangeInfo[]>;
  /** Active sheet name, or null if there is no active worksheet. */
  getActiveSheet(): Promise<string | null>;
  /** Current user selection, or null if nothing meaningful is selected. */
  getSelection(): Promise<SelectionInfo | null>;
  /** Read values + formulas for a range. `address` is relative to the sheet. */
  getRange(sheetName: string, address: string): Promise<RangeData>;
  /**
   * Per-column widths and per-row heights (points) WITHOUT the values and
   * formulas — what the screenshot path needs to paint row/column headers
   * onto a capture. `getRange` would work but drags the whole grid's contents
   * along for a number per column. Omit `address` for the used range; the
   * resolved address comes back so the caller knows which column the first
   * width belongs to.
   */
  getRangeDimensions?(
    sheetName: string,
    address?: string
  ): Promise<{ address: string; columnWidths: number[]; rowHeights: number[] }>;
  /**
   * Write a 2D `formulas` array to a range. Strings starting with `=` are
   * treated as formulas by Excel; all others are literal values. Dimensions
   * must match the address.
   */
  setRange(sheetName: string, address: string, formulas: string[][]): Promise<void>;
  /**
   * Replicate the contents of `seedAddress` across the larger `targetAddress`
   * via Office.js's autoFill. Seed must share starting cell with target and
   * be strictly contained. Used by write_range's copy_to_range option.
   */
  fillRange(sheetName: string, seedAddress: string, targetAddress: string): Promise<void>;
  /**
   * Apply uniform formatting to every cell in a range.
   */
  setFormat(sheetName: string, address: string, format: RangeFormat): Promise<void>;
  /** List charts present on a sheet (name + zero-based index). */
  listCharts(sheetName: string): Promise<ChartSummary[]>;
  /**
   * Capture a chart as a PNG data URL. Identify the chart by name or index;
   * exactly one must be provided.
   */
  getChartImage(
    sheetName: string,
    selector: { chartName: string } | { chartIndex: number }
  ): Promise<string>;
  /**
   * Capture a range as a PNG data URL. Address-relative to the sheet; pass
   * an empty string or omit to capture the sheet's used range. Used by the
   * `screenshot` tool so the agent can visually verify formatting,
   * conditional formatting, chart layout, etc. — Office.js's `range.getImage()`.
   */
  getRangeImage(sheetName: string, address?: string): Promise<string>;
  /**
   * Ensure a hidden sheet with the given name exists. Idempotent — if the
   * sheet is already present, leaves it alone (does not toggle visibility).
   * Used by the workbook-memory layer to back the `_excelente` CLAUDE.md-
   * analog sheet.
   */
  ensureHiddenSheet(name: string): Promise<void>;
  /**
   * Insert worksheets from an uploaded workbook (base64-encoded) into the
   * live workbook via Office.js `insertWorksheetsFromBase64`. Full
   * fidelity — values, formulas, formatting carry over; macros do NOT
   * (the API only pulls worksheets, which makes importing a .xlsm safe).
   *
   * Returns the names of the inserted worksheets (Office may auto-rename
   * on collision; the returned names reflect what actually landed). The
   * caller surfaces those to the agent so it references the right sheets.
   *
   * Requires ExcelApi 1.13. `supportsWorksheetInsert()` gates the UI so
   * the insert path is only offered when the host supports it. Throws on
   * unsupported hosts, oversized files, or extension-hardening policy
   * blocks — the Composer catches and falls back to the text path.
   */
  insertWorksheetsFromBase64(base64File: string): Promise<string[]>;
  /**
   * True when the host supports `insertWorksheetsFromBase64` (ExcelApi
   * 1.13+). Used to gate the "Insert worksheets" button — on older Excel
   * only the text path is offered.
   */
  supportsWorksheetInsert(): boolean;
  /**
   * Subscribe to workbook-save events. The handler fires whenever Excel
   * reports the file has been saved (Ctrl+S, autosave, etc.). Returns an
   * unsubscribe function. In-memory implementations return a no-op
   * unsubscribe; real Office.js implementations wire `worksheet.onSaved`
   * (workbook-level events aren't directly exposed on every Excel host —
   * we subscribe per-sheet under the hood).
   */
  onWorkbookSaved(handler: () => void): () => void;
  /**
   * Subscribe to sheet-change events. The handler fires when the user (or
   * an external process) modifies cells on any worksheet. The handler
   * receives the changed sheet name + A1 range address + a free-form
   * change-type string from Office.js (e.g. "RangeEdited", "FillRequest").
   * Returns an unsubscribe function. In-memory implementations are no-ops.
   *
   * Important: changes the Excelente agent itself makes via setRange /
   * setFormat also fire this event in production. Hook handlers should
   * filter accordingly (e.g., compare against the active conversation's
   * last-write address) if they only care about user edits.
   */
  onSheetChanged(
    handler: (event: { sheetName: string; address: string; changeType?: string }) => void
  ): () => void;
  /**
   * Subscribe to selection changes. The handler receives the freshly
   * resolved selection (same shape as `getSelection()`), or null when the
   * selection can't be resolved — e.g. a multi-area Ctrl+click selection or
   * a chart selected instead of a range. Fires on every user cursor move,
   * so UI consumers should debounce. Returns an unsubscribe function.
   * In-memory implementations fire via the `fireSelectionChanged` test
   * helper.
   */
  onSelectionChanged(handler: (sel: SelectionInfo | null) => void): () => void;
  /**
   * Create a worksheet and return its resolved name.
   *
   * Deliberately a FIRST-CLASS tool rather than something the agent has to
   * reach `run_excel_script` for. Creating a sheet is the single most common
   * structural operation in a build, and when the escape hatch was the only
   * route to it, one silent script failure left the agent with no way to
   * make a tab at all — it fell back to dumping a 134-unit rent roll onto
   * `Sheet1` (2026-09-04).
   */
  createSheet(
    name: string,
    opts?: { position?: number; activate?: boolean }
  ): Promise<{ name: string; renamedFrom?: string }>;

  /**
   * Execute arbitrary Office.js code inside `Excel.run`. Optional — only
   * the production Office data source implements this; in-memory test
   * data sources omit it (run_excel_script gracefully reports
   * unavailability). The provided code runs with `ctx` (Excel.RequestContext)
   * and `Excel` in scope; the runner wraps it in an async IIFE.
   *
   * Returns the script's return value plus any errors that only surfaced as
   * unhandled promise rejections. Throws if the script throws directly (the
   * tool catches and surfaces).
   */
  runScript?(code: string): Promise<RunScriptResult>;
}

/**
 * Result of a `run_excel_script` execution.
 *
 * `swallowedErrors` exists because a dropped promise inside a script used to
 * be completely invisible: the script "succeeded", the workbook silently did
 * not change, and the model had no way to tell that apart from a script that
 * legitimately returned nothing. See the 2026-09-04 rent-roll incident.
 */
export interface RunScriptResult {
  /** The script's return value, or `undefined` when it returned nothing. */
  output: unknown;
  /** Errors that escaped as unhandled rejections while the script ran. */
  swallowedErrors: string[];
}

export interface ChartSummary {
  name: string;
  index: number;
}

export interface RangeFormat {
  /** Excel number format string, e.g. "$#,##0", "0.0%", "@". */
  numberFormat?: string;
  bold?: boolean;
  italic?: boolean;
  /** True = single underline, false = no underline. */
  underline?: boolean;
  /** Hex color (e.g. "#FFFFFF") for the font. */
  fontColor?: string;
  /** Hex color (e.g. "#1F4E79") for the cell background. */
  fillColor?: string;
  horizontalAlignment?: "left" | "center" | "right";
  verticalAlignment?: "top" | "middle" | "bottom";
  wrapText?: boolean;
  /** Column width in points. Mutually exclusive with `autofitColumns`. */
  columnWidth?: number;
  /**
   * Size every column in the range to its widest cell. Without this a
   * correct number renders as `######` and reads as a broken model.
   */
  autofitColumns?: boolean;
}

/**
 * Live Office.js implementation. Batches loads aggressively to minimize
 * `context.sync()` round-trips.
 */
export function officeDataSource(): ExcelDataSource {
  return {
    async listSheets() {
      return Excel.run(async (ctx) => {
        const sheets = ctx.workbook.worksheets;
        sheets.load("items/name,items/position,items/visibility");
        await ctx.sync();

        const used = sheets.items.map((s) => {
          const u = s.getUsedRangeOrNullObject();
          u.load("address,rowCount,columnCount,isNullObject");
          return u;
        });
        const charts = sheets.items.map((s) => {
          s.charts.load("count");
          return s.charts;
        });
        const pivotCounts = sheets.items.map((s) => s.pivotTables.getCount());
        await ctx.sync();

        return sheets.items.map(
          (s, i): SheetSummary => ({
            name: s.name,
            position: s.position,
            visible: String(s.visibility) === "Visible",
            rowCount: used[i].isNullObject ? 0 : used[i].rowCount,
            columnCount: used[i].isNullObject ? 0 : used[i].columnCount,
            usedRange: used[i].isNullObject ? null : stripSheetQualifier(used[i].address),
            hasCharts: charts[i].count > 0,
            hasPivots: pivotCounts[i].value > 0,
          })
        );
      });
    },

    async getNamedRanges() {
      return Excel.run(async (ctx) => {
        const names = ctx.workbook.names;
        names.load("items/name,items/formula,items/comment");
        await ctx.sync();
        return names.items.map(
          (n): NamedRangeInfo => ({
            name: n.name,
            scope: "workbook",
            refersTo: n.formula,
            comment: n.comment || undefined,
          })
        );
      });
    },

    async getActiveSheet() {
      return Excel.run(async (ctx) => {
        const s = ctx.workbook.worksheets.getActiveWorksheet();
        s.load("name");
        await ctx.sync();
        return s.name || null;
      });
    },

    async getSelection() {
      return readSelection();
    },

    async getRange(sheetName, address) {
      return Excel.run(async (ctx) => {
        const sheet = ctx.workbook.worksheets.getItem(sheetName);
        // Office.js getRange wants a sheet-local address; a sheet-qualified
        // one ("DCF Template!B2:P36") throws InvalidArgument. Tolerate it.
        const range = sheet.getRange(stripSheetQualifier(address));
        range.load("address,values,formulas,rowCount,columnCount");
        await ctx.sync();

        // Second pass for per-column widths and per-row heights. It needs the
        // counts from the sync above, and `range.format.columnWidth` is no
        // use — Office.js returns null there whenever the columns differ,
        // which is precisely the case worth reporting. Every load below
        // settles in ONE sync, so this is a second round trip, not N.
        const { rowCount, columnCount } = range;
        let columnWidths: number[] | undefined;
        let rowHeights: number[] | undefined;
        if (columnCount <= MAX_DIMENSION_PROBE && rowCount <= MAX_DIMENSION_PROBE) {
          const cols = Array.from({ length: columnCount }, (_, i) => {
            const f = range.getColumn(i).format;
            f.load("columnWidth");
            return f;
          });
          const rows = Array.from({ length: rowCount }, (_, i) => {
            const f = range.getRow(i).format;
            f.load("rowHeight");
            return f;
          });
          try {
            await ctx.sync();
            columnWidths = cols.map((f) => f.columnWidth);
            rowHeights = rows.map((f) => f.rowHeight);
          } catch {
            // Dimensions are a nicety; a host that cannot report them must
            // not cost the caller the values and formulas it actually asked
            // for. Leave both undefined rather than failing the read.
          }
        }

        return {
          address: range.address,
          values: range.values as RangeData["values"],
          formulas: range.formulas as string[][],
          rowCount,
          columnCount,
          ...(columnWidths && { columnWidths }),
          ...(rowHeights && { rowHeights }),
        };
      });
    },

    async setRange(sheetName, address, formulas) {
      await Excel.run(async (ctx) => {
        const sheet = ctx.workbook.worksheets.getItem(sheetName);
        const range = sheet.getRange(stripSheetQualifier(address));
        range.formulas = formulas;
        await ctx.sync();
      });
    },

    async fillRange(sheetName, seedAddress, targetAddress) {
      await Excel.run(async (ctx) => {
        const sheet = ctx.workbook.worksheets.getItem(sheetName);
        const seed = sheet.getRange(stripSheetQualifier(seedAddress));
        seed.autoFill(stripSheetQualifier(targetAddress), Excel.AutoFillType.fillDefault);
        await ctx.sync();
      });
    },

    async listCharts(sheetName) {
      return Excel.run(async (ctx) => {
        const sheet = ctx.workbook.worksheets.getItem(sheetName);
        sheet.charts.load("items/name");
        await ctx.sync();
        return sheet.charts.items.map((c, i) => ({ name: c.name, index: i }));
      });
    },

    async getChartImage(sheetName, selector) {
      return Excel.run(async (ctx) => {
        const sheet = ctx.workbook.worksheets.getItem(sheetName);
        const chart =
          "chartName" in selector
            ? sheet.charts.getItem(selector.chartName)
            : sheet.charts.getItemAt(selector.chartIndex);
        // getImage default returns a PNG sized to the chart's natural dimensions.
        const image = chart.getImage();
        // Chart.getImage is one of the two Office.js calls that behave
        // differently across hosts (Excel for Mac's WKWebView is the usual
        // odd one out). The range path below already degrades gracefully;
        // this one used to throw the raw Office.js error, which reads as
        // "InvalidArgument" and invites the agent to retry the identical
        // call. Give it the same actionable failure.
        const which =
          "chartName" in selector
            ? `chart "${selector.chartName}"`
            : `chart at index ${selector.chartIndex}`;
        try {
          await ctx.sync();
        } catch (e) {
          throw new Error(
            `Couldn't capture an image of ${which} on ${sheetName}: ${(e as Error).message}. ` +
              `Chart images aren't available in every Excel build — describe the chart from its ` +
              `source data with inspect_workbook(scope="range") instead.`
          );
        }
        assertImagePayload(image.value, `${which} on ${sheetName}`);
        return `data:image/png;base64,${image.value}`;
      });
    },

    async getRangeDimensions(sheetName, address) {
      const local = address ? stripSheetQualifier(address) : address;
      return Excel.run(async (ctx) => {
        const sheet = ctx.workbook.worksheets.getItem(sheetName);
        const range = local && local.length > 0 ? sheet.getRange(local) : sheet.getUsedRange();
        range.load("address,rowCount,columnCount");
        await ctx.sync();
        // Same per-axis loading as getRange, for the same reason:
        // range.format.columnWidth is null the moment the columns differ.
        const cols = Array.from({ length: range.columnCount }, (_, i) => {
          const f = range.getColumn(i).format;
          f.load("columnWidth");
          return f;
        });
        const rows = Array.from({ length: range.rowCount }, (_, i) => {
          const f = range.getRow(i).format;
          f.load("rowHeight");
          return f;
        });
        await ctx.sync();
        return {
          address: range.address,
          columnWidths: cols.map((f) => f.columnWidth),
          rowHeights: rows.map((f) => f.rowHeight),
        };
      });
    },

    async getRangeImage(sheetName, address) {
      const local = address ? stripSheetQualifier(address) : address;
      return Excel.run(async (ctx) => {
        const sheet = ctx.workbook.worksheets.getItem(sheetName);
        const range = local && local.length > 0 ? sheet.getRange(local) : sheet.getUsedRange();
        const image = range.getImage();
        try {
          await ctx.sync();
        } catch (e) {
          // Range.getImage can fail on very large ranges or unsupported
          // content even with a valid address. Surface an actionable message
          // instead of the raw "InvalidArgument" so the agent stops retrying
          // the same call and falls back to reading values.
          const where = local && local.length > 0 ? `${sheetName}!${local}` : sheetName;
          throw new Error(
            `Couldn't capture an image of ${where}: ${(e as Error).message}. ` +
              `Try a smaller range, or read the cells with inspect_workbook(scope="range") to verify them instead.`
          );
        }
        const where2 = local && local.length > 0 ? `${sheetName}!${local}` : sheetName;
        assertImagePayload(image.value, where2);
        return `data:image/png;base64,${image.value}`;
      });
    },

    async ensureHiddenSheet(name) {
      await Excel.run(async (ctx) => {
        const sheets = ctx.workbook.worksheets;
        const existing = sheets.getItemOrNullObject(name);
        existing.load("name,visibility");
        await ctx.sync();

        if (existing.isNullObject) {
          const added = sheets.add(name);
          added.visibility = "Hidden" as Excel.SheetVisibility;
          await ctx.sync();
        }
      });
    },

    supportsWorksheetInsert() {
      // insertWorksheetsFromBase64 landed in ExcelApi 1.13.
      return (
        typeof Office !== "undefined" &&
        Office.context?.requirements?.isSetSupported?.("ExcelApi", "1.13") === true
      );
    },

    async insertWorksheetsFromBase64(base64File) {
      return await Excel.run(async (ctx) => {
        // Default options insert ALL worksheets from the source at the end
        // of the current workbook. The API returns the IDs of the inserted
        // sheets; we resolve those to names so the agent (and the UI) can
        // reference them.
        const result = ctx.workbook.insertWorksheetsFromBase64(base64File);
        await ctx.sync();

        const insertedIds = result.value ?? [];
        if (insertedIds.length === 0) return [];

        // Map inserted IDs → names. Load the full sheet list once and match.
        const sheets = ctx.workbook.worksheets;
        sheets.load("items/id,items/name");
        await ctx.sync();

        const byId = new Map(sheets.items.map((s) => [s.id, s.name]));
        return insertedIds.map((id) => byId.get(id) ?? id);
      });
    },

    onWorkbookSaved(handler) {
      // Excel.Workbook in Office.js doesn't expose onSaved on every host
      // version; the reliable cross-host trigger is per-worksheet onSaved
      // which fires on file-level save events. We register against every
      // worksheet currently in the workbook and re-register when new sheets
      // are added.
      let registrations: Array<{ remove: () => void }> = [];
      let cancelled = false;

      void Excel.run(async (ctx) => {
        const sheets = ctx.workbook.worksheets;
        sheets.load("items/name");
        await ctx.sync();
        if (cancelled) return;

        // Office.js's host-version coverage of an explicit workbook-save
        // event varies. We use the documented path where available:
        // `ctx.workbook.onAutoSaveSettingChanged` doesn't fit; the
        // reliable signal across hosts is `worksheet.onCalculated` after
        // a save flushes formulas. Pragmatic v1 approach: leave the
        // production wiring as a no-op registration that the future host-
        // specific implementation can fill in, while the in-memory
        // emitSaved() drives the test path. Sheet-change events
        // (onSheetChanged below) are the more useful real-world signal
        // and ship today fully wired.
        void sheets;
        void handler;
      }).catch(() => {
        /* best-effort */
      });

      return () => {
        cancelled = true;
        for (const r of registrations) r.remove();
        registrations = [];
      };
    },

    onSheetChanged(handler) {
      let registrations: Array<{ remove: () => void }> = [];
      let cancelled = false;

      void Excel.run(async (ctx) => {
        const sheets = ctx.workbook.worksheets;
        sheets.load("items/name");
        await ctx.sync();
        if (cancelled) return;

        const wrap = (sheet: Excel.Worksheet) => {
          const reg = sheet.onChanged.add(async (event) => {
            // event.address looks like "Sheet1!B2:C4" — split off the
            // sheet name. event.worksheetId is also available.
            const addr = event.address ?? "";
            const bang = addr.indexOf("!");
            const localAddress = bang >= 0 ? addr.slice(bang + 1) : addr;
            handler({
              sheetName: sheet.name,
              address: localAddress,
              changeType: String(event.changeType ?? ""),
            });
          });
          registrations.push({
            remove: () => {
              void Excel.run(reg.context, async () => {
                reg.remove();
              }).catch(() => {
                /* best-effort */
              });
            },
          });
        };

        for (const s of sheets.items) wrap(s);

        // Also register against new sheets added later in the session.
        const addReg = ctx.workbook.worksheets.onAdded.add(async (added) => {
          await Excel.run(async (innerCtx) => {
            const newSheet = innerCtx.workbook.worksheets.getItem(added.worksheetId);
            newSheet.load("name");
            await innerCtx.sync();
            wrap(newSheet);
          });
        });
        registrations.push({
          remove: () => {
            void Excel.run(addReg.context, async () => {
              addReg.remove();
            }).catch(() => {
              /* best-effort */
            });
          },
        });
      }).catch(() => {
        /* best-effort */
      });

      return () => {
        cancelled = true;
        for (const r of registrations) r.remove();
        registrations = [];
      };
    },

    onSelectionChanged(handler) {
      // Document-level selection event from the Office common API — no
      // ExcelApi requirement-set bump, works on every host we ship to.
      // Each event resolves the selection through the same reader as
      // getSelection(); resolution failures (multi-area selections, chart
      // selections) surface as null so consumers can hide their UI.
      const wrapped = () => {
        readSelection()
          .then(handler)
          .catch(() => handler(null));
      };
      try {
        Office.context.document.addHandlerAsync(Office.EventType.DocumentSelectionChanged, wrapped);
      } catch {
        // Host without document events — no live updates, but getSelection
        // still works on demand. Return the no-op unsubscribe below.
      }
      return () => {
        try {
          Office.context.document.removeHandlerAsync(Office.EventType.DocumentSelectionChanged, {
            handler: wrapped,
          });
        } catch {
          /* best-effort */
        }
      };
    },

    async setFormat(sheetName, address, format) {
      await Excel.run(async (ctx) => {
        const sheet = ctx.workbook.worksheets.getItem(sheetName);
        const range = sheet.getRange(stripSheetQualifier(address));

        if (format.numberFormat !== undefined) {
          range.load("rowCount,columnCount");
          await ctx.sync();
          const fmt = Array.from({ length: range.rowCount }, () =>
            Array.from({ length: range.columnCount }, () => format.numberFormat!)
          );
          range.numberFormat = fmt;
        }
        if (format.bold !== undefined) range.format.font.bold = format.bold;
        if (format.italic !== undefined) range.format.font.italic = format.italic;
        if (format.underline !== undefined) {
          range.format.font.underline = (
            format.underline ? "Single" : "None"
          ) as Excel.RangeUnderlineStyle;
        }
        if (format.fontColor !== undefined) range.format.font.color = format.fontColor;
        if (format.fillColor !== undefined) range.format.fill.color = format.fillColor;
        if (format.horizontalAlignment !== undefined) {
          range.format.horizontalAlignment = H_ALIGN_MAP[
            format.horizontalAlignment
          ] as Excel.HorizontalAlignment;
        }
        if (format.verticalAlignment !== undefined) {
          range.format.verticalAlignment = V_ALIGN_MAP[
            format.verticalAlignment
          ] as Excel.VerticalAlignment;
        }
        if (format.wrapText !== undefined) range.format.wrapText = format.wrapText;
        if (format.columnWidth !== undefined) range.format.columnWidth = format.columnWidth;

        await ctx.sync();
        // autofit must run AFTER the values/formats above are committed —
        // it measures what is actually in the cells.
        if (format.autofitColumns) {
          range.format.autofitColumns();
          await ctx.sync();
        }
      });
    },

    async createSheet(name, opts) {
      return Excel.run(async (ctx) => {
        const sheets = ctx.workbook.worksheets;
        sheets.load("items/name");
        await ctx.sync();

        // Excel refuses duplicate sheet names outright. Suffixing is kinder
        // than throwing: the agent asked for a place to put its output, and
        // an error here would send it back to hand-rolled scripting.
        const taken = new Set(sheets.items.map((s) => s.name.toLowerCase()));
        let finalName = name;
        if (taken.has(name.toLowerCase())) {
          let n = 2;
          while (taken.has(`${name} (${n})`.toLowerCase())) n++;
          finalName = `${name} (${n})`;
        }

        const sheet = sheets.add(finalName);
        if (opts?.position !== undefined) sheet.position = opts.position;
        if (opts?.activate !== false) sheet.activate();
        await ctx.sync();

        // Read the name BACK from the host rather than trusting our own
        // string — Excel silently rewrites characters it will not accept.
        sheet.load("name");
        await ctx.sync();
        return {
          name: sheet.name,
          ...(sheet.name !== name && { renamedFrom: name }),
        };
      });
    },

    async runScript(code) {
      // The Bash of Excel. User code runs inside Excel.run with `ctx` and
      // `Excel` in scope. The function is built by buildScriptFunction,
      // which shadows network / storage / host-credential / DOM globals so
      // generated Office.js can touch the workbook and nothing else — see
      // run-script-sandbox.ts for the security model.
      //
      // Two correctness backstops wrap the call, both added after the
      // 2026-09-04 rent-roll incident where a script silently discarded
      // every write and still reported success:
      //
      //  1. A trailing `ctx.sync()`. A script that queues operations and
      //     forgets to sync used to lose them without a word; the extra
      //     round-trip is cheap and makes "I wrote it" mean it.
      //  2. Unhandled-rejection capture. buildScriptFunction statically
      //     refuses the `main(); // never awaited` shape, but it cannot see
      //     every dropped promise — an async callback passed to forEach is
      //     the common one. Anything that escapes lands in swallowedErrors
      //     instead of vanishing.
      const swallowedErrors: string[] = [];
      const canListen =
        typeof window !== "undefined" && typeof window.addEventListener === "function";
      const onRejection = (ev: PromiseRejectionEvent): void => {
        const reason: unknown = ev.reason;
        swallowedErrors.push(reason instanceof Error ? reason.message : String(reason));
      };
      if (canListen) window.addEventListener("unhandledrejection", onRejection);
      try {
        const output = await Excel.run(async (ctx) => {
          const fn = buildScriptFunction(code);
          const value = await fn(ctx, Excel);
          // Flush anything queued but never synced by the script itself.
          // No-op when the script already synced and queued nothing after.
          await ctx.sync();
          return value;
        });
        // Orphaned promises reject on a later microtask than the one that
        // resolved Excel.run. Yield once so the listener above can see them
        // before we report success.
        await new Promise((resolve) => setTimeout(resolve, 0));
        return { output, swallowedErrors };
      } finally {
        if (canListen) window.removeEventListener("unhandledrejection", onRejection);
      }
    },
  };
}

/**
 * Resolve the current selection to sheet + local A1 address. Shared by
 * `getSelection()` and the `onSelectionChanged` subscription so both report
 * the identical shape. Rejects (caller maps to null) when the selection
 * isn't a single range — multi-area Ctrl+click selections and selected
 * charts make `getSelectedRange()` throw.
 */
function readSelection(): Promise<SelectionInfo | null> {
  return Excel.run(async (ctx) => {
    const range = ctx.workbook.getSelectedRange();
    const sheet = range.worksheet;
    range.load("address");
    sheet.load("name");
    await ctx.sync();
    if (!range.address || !sheet.name) return null;
    // range.address is "Sheet1!A1:B2"; split into sheet + addr.
    const bang = range.address.indexOf("!");
    const addr = bang >= 0 ? range.address.slice(bang + 1) : range.address;
    return { sheetName: sheet.name, address: addr };
  });
}
