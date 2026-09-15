---
title: Write your own skill
description: The SKILL.md format, the frontmatter schema, packaging references, and installing what you build.
group: Skills
order: 3
---

A skill is a Markdown file with YAML frontmatter, optionally packaged with reference files in a zip.
Nothing compiles and nothing executes.

## Minimum viable skill

```markdown
---
name: debt-yield-screen
description: Screen a deal against our minimum debt yield before anything else gets modeled.
when-to-use: When someone asks whether a deal clears our debt yield hurdle, or asks for a first-pass screen on a stabilized asset.
version: 1.0.0
author: Your Name
---

# Debt yield screen

Our floor is 9.0% on stabilized NOI over the requested loan amount.

## Steps

1. Read the stabilized NOI. If only a T-12 exists, normalize it first.
2. Read the requested loan amount, or derive it at 65% LTV on the purchase price.
3. Compute NOI / loan amount.
4. Report the result against the 9.0% floor, and say what loan amount would clear it.

## Rules

- Never use in-place NOI for this test. Stabilized only.
- If the deal fails, say so in the first sentence. Do not lead with the arithmetic.
```

Save as `debt-yield-screen.md` and upload it. That is a complete, working skill.

## Frontmatter schema

The file must open with a YAML block between `---` fences.

| Field | Required | Notes |
|---|---|---|
| `name` | Yes | Lowercase, digits, dashes, underscores. Must start with a letter or digit, 63 characters max |
| `description` | Yes | One line on what the skill does |
| `when-to-use` | No | The situations that should trigger it. Also accepted as `whenToUse` |
| `version` | No | Free-form string |
| `author` | No | Free-form string |
| `tool-allowlist` | No | Inline array restricting which tools the agent may use while this skill is loaded. Also accepted as `toolAllowlist` |

The parser is deliberately small: flat `key: value` pairs, quoted strings, inline arrays like
`[read_range, write_range]`, and `#` comments. **No nested mappings, no block scalars, no multi-line
values, no anchors.** Anything that needs more structure belongs in the body.

Missing `name` or `description` fails the install with a message naming the field.

## Naming rules

`^[a-z0-9][a-z0-9-_]{0,62}$`

> Use lowercase letters, digits, dashes, and underscores only (e.g., "underwriting-checklist").

Bundled skill names are reserved. Colliding with one fails the install:

> A built-in skill is already named "loan-sizing". Rename your skill in its frontmatter and try again.

## Writing a good `when-to-use`

This field does the most work. The agent's skill search weights `when-to-use` three times as heavily
as `description` and six times as heavily as `name`, so it is what determines whether the skill fires
when it should.

Write the situations in the words a user would actually use:

```yaml
when-to-use: When the user uploads a rent roll, asks for unit mix, mentions loss-to-lease, or asks to "clean up" a tenant list. Also when a T-12 tie-out needs rent roll data first.
```

Rather than:

```yaml
when-to-use: For rent roll tasks.
```

## Reference files

Put supporting material in a `references/` folder next to `SKILL.md`. The body loads first, and the
agent pulls a reference only when it needs it.

```text
my-skill/
├── SKILL.md
└── references/
    ├── chart-of-accounts.md
    ├── lender-covenants.md
    └── market-assumptions.csv
```

Name them in the body so the agent knows what is there and when to open one:

```markdown
For the standard account mapping, read `references/chart-of-accounts.md`.
Read `references/lender-covenants.md` only when the deal is financed.
```

This is the whole point of the structure. A 400-line chart of accounts should not sit in every
system prompt to be useful twice a month.

## Packaging and limits

Zip the folder as `.zip` or `.skill`. `SKILL.md` can sit at the zip root or inside a single top-level
folder.

| Limit | Value |
|---|---|
| Total uncompressed | 10 MB |
| Per file | 1 MB |
| Files per zip | 200 |
| Reference extensions kept | `.md`, `.txt`, `.json`, `.yaml`, `.yml`, `.csv` |

Binaries are dropped silently. An image or a PDF in your zip will not reach the agent.

`.skill` is mechanically a zip. Excelente confirms the format by reading the file's magic bytes, so a
mislabelled extension still routes correctly.

## Installing

**Capabilities** → **Skills** → **Upload skill (.zip / .skill / .md)**, or drop the file onto the
panel. You get **Installed "name."** or **Replaced "name."** on an update.

Uploading a skill with an existing user-skill name replaces it, which is how you iterate.

## Letting the agent write one

Run `/skillify` after the agent has done something worth repeating. It reviews the conversation and
proposes a skill, arriving as a card with the description, when-to-use, body, and references laid out
for review. Nothing installs until you click **Install skill**.

This is usually a better starting point than a blank file, because the agent captures the decisions
it actually made, including the ones you corrected it on.

## Testing it

1. Install it and turn it on.
2. Ask something the `when-to-use` should match, without naming the skill. Watch for a `find_skill`
   or `load_skill` call.
3. If it does not fire, the `when-to-use` is too narrow or too abstract. Widen it toward the words a
   user would type.
4. Once it fires, check the work. A skill that loads and produces the wrong convention is a body
   problem, not a matching problem.

## Sharing

A skill is a file. Send the `.zip` or `.md` to a colleague and they upload it. There is no registry
and no publish step.

If you want it to ship with a fork of Excelente, drop the folder into `apps/excel-addin/skills/` and
it becomes a bundled skill on the next build. See [Architecture](/documentation/architecture/).
