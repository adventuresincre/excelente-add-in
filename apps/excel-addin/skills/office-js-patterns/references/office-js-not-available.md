# What's not available via Office.js

Things you can't do, no matter how the user asks. Surface the limitation; propose an alternative.

## VBA / macros

**Limitation:** Office.js can't create, edit, or run VBA macros. Task-pane add-ins can't write `.bas` modules or trigger them programmatically.

**Workaround:** If the user wants a "button that does X" — build the logic as live formulas instead. The "button" goes away; the calculation runs automatically when inputs change. If the user truly needs a manual trigger (a "Refresh" button), tell them plainly that VBA isn't accessible and offer to design the calc so it doesn't need a refresh step.

## Native `=TABLE()` array data tables

**Limitation:** Excel's two-variable what-if data table (the `=TABLE(row_input, col_input)` array formula) can't be set programmatically via Office.js.

**Workaround:** Build the sensitivity grid as direct formulas, one formula per output cell. For a 7×7 cap-rate × rent-growth sensitivity:

```js
// Pseudocode — actual implementation via write_range + copy_to_range
// Seed cell C5: =NPV(disc, CF1, CF2, ...) with cap rate from B5, growth from C4
// Then autoFill across the 7×7 grid; each cell references the row/column input
```

The result behaves identically to a native data table for the user — values update when inputs change. The only difference is it's a grid of formulas rather than a single array formula, which is actually MORE readable when auditing.

## Trace precedents / dependents API

**Limitation:** Excel's native dependency graph (the precedents / dependents lookup) isn't exposed in Office.js. You can read a cell's formula and parse it to find references, but the API doesn't give you "what depends on this cell?" directly.

**Workaround:** For dependency analysis (formula audit, broken-link detection), parse formulas yourself. Look for cell references using a regex like `/([A-Z][a-zA-Z0-9_]*!)?\$?[A-Z]+\$?\d+/g`. Build a graph by scanning the relevant ranges. Slower than the native UI but workable for small audit scopes.

For finding what depends on a cell, you have to scan all formulas in the workbook and look for references to the target. Cap the scope — full-workbook scans are expensive.

## Cross-workbook references

**Limitation:** Most add-in surfaces (including Excel Online and Mac) don't reliably support cross-workbook references at runtime. The classic `[Workbook2.xlsx]Sheet1!A1` pattern breaks when files move and is host-version-dependent.

**Workaround:** Stay within the active workbook. If the user needs data from another file, pull it in (paste, import, or via an MCP-connected data source) before referencing.

## Per-point chart formatting

**Limitation:** Office.js can create charts and set most chart-level properties, but per-point custom data labels, secondary-axis quirks, and waterfall chart styling are hit-or-miss through the API.

**Workaround:** Set what's settable; surface the remaining work to the user. "I've created the chart and configured the series; for the custom data labels per point, click [chart] → Format Data Labels and …" This is honest and faster than wrestling with API edge cases.

## Direct image insertion from URL

**Limitation:** Inserting an image into a sheet from a URL (without round-tripping through code execution to fetch + base64 it first) doesn't have a clean API.

**Workaround:** Either fetch the image yourself (data URI), then `sheet.shapes.addImage(...)` with the base64 payload. Or tell the user to paste the image manually.
