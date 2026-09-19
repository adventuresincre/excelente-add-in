---
title: Sub-agents and verification
description: Four typed helpers the agent delegates to, and why a Reviewer checks every non-trivial build.
group: Core concepts
order: 5
---

The agent can spawn a helper with its own conversation, its own tool allowlist, and its own turn
budget. Only the helper's final summary comes back, so its intermediate work never crowds the main
conversation.

## The four roles

| Role | Permission | What it does |
|---|---|---|
| **Explore** | Read | Locates cells, formulas, named ranges, and labels across the workbook, and returns a tight summary |
| **Audit** | Read | Hunts formula errors, broken references, inconsistencies, and suspicious hardcodes. Returns findings with severity and location |
| **Builder** | Write | Executes one discrete, self-contained write task, such as a sensitivity table or a formatting pass |
| **Reviewer** | Read | Gives a second opinion on a finished section or a draft plan. Returns correct / concerns / suggestions, with cell citations |

Each role has a fixed system prompt and tool list. Read roles get `inspect_workbook`,
`get_selection`, `screenshot`, `trace_dependencies`, `find_skill`, `load_skill`,
`read_skill_resource`, and `read_workbook_memory`. Builder adds `write_range`, `format_range`, and
`create_sheet`.

Builder's writes still surface as ordinary approval cards. Delegation does not bypass the gate.

## Limits

- A sub-agent cannot spawn a sub-agent. The recursion lock is absolute, so a run cannot fan out
  unbounded and spend your balance.
- Six turns by default, twenty at the ceiling.
- No access to your conversation history, only the brief it was given.

## Why the context stays clean

The reason to delegate is context, not speed. An Explore run that reads nine sheets to find one
named range generates a lot of tool output. Doing that inline would push your earlier conversation
toward compaction. Doing it in a sub-agent means the main conversation receives one paragraph.

## Verification

At the end of every non-trivial Work-mode run, before the agent says anything to you:

1. It screenshots each section it touched and reads the images back, looking for blank totals,
   hardcoded numbers where formulas belong, and formatting it missed.
2. It spawns a **Reviewer**, which reads the workbook independently and returns a structured
   critique.
3. If the Reviewer found real problems, the agent fixes them and reviews again. You see the fixed
   state, not the broken one.
4. Ambiguous flags, the ones that need your judgment rather than a fix, are surfaced in the summary.

The Reviewer works from a bundled playbook covering audit-cell checks, error-value scans, convention
compliance, and structural integrity.

This is skipped only for trivial changes. A one-cell edit does not warrant a review cycle.

## Getting a more independent review

By default the Reviewer runs on your primary model, which means a model reviewing its own work.
Under **Settings** → **Advanced** → **Subagent model**, point sub-agents at a different model.

A different lab's model catches things the original missed, because it does not share the reasoning
that produced the error. This is the single highest-value setting in Advanced for anyone running
real work.

<!-- edition:include subagents/hosted-note -->
<!-- /edition:include -->

## Asking for a review yourself

Two ways:

- On a submitted plan, click **Request review** to have the plan critiqued before you promote it.
- Ask in chat. "Have a reviewer check the debt schedule" spawns one.

## Seeing them run

Sub-agents appear in the transcript as a `spawn_subagent` tool line. The role is named in the call.
Expect Explore during `/init` and whenever the agent is hunting for something, and Reviewer at the
end of substantial work.
