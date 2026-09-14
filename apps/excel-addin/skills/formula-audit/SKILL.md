---
name: formula-audit
description: Trace and explain the formulas in a sheet so the user can understand how numbers flow
when-to-use: User asks why a number is wrong, what feeds into a cell, how a calculation works, wants to audit a model, asks "where does this come from", or reports a suspected bug
version: 1.0.0
author: A.CRE
---

# Formula Audit

Read-only by default. Do not modify the workbook unless the user explicitly asks you to fix something — and then propose the change in plain language first.

## When to use this skill

- "Why is the IRR showing X?"
- "What's feeding this total?"
- "I think the model has a bug — can you check?"
- "Walk me through how this number is calculated."
- "Where does the $X.XX come from?"

## Approach

1. **Find the target cell.**
   - If the user said "this cell" or "this number", call `get_selection` first.
   - Otherwise infer from context (sheet name + address they mentioned).

2. **Read the cell and its local context.**
   - `inspect_workbook(scope="range", sheetName, address)` on a small window (e.g., 5 rows × 5 cols around the target) so you see neighbors. Adjacent cells often share a formula pattern.

3. **Understand the pattern.**
   - Call `inspect_workbook(scope="sheet", sheetName)` to see whether this cell is part of a cluster (a drag-fill pattern). If yes, the explanation applies to the whole cluster, not just one cell.

4. **Trace dependencies backward.**
   - Look at the formula. Identify each cell reference.
   - For each referenced cell, call `inspect_workbook(scope="range", ...)` to see its formula or value.
   - Recurse until you hit hard-coded values or the user's stated inputs. Usually 2-4 levels deep is enough.

5. **Report in plain English.**
   - Lead with what the formula DOES (its purpose), not its syntax.
   - List the input cells with their current values.
   - Flag anything unusual (see below).

## What to flag

- **Hard-coded values** where you'd expect a formula. Example: a "Year 5 NOI" cell that's a number instead of `=NOI_Yr4 * (1+growth)`.
- **`#DIV/0!`, `#REF!`, `#VALUE!`, `#N/A`** — explain the likely cause:
  - `#DIV/0!` → division by zero or empty cell
  - `#REF!` → a referenced cell was deleted
  - `#VALUE!` → wrong type (e.g., text in a math operation)
  - `#N/A` → VLOOKUP/MATCH didn't find a match
- **Circular references** — the user might describe one; check by tracing dependencies.
- **Inconsistent formulas** — a cluster of size 1 where you expected a fill, or a hand-edited cell breaking a pattern. The `inspect_workbook(scope="sheet")` clusters will show this (cluster count differs from expected fill length).
- **`OFFSET` / `INDIRECT`** — these make the model brittle and hard to audit. Mention them.
- **External references** — `[Workbook2.xlsx]Sheet1!A1` — these break when files move.

## How to phrase the report

Good:
> Cell `D12` is computing `=B12*C12`. B12 holds the unit count (35), C12 holds the avg rent ($1,650). The result is the monthly rent for that unit type. The $57,750 you're seeing is correct — that's 35 × $1,650.

Better when the chain matters:
> Cell `D12` is computing total monthly rent: `=B12*C12`.
> - **B12 (unit count, 35)** is hard-coded.
> - **C12 (avg rent, $1,650)** is also hard-coded.
>
> The chain stops here — both inputs are direct user entries. If $57,750 looks wrong, check whether B12 or C12 reflects your actual assumptions.

## DO NOT

- Write to the workbook. Audit is read-only.
- Speculate about "industry standards" — work from what's in the cells.
- Auto-fix a perceived bug. Propose the fix in plain language and ask before calling `write_range`.
