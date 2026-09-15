---
title: Slash commands
description: Eight built-in commands, plus every installed skill, from the same menu.
group: Working in Excel
order: 2
---

Type `/` in the composer to open the command menu. Arrow keys navigate, Enter picks. Matching runs
against both the command name and its description, so `/mode` finds Plan and Work.

## The commands

| Command | What it does |
|---|---|
| `/plan` | Switch to Plan mode. The agent proposes a numbered plan and stops for review |
| `/work` | Switch to Work mode. The agent executes immediately. This is the default |
| `/undo` | Revert the most recent agent write to its prior contents |
| `/init` | Bootstrap this workbook's memory from an Explore sub-agent's analysis |
| `/skillify` | Ask the agent to propose a new skill from a recent workflow |
| `/clear` | Clear the chat history and start a fresh conversation |
| `/help` | Show the command list |
| `/cost` | Show this session's cost so far |

## Notes on the ones that do more than they say

### `/init`

Worth running once per workbook you will come back to. It:

1. Spawns an **Explore** sub-agent to read the workbook outline and each visible sheet, returning
   sheet purposes, a named-range inventory, the modeling conventions it can infer (currency units,
   decimal places, date formats, where hardcodes sit versus formulas), and anything ambiguous enough
   to be worth asking you about.
2. Reads any existing workbook memory, so it merges rather than overwrites.
3. Drafts about 600 words of Markdown under Conventions, Sheet Purposes, Named Ranges, and Notes.
4. Calls `write_workbook_memory`, which stops at the normal approval card.

That approval card is your review step. Read the draft before approving it, because everything in it
shapes how the agent behaves in this workbook from then on. See
[Workbook memory](/documentation/workbook-memory/).

### `/skillify`

Run it after the agent has done something you want repeated. It looks back over the conversation and
proposes a skill capturing the workflow, which arrives as a proposal card with the description,
when-to-use, body, and references laid out. Nothing installs until you click **Install skill**.

### `/clear` versus New chat

`/clear` resets the conversation in place. The **New chat** button saves the current one to History
first, then opens a fresh one. Use New chat when you might want the conversation back.

### `/cost`

Reports the session total in the form the number deserves:

> 💰 **Session cost** — No usage recorded yet this session.
>
> 💰 **Session cost** — $0.42m (sub-millidollar)
>
> 💰 **Session cost** — $0.1234

The same figure lives in the header info popover, along with prompt cache stats and a **Reset session
cost** button. See [Cost and limits](/documentation/cost/).

## Skills in the same menu

Installed skills appear alongside commands in the `/` menu, each tagged with its source (`bundled`
or `user`) and badged **enabled** if it is already on. Picking a skill enables it for the
conversation rather than running anything.

That is the fastest way to load a playbook mid-conversation: type `/rent` and pick
`rent-roll-standardizer` instead of leaving Chat for the Capabilities tab.

## Mode switches confirm themselves

`/plan` and `/work` post a notice so the mode is on the record in the transcript rather than only in
the toolbar:

> 📋 **Switched to Plan mode** — The agent will propose a numbered plan and stop for your review
> before any writes.
>
> ✓ **Switched to Work mode** — The agent will execute directly; writes still require your approval.
