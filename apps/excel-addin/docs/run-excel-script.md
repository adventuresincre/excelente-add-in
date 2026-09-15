---
title: run_excel_script
description: The Office.js escape hatch, what it can and cannot reach, and why VBA is permanently out.
group: Tool reference
order: 2
---

`run_excel_script` executes Office.js code inside `Excel.run()`. It covers everything the specialized
tools do not: charts, conditional formatting, sheet deletion and reordering, row and column inserts,
freeze panes, grouping, calculation mode, and any sequence that belongs in one batch.

It is a **Write** tool, so it stops at an approval card like any other change. **Show full input**
expands the code before it runs, which is worth reading when the script is doing something
structural.

## When the agent should not reach for it

The bundled `office-js-patterns` skill tells the agent to prefer a specialized tool wherever one
fits:

| Job | Tool |
|---|---|
| Reading data | `inspect_workbook` |
| Writing values or formulas to a known range | `write_range` |
| Formatting cells, including column autofit | `format_range` |
| Visual verification | `screenshot` |
| Creating a worksheet | `create_sheet` |
| Asking you a question | `ask_user_question` |

Specialized tools produce better approval cards. `write_range` shows you a range and a cell count.
A script shows you code. When you see a script doing something `write_range` could have done, that is
worth a **Deny** and a nudge.

The one job scripts genuinely do better than anything else is sweeping many existing rows into a
clean table.

## The sandbox

Scripts run with a restricted set of globals. No `fetch`, no network, no filesystem, no access to
Excelente's own internals. The script gets the Excel request context and returns a value.

Two behaviors worth knowing about, because both came from real failures:

**Unawaited work is refused.** `Excel.run` releases the request context the moment your code returns.
A promise nobody awaited is still suspended at that point, and every operation it queued is discarded
silently. Nothing throws, the tool reports success, and the workbook is unchanged. Excelente refuses
bare unawaited calls up front rather than letting that happen.

**Escaped rejections are reported.** An error that escapes as an unhandled promise rejection is
surfaced as a failure with the count and messages, rather than being swallowed into a false success.

## Rules the agent follows

From `office-js-patterns`, which the agent loads before writing a script:

1. **Await everything.** The code is already inside an async function.
2. **Load, sync, then use.** `range.load("values")` and `await ctx.sync()` before reading, or you get
   `PropertyNotLoaded` or silent garbage.
3. **Collections need `"items/<prop>"` and a sync before indexing.**
4. **`.formulas` is not `.values`.** Writing `"=SUM(A1:A10)"` to `.values` stores the literal text.
5. **Suspend calculation for multi-formula writes.** Set manual, write, restore. Otherwise Excel
   recalculates against a half-built model and produces phantom errors or hangs.
6. **Read back and return the proof.** After a non-trivial write, scan for `#VALUE!`, `#REF!`,
   `#NAME?`, `#DIV/0!` and `#N/A`, then return a read-back value or a row count. A script that
   returns nothing proves only that it did not throw, and Excelente warns when that happens.

That sixth rule is why script results in the transcript usually carry a number. It is evidence, not
decoration.

## What Office.js cannot reach

Some of these surprise people coming from VBA.

| Not available | What the agent does instead |
|---|---|
| **VBA and macros** | Proposes live-formula equivalents |
| **`=TABLE()` array data tables** | Builds sensitivities as a grid of direct formulas |
| **Trace precedents and dependents API** | `trace_dependencies` parses formulas directly |
| **Cross-workbook references** | Stays inside the active workbook |

## Why VBA generation is permanently out of scope

Office.js has no API for creating or running VBA. This is a platform boundary, not a gap in
Excelente, and it is not on the roadmap because there is nothing to build against.

It also cuts the other way in your favor. An add-in that cannot write macros cannot write a macro
that does something you did not approve, and the workbooks the agent produces open cleanly in
environments where macros are blocked.

If your workbook already contains VBA, the agent can read the workbook and work alongside the macros.
It cannot edit or invoke them.

## Reviewing a script before approving

For anything structural, expand **Show full input** and look for three things:

1. **Does it target the range you expect?** A wrong sheet name is the most common real error.
2. **Does it delete or overwrite anything?** `delete()`, `clear()`, and a write to a range wider than
   the task needs are worth a second look.
3. **Does it return something?** A script with no return gives you no evidence it worked.

Denying is cheap. The agent is told it got nothing and adapts, usually by narrowing the script or
switching to `write_range`.

## For forks

The sandbox is built in `src/core/tools/excel/run-script.ts`, and the globals it exposes are
deliberately narrow. Widening that list changes what arbitrary model-authored code can reach inside a
user's Excel session, so it warrants a security review rather than a convenience patch.
