# core/context

Workbook context engine. The moat.

A real CRE model can have 50k+ formulas — we cannot dump everything into an LLM context window. This module exposes the workbook at multiple resolution levels so the agent can load only what it needs.

## Phase 2 status

| Phase | Status | Resolution level |
|---|---|---|
| 2.1 | ✅ shipped | Workbook outline (~1k tokens, always loadable) |
| 2.2 | ✅ shipped | Sheet outline + formula clustering (~5k tokens per sheet, on demand) |
| 2.3 | ✅ shipped | Chunked exact range read |
| 2.4 | ✅ shipped | Formula dependency tracing (precedents / dependents) |

## Architecture: ExcelDataSource

Every Excel read goes through `ExcelDataSource`, an abstraction over Office.js:

```ts
interface ExcelDataSource {
  listSheets(): Promise<SheetSummary[]>;
  getNamedRanges(): Promise<NamedRangeInfo[]>;
  getActiveSheet(): Promise<string | null>;
  getRange(sheetName: string, address: string): Promise<RangeData>;
}
```

Two implementations:

- **`officeDataSource()`** — wraps `Excel.run(...)`. Batches loads aggressively (e.g., `listSheets` does 2 `context.sync()` calls regardless of sheet count).
- **`inMemoryDataSource(workbook)`** — drop-in for tests. Pass synthetic cells keyed by A1 address; behaves like a real workbook.

This is the only place in the codebase that calls Office.js for context reads. The agent loop, tools, and UI all go through this interface.

## Workbook outline

```ts
import { getWorkbookOutline, renderWorkbookOutline } from "./core/context";

const outline = await getWorkbookOutline(officeDataSource());
const text = renderWorkbookOutline(outline);
// text is ~1k tokens regardless of workbook size
```

Output is intentionally compact — sheet names, **used-range address** with dimensions (`Sheet1 — B2:I8 (7×8)`), named ranges, and "has charts / pivots" flags. Always cheap enough to load.

`SheetSummary.usedRange` is the anchor for every cell walk in this module. The counts are the used range's own extent, not an extent from A1; the sheet outline and `trace_dependencies` both read `usedRange` and report absolute addresses (2026-09-10: both assumed A1 and skipped the last column and row of any table that did not start there). The sheet outline renders `Used range: B2:I8 — …` and tags labels with their column letter or row number (`B:"Unit Type" | C:"Units"`).

`describeClipping(ds, sheet, address)` (`clipping.ts`) is the range read's safety net: when a requested range ends inside the used range and the cell just past a short edge is populated, it returns one sentence naming it (`Data continues to the right in column I: I3 = "Monthly Revenue"`). `inspect_workbook` attaches it as `note`. Silent when the read covers the block.

## Dependency tracing

```ts
import { tracePrecedents, traceDependents, renderDependencyTrace } from "./core/context";

const result = await traceDependents(ds, { sheetName: "Model", address: "B5" }, { depth: 1 });
const text = renderDependencyTrace(result); // compact, model-ready
```

The agent-facing equivalent of Excel's Trace Precedents / Trace Dependents
(`dependencies.ts`, exposed as the `trace_dependencies` tool):

- **precedents** — parse the target's formulas and resolve what they read.
- **dependents** — scan every formula in scope and report the cells that read
  the target: direct refs, containing ranges (`SUM(B2:B20)` catches `B5`),
  cross-sheet refs, whole-column/row refs, and named ranges.

Resolution is a pure function of the formula text plus the host sheet (A1
coordinates are absolute regardless of `$`), so the workbook scan caches per
unique formula string. Dependent cells are grouped into normalized-formula
clusters (same compression as the sheet outline), so a filled-down column
reports as one entry. `depth` 2–3 follows the chain transitively.

Not traceable (flagged in the result instead of silently missed):
INDIRECT/OFFSET, table structured references, external-workbook links.

## Address utilities

```ts
import { parseA1, parseRange, formatA1, columnLetterToIndex, columnIndexToLetter } from "./core/context";
```

A1-style address parsing with absolute-marker stripping (`$A$1` → `{col: 0, row: 0}`), reversed-corner normalization, and column-letter conversion up to multi-letter columns.

## Tests

- `address.test.ts` — column letter conversion, A1 parsing, range parsing, round-trips
- `outline.test.ts` — outline computation against the in-memory data source, rendering, compactness with many sheets
- `sheet-outline.test.ts` — formula clustering, labels, samples
- `range-read.test.ts` — chunked reads, stripe merging
- `formula-norm.test.ts` — R1C1-relative normalization
- `dependencies.test.ts` — reference extraction edge cases, precedents/dependents semantics, rendering

All tests use `inMemoryDataSource` — no Office.js required at test time.
