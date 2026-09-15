---
title: Quickstart
description: Run one real task end to end, from prompt to approved write to verified build.
group: First steps
order: 3
---

This walks a single task so you see the whole loop once: what the agent reads, what it asks
permission for, and how it checks its own work.

You need Excelente [installed](/documentation/install/) with a
[model connected](/documentation/connect-a-model/). Any workbook will do.

## 1. Open the pane and ask for something

Click **excelente** on the Home tab. In the Chat tab, type:

```text
Build a five-year cash flow on a new sheet. Year 1 NOI of $1,200,000,
3% annual growth, and a 10% capital reserve deducted each year.
```

Press Enter.

## 2. Watch it read before it writes

The first lines in the transcript are read-only tool calls, marked with a `·`:

```text
· inspect_workbook    Workbook outline
· get_selection       Sheet1!A1
```

Read tools run silently because they cannot change anything. The agent is building a picture of what
already exists so it does not overwrite your work or duplicate a sheet you already have. See
[What the agent can see](/documentation/workbook-context/).

On a build of more than a step or two, the next thing you see is a **Tasks** card. That is the
agent's own checklist, and its last item is always verification.

## 3. Approve the writes

When the agent is ready to change something, everything stops and an approval card appears:

> **`create_sheet`** wants to modify the workbook.

Then, once the sheet exists:

> **`write_range`** wants to modify the workbook.
> `Cash Flow!A1:F14 — 84 cells`

**Show full input** expands the exact JSON being written, so you can read the formulas before they
land. Three buttons:

- **Approve** runs this one call.
- **Deny** refuses it and tells the agent why it got nothing, so it can adapt.
- **Approve all** stops asking for the rest of this conversation.

Tables get written in chunks of ten rows or fewer, so a large build produces several prompts.
**Approve all** is the answer once you trust what it is doing. It resets when the conversation does.

## 4. Read the change cards

Each completed write collapses into a change card:

> **Wrote values / formulas**

Hover it for the range. The most recent card carries an undo icon. Click it and the range goes back
to exactly what it held before, formulas included.

## 5. Let it verify

Before summarizing, the agent screenshots what it built and looks at the result, then spawns a
**Reviewer** sub-agent to critique it independently. The Reviewer reads the workbook and reports
back on correctness, concerns, and suggestions with cell citations.

If the Reviewer finds real problems, the agent fixes them and reviews again before it says anything
to you. What reaches you is the final state plus the verdict. See
[Sub-agents and verification](/documentation/subagents/).

## 6. Undo if you want it gone

Three ways, all equivalent:

- The undo arrow in the composer toolbar.
- The undo icon on the most recent change card.
- Typing `/undo`.

Only the newest un-reverted write reverts in place. Older cards read **superseded**, and you get
back to them by reverting the newer ones first. See [Approvals and undo](/documentation/approvals-and-undo/).

## Try Plan mode next

Ask for something larger, then click **Plan** in the composer toolbar before you send it. The agent
investigates read-only and hands back a numbered plan instead of building. You read it, then click
**Promote to Work** to execute or **Request review** to have a sub-agent critique the plan first.

Plan mode earns its keep on anything touching a model you already rely on, because the agent shows
you what it intends to change before a single cell moves.

## Where to go from here

- [How the agent works](/documentation/how-it-works/) for what is happening between your prompt and the result.
- [Skills overview](/documentation/skills/) to give the agent a playbook for CRE work.
- [Slash commands](/documentation/slash-commands/) for the shortcuts.
