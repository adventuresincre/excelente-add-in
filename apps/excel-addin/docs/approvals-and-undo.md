---
title: Approvals and undo
description: Every change to your workbook stops for your approval, and every approved change can be reverted.
group: Core concepts
order: 4
---

Excelente has exactly two permission levels. Read tools run silently. Write tools stop and ask.

## Why only two levels

Other agent harnesses use a gradient, from safe reads up to a "dangerous, are you sure" tier. Excel
does not need one. Every workbook mutation Excelente can make goes onto an undo stack with the same
recovery path, so there is no category of write that deserves a scarier prompt than the others.

Each tool declares its level in its definition. There is no tool that quietly skips the gate.

| Write tools, which prompt | Read tools, which run silently |
|---|---|
| `write_range` | `inspect_workbook`, `get_selection`, `find_cells` |
| `format_range` | `trace_dependencies`, `screenshot` |
| `create_sheet` | `submit_plan`, `update_plan_step`, `enter_plan_mode`, `todo_write` |
| `run_excel_script` | `find_skill`, `load_skill`, `read_skill_resource`, `propose_skill` |
| `write_workbook_memory`, `write_workbook_settings` | `read_workbook_memory`, `read_workbook_settings` |
| `undo` | `spawn_subagent`, `ask_user_question` |

Connector tools are classified from what the MCP server declares. A tool that says it is read-only
and not destructive gets Read. Everything else gets Write and routes through the approval card. See
[Connectors overview](/documentation/connectors/).

## The approval card

When a write is proposed, the run stops and a card appears:

> **`write_range`** wants to modify the workbook.
> `Marigold Flats!B4:G28 — 150 cells`

**Show full input** expands the exact JSON, including every formula. Read it when the write touches
something you care about.

Three buttons:

| Button | Effect |
|---|---|
| **Approve** | Runs this call |
| **Deny** | Refuses it. The agent is told it got nothing and adapts |
| **Approve all** | Stops asking for the remainder of this conversation |

Focus lands on the card itself rather than on a button, so a stray Enter cannot approve a write you
have not read.

## Approve all

Once you trust what a build is doing, **Approve all** removes the friction. A ten-sheet model
otherwise produces a lot of prompts, because tables are written ten rows at a time.

It is deliberately narrow:

- It covers this conversation only, and resets when the conversation does.
- A pill stays visible while it is on, with a **Turn off** button.
- It cannot be set by anything except you, in the pane. A workbook cannot turn it on.

That last point matters. Per-workbook settings ride inside the `.xlsx` file, so a shared template
could otherwise arrive with approvals silently disabled for everyone who opened it. The setting that
reads those overrides drops `autoApproveWrites` on the floor.

## Undo

Every approved write goes on an undo stack that holds the prior contents of the range, formulas
included. Reverting restores exactly what was there.

Three ways to trigger it:

- The undo arrow in the composer toolbar.
- The undo icon on a change card.
- Typing `/undo`.

You get a notice either way:

> ↶ **Reverted** — Wrote values / formulas
>
> ℹ **Nothing to undo** — No agent writes are on the undo stack for this conversation.

## Why only the newest write reverts

The undo icon appears on the most recent un-reverted change card. Earlier cards read **superseded**.

A write records the cells it replaced. If a later write touched some of the same cells, restoring the
earlier snapshot would resurrect stale values on top of newer ones and leave your workbook in a state
that never existed. Reverting newest-first is the only order that reconstructs real prior states, so
to reach an older write, revert the ones after it first.

## Change cards

Completed writes collapse into a labelled card:

| Tool | Card |
|---|---|
| `write_range` | Wrote values / formulas |
| `format_range` | Applied formatting |
| `write_workbook_memory` | Updated workbook memory |
| `undo` | Restored prior contents |

Hovering shows the range and dimensions. After reverting, the card is badged **reverted**. If the
revert fails, it is badged **failed** with the error.

## Excel's own undo

Excel's Ctrl+Z does not reliably reverse an add-in write, because Office.js changes do not always
enter the host undo stack. Use Excelente's undo for anything the agent did. Save before a large
build if you want a file-level fallback.
