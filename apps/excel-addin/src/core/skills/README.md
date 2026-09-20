# core/skills

Open Agent Skills loader. Discovers skills, parses frontmatter, and supports progressive disclosure so the agent reads `skill.md` first and pulls reference files on demand.

## Skill format

Each skill is a folder containing `skill.md` with YAML frontmatter:

```yaml
---
name: direct-cap-valuation
description: Value a stabilized property by Direct Capitalization
when-to-use: User asks to value a property using direct cap, NOI / cap rate, or A.CRE Course 1 style
version: 1.0.0
author: A.CRE
---
```

Body text + reference files (`references/*.md`, example workbooks, etc.) follow.

## Sources

1. **Bundled** — packaged in `apps/excel-addin/skills/` (plus the edition's own folder), ships with the add-in
2. **User** — created in chat or installed from a zip; persisted in IndexedDB

## Activation

- **Auto**: orchestrator matches `description` / `when-to-use` against the user message
- **Manual**: user picks from the skills drawer in the UI

## Public interface (planned, lands in Phase 4)

```ts
export interface SkillsRegistry {
  list(): SkillManifest[];
  load(skillName: string): Promise<Skill>;       // reads skill.md
  loadReference(skillName: string, ref: string): Promise<string>;  // lazy reference fetch
  matchAuto(userMessage: string): SkillManifest[];
}
```

## Security

Remote skills could exfiltrate workbook data. Mitigation:

- Per-skill tool allowlist (declared in frontmatter, enforced at activation)
- Signed manifests in the registry
- "Trust this skill" prompt on first activation

## Dependencies

- `core/storage` for installed-skills index
- `core/agent` consumes the matched skills

## Lands in

Phase 4 — Open Agent Skills.
