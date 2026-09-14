# License and attribution for bundled skills

**The contents of this directory are not licensed under the Apache License 2.0**
that covers the rest of this repository. Skills are methodology content rather
than program code, and they carry their own terms. See the root
[NOTICE](../../../NOTICE).

Every skill shipped here is listed below. If something is not listed, treat it
as All Rights Reserved and ask before redistributing it.

## A.CRE skills, licensed CC BY 4.0

Copyright 2025-2026 CRE Edge, LLC / Adventures in CRE.

Licensed under the [Creative Commons Attribution 4.0 International License](https://creativecommons.org/licenses/by/4.0/).

You may use, adapt, and redistribute these, commercially included, and inside a
fork of Excelente. You need to credit Adventures in CRE, link the license, and
say whether you changed anything. Your attribution must not suggest that A.CRE
endorses you or your fork. See [TRADEMARKS.md](../../../TRADEMARKS.md).

| Skill | Author |
|---|---|
| `cre-modeling-conventions` | Spencer Burton (A.CRE) |
| `excel-native-method` | Excelente |
| `formula-audit` | A.CRE |
| `office-js-patterns` | Excelente |
| `verify-model-outputs` | Excelente |

A line like this is plenty:

> Includes CRE modeling skills by Adventures in CRE
> (https://www.adventuresincre.com), licensed CC BY 4.0.

## CRE Agents methodology skills, not distributed here

The hosted build of Excelente ships nine more skills that encode commercial real
estate methodology belonging to **CRE Agents, Inc.** (<https://creagents.com>),
the "Vic" task and skill library:

`acquisition-model`, `comp-analysis`, `development-pro-forma`, `loan-sizing`,
`quick-underwrite`, `rent-roll-standardizer`, `revenue-tie-out`,
`sensitivity-analysis`, `t12-analyzer`

CRE Edge, LLC uses that content under written permission from CRE Agents, Inc.
The permission covers use inside the Excelente add-in. It does not cover
redistribution, so those skills are **not in this repository** and nothing here
licenses them to you.

A build from this repository ships five skills rather than fourteen. The loader
globs whatever is present, so nothing breaks and no code change is needed. If you
want the CRE methodology skills, use the hosted add-in at
[excelente.aiedge.ac](https://excelente.aiedge.ac) or talk to CRE Agents, Inc.
directly.

## Writing your own

Skills are Markdown with YAML frontmatter, the same shape as Open Agent Skills.
The five here are worth reading as examples, and
[cre-modeling-conventions](cre-modeling-conventions/SKILL.md) is the one to start
with because it shows the level of specificity that actually changes model
behavior.

Frontmatter fields the loader reads:

```yaml
---
name: my-skill
description: One line. This is what the agent sees when deciding whether to load you.
when-to-use: The concrete triggers. Be specific about the situation, not the topic.
version: 1.0.0
author: Your name
---
```

The body loads only when the agent decides the skill is relevant, so you can be
thorough without paying for it on every turn. Put the decision-relevant summary
in `description` and `when-to-use`, and the real content in the body.

## Historical attribution

Between 2026-06-13 and 2026-09-05, nine bundled skills were adapted from the
**CRE Skills Plugin** by Mario Urquia
(<https://github.com/mariourquia/cre-skills-plugin>), Apache License 2.0, source
revision `7d825f30cbe2fb5d40f079a3d84d4186856f3a87` (2026-06-09).

All nine were replaced on 2026-09-05. No skill in this repository contains CRE
Skills Plugin material. The notice below is retained because earlier distributed
releases carried the adapted skills and Apache-2.0 Section 4(d) obligations
attach to those releases.

```
CRE Skills Plugin
Copyright 2026 Mario Urquia (https://mariourquia.com)

This product includes orchestration patterns and pipeline architecture
derived from the CRE Acquisition Orchestrator by Avi Hacker
(https://github.com/ahacker-1/cre-acquisition-orchestrator),
licensed under the Apache License 2.0.

Original CRE Acquisition Orchestrator:
Copyright 2026 Avi Hacker (https://www.theaiconsultingnetwork.com)
```

The full Apache License 2.0 text is at the repository root in
[LICENSE](../../../LICENSE).
