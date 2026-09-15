---
title: Skills overview
description: Markdown playbooks that teach the agent how you want a job done, loaded only when relevant.
group: Skills
order: 1
---

A skill is a Markdown file that gives the agent step-by-step guidance for a specific kind of work.
Excelente ships eleven, you can write your own, and the agent can propose one from work you have
already done together.

Skills follow the Open Agent Skills format, so a skill written for Excelente is readable by other
agent harnesses that support it.

## Why they exist

A general model asked to "underwrite this deal" makes reasonable choices that are not your choices.
It picks a cap rate convention, decides whether to net reserves above or below NOI, and formats a
schedule its own way. A skill fixes those decisions once, so the agent arrives already knowing how
your shop does it.

Skills carry method. Workbook memory carries facts about one file. See
[Workbook memory](/documentation/workbook-memory/).

## Progressive disclosure

A skill has a body and optional reference files. Only short summaries of your installed skills reach
the system prompt. The agent loads a skill's body when the work calls for it, and pulls individual
reference files after that if it needs them.

That layering is what makes a large skill library affordable. Twenty installed skills cost roughly
twenty short descriptions per turn, not twenty full playbooks.

`load_skill` and `read_skill_resource` results are exempt from compaction, so a loaded skill survives
a long build.

## Turning skills on

Three ways, all equivalent:

- **Capabilities** → **Skills**, and tick the checkbox.
- The **+** button in the composer, under Skills.
- Type `/` and pick the skill by name, which enables it for the conversation.

The `/` route is the fastest mid-conversation. Type `/rent`, pick `rent-roll-standardizer`, carry on.

## How the agent finds one itself

The agent has a `find_skill` tool and will reach for a skill you have enabled without being told.
Matching is weighted: a skill's **when-to-use** counts three times as much as its description, and
its description twice as much as its name.

This is why a good `when-to-use` matters more than a good name. Write it as the situations a reader
would recognize, not as a restatement of the title. See
[Write your own skill](/documentation/writing-skills/).

## Core skills you never see

Three bundled skills are hidden from the Skills panel, the `+` menu, and the `/` menu. The agent
reaches them on its own:

| Skill | Role |
|---|---|
| `cre-modeling-conventions` | A.CRE house style: layout, color coding, number formats, formula discipline. Injected **in full into every system prompt**, so it shapes every build whether or not you asked |
| `office-js-patterns` | The mental model and footguns for writing `run_excel_script` code |
| `verify-model-outputs` | The Reviewer sub-agent's playbook for checking a finished build |

If your agent color-codes inputs blue and formulas black without being asked, that is
`cre-modeling-conventions`.

## Inspecting a skill

In the Skills panel, **Show** expands a skill to reveal its description, when-to-use, author,
version, and source, plus a file tree. Click `SKILL.md` or any reference file to read its contents in
the panel.

Worth doing before you trust a skill with real work. A skill is a prompt, and reading it tells you
exactly what the agent has been told.

## Installing your own

**Upload skill (.zip / .skill / .md)** in the Skills panel, or drop a file onto it. Uploaded skills
can be uninstalled with the ✕ on their row. Bundled skills cannot be removed, only switched off.

Details in [Write your own skill](/documentation/writing-skills/).

## What ships

See [Bundled skills](/documentation/bundled-skills/) for the eleven, what each covers, and their
licensing.
