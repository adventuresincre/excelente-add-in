---
title: Tool reference
description: Every tool the agent can call, what it does, and whether it stops for your approval.
group: Tool reference
order: 1
---

Twenty-four tools ship with Excelente. Connector tools join this list at runtime. Every tool declares
a permission level, and the registry refuses to load one that does not.

## Reading the workbook

| Tool | Permission | What it does |
|---|---|---|
| `inspect_workbook` | Read | Reads at one of three scopes: a workbook outline of sheet names, dimensions, named ranges, and chart or pivot flags; a sheet outline; or a specific range as values, formulas, or CSV |
| `find_cells` | Read | Searches every cell in the workbook, values and formulas, for text. Case-insensitive substring by default, or a regular expression. The grep of your workbook |
| `get_selection` | Read | Returns what you currently have selected |
| `trace_dependencies` | Read | Trace precedents or dependents workbook-wide. Dependents returns every formula that reads the target, including through containing ranges |
| `screenshot` | Read | Captures a range or a named chart as a PNG so the agent can see what you see |

## Changing the workbook

| Tool | Permission | What it does |
|---|---|---|
| `write_range` | Write | Writes values or formulas to a range. Also fills a pattern across a target range from a seed formula |
| `format_range` | Write | Number formats, fonts, fills, borders, column autofit |
| `create_sheet` | Write | Creates a worksheet and returns its actual name, adding a numbered suffix if the name is taken |
| `run_excel_script` | Write | Runs Office.js code for anything the specialized tools do not cover. See [run_excel_script](/documentation/run-excel-script/) |
| `undo` | Write | Restores the most recent write to its prior contents |

## Planning and tracking

| Tool | Permission | What it does |
|---|---|---|
| `enter_plan_mode` | Read | The agent puts itself into Plan mode mid-run when a task turns out larger than the prompt implied |
| `submit_plan` | Read | Submits a numbered plan for your review. Called once, then the agent stops |
| `update_plan_step` | Read | Marks a step in progress, done, or blocked |
| `todo_write` | Read | Maintains the informal checklist you see as a Tasks card |

## Skills

| Tool | Permission | What it does |
|---|---|---|
| `find_skill` | Read | Searches installed skills, weighting when-to-use over description over name |
| `load_skill` | Read | Loads a skill's body into the conversation |
| `read_skill_resource` | Read | Reads one file from a skill's `references/` folder |
| `propose_skill` | Read | Proposes a new or updated skill, which arrives as a card for you to accept |

`load_skill` and `read_skill_resource` results are exempt from compaction.

## Memory and settings

| Tool | Permission | What it does |
|---|---|---|
| `read_workbook_memory` | Read | Reads the hidden `_excelente` sheet. Exempt from compaction |
| `write_workbook_memory` | Write | Replaces the memory document in full |
| `read_workbook_settings` | Read | Reads per-workbook model and reasoning overrides |
| `write_workbook_settings` | Write | Writes them. Only `model` and `reasoning` are honored |

## Delegation and questions

| Tool | Permission | What it does |
|---|---|---|
| `spawn_subagent` | Read | Spawns an Explore, Audit, Builder, or Reviewer sub-agent. Read permission because spawning is not itself a write; a Builder's writes still prompt |
| `ask_user_question` | Read | Asks you a structured question with options, rendered as a card |

## How permission is enforced

Read tools run silently. Write tools stop at an approval card before touching anything.

There is no third tier. Every workbook change Excelente can make is reversible through the same undo
stack, so no write deserves a scarier prompt than another. The registry rejects any tool declaring
something other than `Read` or `Write`, which is why there is no `DangerFullAccess`.

In Plan mode the session permission drops to Read and write tools are refused before they reach your
workbook, with a structured result the model can adapt to rather than an exception.

See [Approvals and undo](/documentation/approvals-and-undo/).

## Connector tools

Tools bridged from an MCP server are tagged with their source and classified from the annotations the
server declares. Read-only and non-destructive becomes Read. Everything else becomes Write. See
[Connectors overview](/documentation/connectors/).

## Sub-agent tool allowlists

Sub-agents get a subset:

| Role | Tools |
|---|---|
| Explore, Audit, Reviewer | `inspect_workbook`, `get_selection`, `screenshot`, `trace_dependencies`, `find_skill`, `load_skill`, `read_skill_resource`, `read_workbook_memory` |
| Builder | The above plus `write_range`, `format_range`, `create_sheet` |

No sub-agent gets `spawn_subagent`. The recursion lock is absolute.

## Adding a tool to a fork

Tools live in `src/core/tools/`. Each declares a name, description, JSON schema, `requiredPermission`,
and an `execute` function, and registers in `src/core/tools/index.ts`. Excel I/O goes through the
`ExcelDataSource` abstraction rather than raw `Excel.run`, which is what lets tools be tested in node
against an in-memory workbook. See [Architecture](/documentation/architecture/).
