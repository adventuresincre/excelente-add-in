---
name: excel-native-method
description: How analytical work actually gets done inside a live Excel workbook — data flow, tool choice, formula authoring, build order, and verification. The method layer that sits under every CRE skill.
when-to-use: Load before any multi-step build that reads existing workbook data, lays out a table, or writes formulas. Mandatory when a task involves moving more than ~30 rows that already exist in the workbook, or writing formulas that reference a table you are creating in the same run.
version: 1.0.0
author: Excelente
---

# Working in a live workbook

You are not writing a report about a spreadsheet. You are operating a spreadsheet
that is open in front of a person. That changes the method, not just the output
format.

## Rule 1 — the workbook is the workspace, not your context

Bulk data that already exists in the workbook must never round-trip through your
reasoning. Read the workbook to learn its **shape**; use a script to move its
**rows**.

**What going wrong looks like** (a real run, 2026-09-04): a 134-unit rent roll.
The agent read 550 rows through `inspect_workbook`, transcribed every unit into
its own reasoning as prose, hand-summed each unit's charge codes, hand-converted
lease dates from serial numbers, then wrote it all back a few rows at a time. It
burned its entire budget and the run died mid-repair with the deliverable broken.

**The method**: read two or three representative blocks to learn the structure.
Then write ONE script that sweeps the source range and writes the clean table.
The data goes sheet → sheet and never enters the conversation.

```js
// Sweep a repeating-block export into a flat table, in one pass.
const src = ctx.workbook.worksheets.getItem("Avenue 19");
const used = src.getUsedRange();
used.load("values, rowCount");
await ctx.sync();

const rows = [];
for (const r of used.values) {
  if (!isUnitHeader(r)) continue;      // your shape rule, learned by inspecting
  rows.push([r[0], r[2], r[5], /* … */]);
}

const out = ctx.workbook.worksheets.getItem("Rent Roll");
out.getRangeByIndexes(2, 0, rows.length, rows[0].length).values = rows;
await ctx.sync();
return { unitsWritten: rows.length };   // ← proof, not a hope
```

Threshold: more than ~30 existing rows to move ⇒ script. Fewer, or data you are
generating rather than moving ⇒ `write_range` is fine.

## Rule 2 — let Excel do the arithmetic

If you find yourself computing a number in your reasoning that a formula could
compute, stop and write the formula instead. It is cheaper, it is auditable, and
it stays correct when an input changes.

- **Dates**: `=DATE(2025,3,31)`, `=EOMONTH(…)`, `=EDATE(…)`. Never convert a
  serial by hand — "45658 is Jan 1 2025, so 45747 is…" is how off-by-one dates
  reach a deliverable.
- **Aggregates**: `SUMIFS` / `COUNTIFS` / `AVERAGEIFS` over the clean table.
- **Anything summed across a category**: a formula, so the user can see it.

A hard-coded number the user cannot trace is a defect even when it is right.

## Rule 3 — never author formulas against a layout you hold in your head

This is the highest-frequency cause of broken deliverables, and it fails
silently: the write succeeds, the numbers are wrong.

**Do this instead:**

1. `create_sheet`, then write the header row **first, in its own call**.
2. Read the headers back with `inspect_workbook` and bind each field name to its
   **actual** column letter.
3. Only then author formulas, using the bound letters.

Better still, make the reference self-describing so a shifted column cannot
break it:

- Convert the block to a real table and use `Table[Rent]`.
- Or define named ranges for the columns your summary block references.

**The failure signature to recognize in your own work:** in that same run, `Type`
landed in column B while every summary formula referenced column C — which held
square footage. Each `COUNTIF` dutifully returned `0`. Separately, the metric
labels sat one row above their values, so `=Q4/Q3` divided a number by a header
and occupancy rendered as `10800%`. The deliverable shipped with 26 `#VALUE!`
cells. Nothing errored at write time; the model simply could not see the sheet it
was describing.

## Rule 4 — build in an order that survives being wrong

1. `create_sheet` — your own tab. Never build on the sheet holding the user's
   source data, and never fall back to `Sheet1` because something else failed.
2. Headers.
3. **Read the headers back. Bind columns.**
4. Data — one `write_range` per table. `address` is only the ANCHOR cell, so a
   200-row block is a single call. Do not chunk into tens of small writes.
5. Formulas, referencing bound columns.
6. Formats, finishing every numeric block with `autofitColumns: true`. A correct
   number in a narrow column renders as `######` and reads as a broken model.
7. Verify.

Getting step 3 wrong is recoverable. Getting it wrong *after* step 5 means
rewriting every formula.

## Rule 5 — verification is a read, not a hope

`ok: true` is not evidence that anything happened.

- **After a script**: `return` something that proves the write landed — a
  read-back value, a row count, the sheet name. A script that returns nothing
  tells you only that it did not throw, and the tool will say so.
- **After formulas**: scan the written range for `#VALUE!`, `#REF!`, `#DIV/0!`,
  `#NAME?`, `#N/A` — then sanity-check magnitudes. `10800%` occupancy and a
  `$0` average rent are both arithmetically valid and obviously wrong.
- **After layout**: `screenshot` the block. It is the only way to catch `######`,
  clipped labels, and misaligned sections.
- **Cross-foot**: totals against a count, revenue against a per-unit average.

## Rule 6 — scripts: await everything

Your script body already runs inside an async function. Write it at the top level
and `await` directly.

Never do this:

```js
async function main() { /* … */ await ctx.sync(); }
main();                    // ← refused, and for good reason
```

`Excel.run` releases the request context the moment your code returns. A promise
you did not await is still suspended at that point, so every operation it queued
is **discarded** — silently, while the tool reports success. The same trap applies
to `forEach(async …)`; use `for…of` when the body awaits.

Bare unawaited calls are now refused before the script runs, and escaped
rejections are reported as failures. Do not try to work around either.

## Choosing a tool

| Need | Use |
|---|---|
| Learn workbook structure | `inspect_workbook` (outline → sheet → range) |
| Move many rows already in the workbook | `run_excel_script` |
| Write a table you generated | `write_range` (anchor cell + full grid) |
| Fill one formula down/across | `write_range` with `copy_to_range` |
| A new tab | `create_sheet` — **not** a script |
| Number formats, fills, widths | `format_range` (+ `autofitColumns`) |
| Charts, conditional formatting, freeze panes, calc mode, row/col insert | `run_excel_script` |
| Confirm what the user is looking at | `screenshot` |

See `office-js-patterns` for the Office.js mechanics of writing scripts, and
`references/sweep-pattern.md` here for a worked source-to-clean-table sweep.
