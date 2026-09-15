---
title: Bundled skills
description: The eleven skills that ship with Excelente, what each one covers, and how they are licensed.
group: Skills
order: 2
---

Excelente bundles fourteen skills. Eleven appear in the Skills panel for you to turn on. Three are
core skills the agent reaches on its own.

## The eleven

| Skill | What it covers |
|---|---|
| `acquisition-model` | Stabilized pro forma, direct-cap value, and a dynamic ten-year DCF |
| `comp-analysis` | Rent comps on effective rent, sales comps, and expense benchmarks |
| `development-pro-forma` | Ground-up budget, draw schedule, yield-on-cost, spread, and residual land value |
| `excel-native-method` | How analytical work gets done inside a live workbook: data flow, tool choice, formula authoring, build order, verification |
| `formula-audit` | Trace and explain the formulas in a sheet so you can follow how numbers flow |
| `loan-sizing` | Size permanent debt on LTV, DSCR, and debt yield, and test covenants |
| `quick-underwrite` | Classify the deal, underwrite it on the right basis, pursue or pass |
| `rent-roll-standardizer` | Rent rolls from PM exports or leases, into unit mix, occupancy, and loss-to-lease |
| `revenue-tie-out` | Prove the rent roll explains T-12 revenue, and classify every gap |
| `sensitivity-analysis` | Tornado charts, sensitivity grids, scenarios, and breakevens run through the deal's own model |
| `t12-analyzer` | Map a T-12 to a chart of accounts, annualize, audit, normalize |

`excel-native-method` is the method layer under the CRE skills. It covers how work happens in a live
workbook rather than any particular analysis, and it is worth leaving on whatever else you are doing.

## The three core skills

Hidden from every menu, loaded by the agent itself.

| Skill | Role |
|---|---|
| `cre-modeling-conventions` | A.CRE house modeling conventions. Injected in full into every system prompt |
| `office-js-patterns` | Patterns and footguns for `run_excel_script`, including when not to script |
| `verify-model-outputs` | The Reviewer's playbook: audit-cell checks, error-value scans, convention compliance, structural integrity |

## Suggested combinations

Skills compose. A few that work well together:

| Job | Turn on |
|---|---|
| Underwrite a multifamily acquisition from raw files | `rent-roll-standardizer`, `t12-analyzer`, `revenue-tie-out`, `acquisition-model` |
| Stress an existing model | `sensitivity-analysis`, `formula-audit` |
| Size debt on a completed pro forma | `loan-sizing` |
| Ground-up development | `development-pro-forma`, `sensitivity-analysis` |
| Decide whether a deal is worth real time | `quick-underwrite`, `comp-analysis` |

Turning on everything at once is not free. Each enabled skill adds its summary to every turn, and a
long list makes the agent's choice harder. Enable what the job needs.

## Licensing

Excelente is Apache 2.0, and the bundled skills are licensed separately. This matters if you fork the
project.

Nine of the eleven incorporate commercial real estate methodology from
[CRE Agents, Inc.](https://creagents.com), used with their written permission:

`acquisition-model`, `comp-analysis`, `development-pro-forma`, `loan-sizing`, `quick-underwrite`,
`rent-roll-standardizer`, `revenue-tie-out`, `sensitivity-analysis`, `t12-analyzer`

That content is proprietary to CRE Agents, Inc. The permission covers your use of the add-in and does
not extend to redistribution. Each carries `author: "A.CRE (method: CRE Agents / Vic)"` in its
frontmatter and closes with the permission line.

**Those nine are not in the public repository.** If you clone
[excelente-add-in](https://github.com/adventuresincre/excelente-add-in) you get five skills, all
wholly ours and licensed CC BY 4.0: `cre-modeling-conventions`, `excel-native-method`,
`formula-audit`, `office-js-patterns`, and `verify-model-outputs`. Three of those are core skills, so
a fork's Skills panel shows two rows rather than eleven until you add your own.

This is the one place the hosted add-in and a fork genuinely differ in what they can do out of the
box. Everything else on this site applies to both.

Provenance for all fourteen is in `apps/excel-addin/skills/THIRD_PARTY_LICENSES.md`; the public
repo's `skills/LICENSE.md` covers the five it ships. The scope of the Apache licence is in the
repository's `NOTICE`.

## Reading one before you use it

**Capabilities** → **Skills** → **Show** on any row expands its details and a file tree. Click
`SKILL.md` to read the playbook itself.

Do this once for any skill you are about to point at real work. A skill is a prompt, and reading it
tells you precisely what convention the agent is about to apply to your model.
