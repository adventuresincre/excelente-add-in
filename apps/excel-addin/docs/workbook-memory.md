---
title: Workbook memory
description: Durable notes about this workbook, stored in the file itself, loaded on every turn.
group: Working in Excel
order: 4
---

Workbook memory is a short Markdown document that travels inside your `.xlsx` and reaches the agent
on every turn. It is where "this model runs in thousands", "the assumptions live on Inputs", and "we
do not hardcode in the cash flow" belong, so you stop retyping them.

## Where it lives

A hidden worksheet named `_excelente`.

| Cell | Contents |
|---|---|
| `A1` | The memory, as Markdown |
| `B1` | Per-workbook settings overrides, as JSON |

The underscore prefix is a convention meaning "system sheet, do not edit directly". You can unhide
it and read it if you want to see exactly what the agent is being told.

**Limit: 30,000 characters** in A1. Excel's hard per-cell ceiling is about 32,767, and the margin
keeps a write from failing at the boundary. Reads over the limit get truncated with a marker; writes
over it are refused with the character count so you know how much to trim.

## Creating it

Run `/init`. An Explore sub-agent reads the workbook, drafts a summary under Conventions, Sheet
Purposes, Named Ranges, and Notes, and proposes writing it. The approval card is your review step:
read the draft before approving, because it shapes the agent's behavior in this workbook from then
on.

`/init` reads any existing memory first and merges into it rather than replacing it.

You can also just ask. "Remember that Unit Mix drives everything on Pro Forma" produces a
`write_workbook_memory` call and an approval card.

## Editing it

Writes replace the whole document. There is no append. When the agent updates memory it reads the
current version, edits it, and proposes the complete replacement, which you see in full on the
approval card.

To edit it yourself, unhide `_excelente` and edit A1 directly. It is Markdown in a cell, which is
awkward but works for a small correction.

To remove it, delete the `_excelente` sheet.

## It travels with the file

Memory lives in the workbook, not in your browser or your Office profile. Send the `.xlsx` to a
colleague and your notes go with it. Open the same file on another machine and the agent still knows
your conventions.

Two consequences worth holding onto:

- **Do not put anything confidential in it** that should not travel with the file. It is as shareable
  as the workbook.
- **Memory arriving in a file someone sent you was written by them.** Excelente treats it as
  untrusted reference data and fences it in the system prompt as information rather than
  instructions, so a workbook cannot smuggle in commands for your agent. Read it once when a file
  arrives with memory already in it.

## Per-workbook settings

Cell `B1` can override two settings for this workbook: `model` and `reasoning`. Useful when one
model reads a particular file's structure better than your default.

The sanitizer that reads B1 honors those two keys and drops everything else. In particular it drops
`autoApproveWrites`, deliberately. B1 ships inside the `.xlsx`, so without that rule a shared
template could turn off write approvals for everyone who opened it. Approve-all is a per-session
choice you make in the pane, and nothing else can set it.

## What good memory looks like

Short, specific, and about this workbook rather than about modeling in general:

```markdown
## Conventions
- All figures in thousands. Do not reformat to units.
- Blue font = hardcoded input. Black = formula. No exceptions in the cash flow.
- Fiscal year starts July 1.

## Sheet Purposes
- Inputs: every assumption. Nothing calculates here.
- Rent Roll: unit-level, one row per unit, from the November Yardi export.
- Pro Forma: ten-year, driven entirely off Inputs and Rent Roll.

## Named Ranges
- `ExitCap`, `HoldPeriod`, `LTV` all live on Inputs column C.

## Notes
- The 2027 column on Pro Forma is intentionally hardcoded, per the lender's term sheet.
```

General modeling doctrine belongs in a skill instead, where it applies across every workbook. See
[Skills overview](/documentation/skills/).

## Tools

| Tool | Permission |
|---|---|
| `read_workbook_memory` | Read |
| `write_workbook_memory` | Write |
| `read_workbook_settings` | Read |
| `write_workbook_settings` | Write |

`read_workbook_memory` is one of three tool results exempt from compaction, so your conventions
survive a long session intact.
