---
title: What the agent can see
description: How Excelente reads your workbook, what reaches the model, and what stays on your machine until asked for.
group: Core concepts
order: 2
---

Excelente does not upload your workbook. It reads what it needs, when it needs it, through Office.js
on your own machine, and sends only those pieces to the model.

## Three levels, loaded lazily

Reading a large workbook into a prompt would blow the context window and cost real money on every
turn. Excelente uses a hierarchy instead:

| Level | Roughly | When it loads |
|---|---|---|
| Workbook outline | 1,000 tokens | Every turn |
| Sheet outline | 5,000 tokens per sheet | When the agent inspects that sheet |
| Range read | Varies | When the agent asks for specific cells |

The workbook outline names the sheets, their used ranges, and enough shape for the agent to decide
where to look. It does not carry cell contents. The agent then drills into the sheets that matter.

This is why the first few lines of any response are read tools. It is orienting before acting.

## What a read returns

`inspect_workbook` and range reads give the agent values, formulas, number formats, and named
ranges. Formulas come back normalized so the agent reasons about the formula rather than the
displayed result, which is what makes auditing possible.

`trace_dependencies` walks precedents and dependents from a cell, so before changing a driver the
agent can find everything downstream of it.

`find_cells` searches values, formulas, and labels across sheets, which is usually cheaper than
reading whole sheets to locate something.

## Screenshots

`screenshot` renders a range as an image. The agent uses it to check its own work, because a
formula that returns the right number into a column that is still formatted as text is a problem you
can see and a formula read cannot.

If your model cannot read images, Excelente routes screenshots to a separate vision model and feeds
the description back as text. That call is billed separately on your key. You will see a warning in
Settings when your primary model is text-only. See [Choosing a model](/documentation/choosing-a-model/).

## Your selection

Select a range of more than one cell and a chip appears above the composer:

> `Sheet1!A1:D20` — *Included with your next message*

The range travels with your next message, so "clean this up" means something specific. Dismiss the
chip with its ✕ and that particular range stays out; select something else and the chip comes back.

A single resting cell never produces a chip. A cursor sitting somewhere is not a statement of intent,
and treating it as one made every message carry noise.

## Hidden sheets and protected ranges

Hidden sheets are read like any other sheet. The agent can see them, which is usually what you want
when auditing a model whose assumptions live on a hidden tab.

Excelente writes through Office.js with the permissions Excel gives the add-in. A protected sheet
rejects the write and the agent gets the error back, then adapts or tells you.

## What leaves your machine

In BYOK mode, the workbook content the agent reads goes directly from Excel to OpenRouter and on to
the model provider you selected. Nothing routes through CRE Edge.

<!-- edition:include workbook-context/hosted-path -->
<!-- /edition:include -->

Full detail is in [Privacy and data handling](/documentation/privacy-and-data/) and the
[privacy policy](/privacy).

## Giving it durable context

Anything the agent should know about this workbook every session belongs in workbook memory rather
than repeated in chat. Run `/init` and it explores the workbook, drafts a summary of conventions,
sheet purposes, and named ranges, and asks to write it to a hidden sheet that travels with the file.
See [Workbook memory](/documentation/workbook-memory/).
