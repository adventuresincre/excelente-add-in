---
name: office-js-patterns
description: Patterns and footguns for writing run_excel_script code. The Office.js mental model + the six non-negotiable rules + when NOT to script.
when-to-use: Load before writing any run_excel_script. Common triggers — user asks to create a chart, apply conditional formatting, insert/delete rows or columns, create or delete sheets, freeze panes, set calculation mode, anything multi-sheet structural.
version: 1.1.0
author: Excelente
---

# Office.js for run_excel_script

`run_excel_script` executes JavaScript inside `Excel.run(async (ctx) => { ... })`. Your code receives `ctx: Excel.RequestContext` and `Excel` in scope.

## The six rules

1. **AWAIT EVERYTHING. Your code is already inside an async function — write it at the top level and `await` directly.** `Excel.run` releases the request context the instant your code returns, so a promise you never awaited is still suspended at that point and every operation it queued is **DISCARDED**. Nothing throws; the tool reports success; the workbook does not change. This is the single most destructive mistake available to you here.

   ```js
   async function main() { /* … */ await ctx.sync(); }
   main();          // ← REFUSED before the script runs, and rightly so
   ```

   `forEach(async …)` is the same trap wearing a different hat — the callback's promise is dropped on the floor. Use `for…of` whenever the body awaits. Bare unawaited calls to a locally-declared async function are now refused up front, and any rejection that still escapes is reported as a failure rather than swallowed.

2. **Load → sync → use.** `range.load("values")` + `await ctx.sync()` BEFORE reading. Without sync: `PropertyNotLoaded`, undefined, or silent garbage.
3. **Collections need `"items/<prop>"` + sync, THEN index.** `sheet.tables.load("items/name")`; sync; THEN `tables.items[0]`. Without the load+sync, `items[0]` is undefined and calling `.load()` on it throws.
4. **`.formulas` ≠ `.values`.** Writing `"=SUM(A1:A10)"` to `.values` stores the literal text. Use `.formulas` for "=" strings.
5. **Suspend calc mode for multi-formula writes.** Set to `manual`, do all writes, restore. Without this, Excel recalculates after every sync against a partial model — phantom errors, hangs. See `references/calculation-mode.md` for the template.
6. **Read back and verify, and `return` the proof.** After non-trivial writes, scan for `#VALUE!`, `#REF!`, `#NAME?`, `#DIV/0!`, `#N/A` — then `return` a read-back value, a row count, or the sheet name. A script that returns nothing tells you only that it did not throw; the tool will warn you when that happens, and `ok: true` with `output: null` is NOT evidence the workbook changed. See `references/cre-audit-cells.md` for the audit-cells that should land in every model.

## Patterns to prefer

- **Fill via autoFill, not 2D arrays.** Seed one cell with a relative formula, then `range.autoFill(targetA1, Excel.AutoFillType.fillDefault)`. One call ≈ 5,000 cells, edit-survivable. (`write_range`'s `copy_to_range` does this for you when you don't need the full Office.js batch.)
- **Structured table refs over fixed ranges.** `Sales[Amount]` auto-expands when rows are added; `$A$2:$A$1000` silently misses new rows.
- **Anchor with `$` deliberately.** `$A$1` full-lock, `$A1` column-lock, `A$1` row-lock. Drag/autoFill behavior depends entirely on this.
- **Group rows, don't hide them.** `range.getEntireRow().group(Excel.GroupOption.byRows)` shows a +/- toggle the user can expand. Hidden rows are invisible and confusing.
- **Pull dimension labels into header cells and reference them.** One seed formula referencing `E$1` + autoFill across is better than 12 hand-edited formulas with `"Jan"`, `"Feb"`, etc. baked in.

## Footguns specific to CRE models

`references/waterfall-footguns.md` covers these in detail:

- Promote applied to gross cash flow instead of net distributable
- Catch-up bucket fed by pref / return-of-capital instead of next-dollar-above-pref
- IRR hurdle measured at project level vs LP level
- Off-by-one in compounded pref accrual (before vs after distribution)
- Stale references after revisions (loan sizing pointing at old total cost)

These all PASS "no error values" — pure structural mistakes. Audit cells (see `references/cre-audit-cells.md`) catch them.

## What's NOT available via Office.js

`references/office-js-not-available.md` for the workarounds. The short list:

- **VBA / macros** — can't create or run. Propose live-formula equivalents.
- **`=TABLE()` array data tables** — build sensitivities as a grid of direct formulas.
- **Trace precedents / dependents API** — parse formulas yourself if needed.
- **Cross-workbook references** — stay within the active workbook.

## When NOT to use run_excel_script

Use the specialized tools when they fit:

- **Reading data** → `inspect_workbook` (outline / range / csv).
- **Writing values or formulas to a known range** → `write_range` (use `copy_to_range` for pattern fills).
- **Formatting cells** → `format_range`.
- **Visual verification** → `screenshot` (ranges by default, charts via chartName/chartIndex).
- **Creating a worksheet** → `create_sheet`. A first-class tool now; do not script it.
- **Column widths / stopping `######`** → `format_range` with `autofitColumns: true`.
- **Asking the user a question** → `ask_user_question`.

Drop to `run_excel_script` for: charts, conditional formatting, sheet deletion/reordering, row/column inserts/deletes, freeze panes, grouping, calc mode, anything multi-call in one Excel.run batch — and for **sweeping many existing rows into a clean table**, which is the one job scripts do far better than any other tool (see `excel-native-method`).

## A.CRE modeling conventions

Load the `cre-modeling-conventions` skill alongside this one when working on CRE content. Color codes (blue inputs / black formulas / green cross-sheet links), number formats (`$#,##0;($#,##0);-`), and "build to be edited" discipline.
