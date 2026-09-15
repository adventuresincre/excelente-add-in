---
title: Plan mode and Work mode
description: Have the agent propose a numbered plan before it touches anything, or let it execute directly.
group: Core concepts
order: 3
---

The composer toolbar carries a two-position toggle. **Work** is the default and executes. **Plan** is
read-only and ends in a proposal you approve.

## Work mode

The agent executes until every step is done or blocked, without pausing between steps. Writes still
require your approval, so "autonomous" means it does not stop to ask what to do next, not that it
changes your workbook unattended.

A multi-step build in Work mode has a shape you can recognize:

1. `todo_write` lays out a checklist, whose last item is always verification.
2. Read tools orient in the workbook.
3. Writes go out in chunks of ten rows or fewer, each through an approval card.
4. Screenshots of every section touched, read back by the agent.
5. A Reviewer sub-agent critiques the result.
6. A summary covering what was built, where it lives, the Reviewer's verdict, and anything worth
   sanity-checking yourself.

Steps 4 and 5 are skipped only for trivial changes, a single cell or a formatting pass.

## Plan mode

Session permission drops to Read. Write tools are refused before they reach your workbook, and the
agent is told why so it adapts instead of failing.

It investigates, then calls `submit_plan` once with numbered, concrete, imperative steps, and stops.

For anything that modifies existing work, the plan traces dependents first. Every range the change
touches gets its own step, or an explicit note saying why it is unaffected. That trace is most of
the value: it surfaces the downstream cell you forgot about while the plan is still text.

Switch with the **Plan** button or by typing `/plan`. Excelente confirms:

> 📋 **Switched to Plan mode** — The agent will propose a numbered plan and stop for your review
> before any writes.

## Reading a plan

A submitted plan appears as a pill in the transcript and stays pinned above the scroll, so progress
is visible during a long run:

> 📋 Plan · 3/7 · Step 3: Build the pro forma

Click it to open the plan over the transcript. Nothing unmounts, so closing it puts you back where
you were.

The plan view shows a progress bar and the numbered steps, each with a status:

| Status | Meaning |
|---|---|
| Pending | Not started |
| In progress | Currently executing |
| Done | Complete |
| Blocked | Stopped, with the blocker written out |

## Promoting a plan

Before any step starts, two buttons:

- **Promote to Work →** switches to Work mode and asks the agent to execute the plan.
- **Request review** spawns a Reviewer sub-agent to critique the plan before you commit to it.

Requesting a review costs one sub-agent run and catches plans that are internally consistent but
wrong about your workbook. Worth it on anything touching a model you rely on.

You are not obliged to promote. Editing the request and asking for a revised plan is normal.

## When to use which

Reach for Plan mode when:

- The work touches a model already in use.
- You want the dependency trace before anything moves.
- The request is ambiguous and you would rather argue about a plan than about a result.
- You are learning what the agent will do with a prompt like yours.

Work mode is right for new sheets, scratch analysis, data cleanup, and anything where undo is a
sufficient safety net.

## The agent can switch too

The agent has an `enter_plan_mode` tool and will use it mid-run when it finds the task is larger or
more entangled than the prompt implied. That is the agent stopping to show you the shape of the
problem before spending your money on the wrong build.
