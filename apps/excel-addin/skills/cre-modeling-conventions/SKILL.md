---
name: cre-modeling-conventions
description: A.CRE house-style modeling conventions — layout, color coding, number formats, formula discipline. Load when building or revising any CRE financial model.
when-to-use: User asks to build / revise an acquisition model, development proforma, DCF, waterfall, debt schedule, sensitivity table, or any other CRE deliverable.
version: 1.2.2
author: Spencer Burton (A.CRE)
---

# CRE modeling conventions (A.CRE house style)

## How work gets done here

You are operating a workbook that is open in front of someone — not writing a
report about one. Four rules are never optional; `excel-native-method` has the
full method and the worked patterns.

1. **Move rows with a script, not through your context.** Read two or three
   representative blocks to learn a source's shape, then write ONE
   `run_excel_script` that sweeps it into a clean table. Transcribing existing
   rows into your reasoning to write them back does not scale past a few dozen.
2. **Bind columns before you write formulas.** Write the header row, read it
   back, and map each field to its real column letter — or use a table and
   `Table[Field]`. Authoring A1 references against a layout you are holding in
   your head is the most common way a build ships silently wrong.
3. **Let Excel compute.** Formulas over hand arithmetic, always: `DATE(...)` not
   a converted serial, `SUMIFS` not a mental total. A number the user cannot
   trace is a defect even when it is right.
4. **Verify by reading, never by assuming.** A successful write is not a correct
   one. Scan for `#VALUE!`/`#REF!`/`#DIV/0!`/`#NAME?`/`#N/A`, sanity-check
   magnitudes, and `screenshot` the block. Build on your own tab via
   `create_sheet` — never on the user's source sheet.

## If a template already exists, match it

If you're working on an existing workbook, its conventions WIN. Match its color palette, number formats, column widths, sheet layout, and formula style. The rules below apply only when building from scratch or extending a workbook that has no clear convention.

## Layout

Two empty rails frame the model so the eye and Ctrl+Arrow both have a clean stop:

- **Column A**: empty, width 20 points. A gutter, not a column — it gives the eye and Ctrl+Arrow a stop; nothing goes in it. Set it with `format_range` (`address: "A1", columnWidth: 20`), not a script; if you must script it, the settable property is `range.format.columnWidth` — assigning `range.columnWidth` does nothing and reports success.
- **Row 1**: empty, height 14.4.
- **All other used columns**: call `format_range` with `autofitColumns: true` after writing, across the WHOLE block — label columns and header rows included, not just the numeric ones. A clipped text label is as wrong as a `######` number and easier to miss: text spills into an empty neighbour and only truncates once the next cell is occupied, so the first label you write looks fine and breaks later.
- No frozen panes, no merged cells in the model body.

## Headers

Two-tier visual hierarchy. Backgrounds — not just bold — carry the structure:

- **Section headers** (Assumptions, Sources & Uses, Operating Cash Flow, Returns, etc.): solid fill `#1F3864` (dark navy), white bold 11pt, spans the section's columns. One per logical block.
- **Sub-headers** (period labels, column headers inside a section): fill `#D9E1F2` (light navy tint), dark bold text, single thin bottom border between the header row and the first data row.
- Skip one empty row between sections.

## Font-color convention

The single most important formatting discipline. Color-code every cell by purpose:

| Color  | Meaning |
|--------|---------|
| **Blue**   | **Required input.** The user OWNS this cell — review, change, justify. A blue cell may hold a hard-coded value OR a formula; either way it's an input. |
| **Black**  | **Calculation or output.** A formula derived from inputs. Don't modify unless you're intentionally overriding (then recolor red). |
| **Green**  | **Link to output from another worksheet.** Used to distinguish cross-sheet links from in-sheet calculations. |
| **Red**    | **Override of a black or green cell.** When you intentionally alter a calculation cell, recolor it red so the next reviewer immediately sees the deviation from the template's base methodology. |
| **Orange** | **Optional input.** Probably right but worth a second look. |

## Number formatting

- **Years**: format as text strings (`"2024"`, not `"2,024"`).
- **Currency**: `$#,##0` format. ALWAYS specify units in the header (`"Revenue ($mm)"`).
- **Zeros**: number format makes zero render as `-`, including for percentages. Example: `$#,##0;($#,##0);-`.
- **Percentages**: default to `0.0%` (one decimal).
- **Multiples**: `0.0x` for valuation multiples (EV/EBITDA, P/E, equity multiple).
- **Negatives**: parentheses `(123)`, never minus `-123`.

## Formula construction

### Assumptions placement

- ALL assumptions (growth rates, margins, multiples) go in separate, labeled assumption cells.
- Use cell references in formulas, never hardcoded values.
- Example: `=B5*(1+$B$6)` — NOT `=B5*1.05`.
