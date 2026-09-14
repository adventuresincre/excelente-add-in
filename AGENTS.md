# Working on Excelente with a coding agent

Most of this codebase was written with AI assistance. We are not going to
pretend otherwise or ask you to. This page covers how to do it well here.

Read [CLAUDE.md](CLAUDE.md) for the architecture map and
[CONTRIBUTING.md](CONTRIBUTING.md) for the workflow. This is the etiquette.

## Ground rules

**You are the author.** Read the diff before you open the pull request. If a
reviewer asks why a line is there, "the agent wrote it" is not an answer. This
matters more here than in most repos because the gotchas in CLAUDE.md are
counterintuitive and an agent that has not read them will cheerfully reintroduce
one.

**Credit your assistant in the commit trailer.** We do:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

**Keep the change scoped.** Agents are good at noticing adjacent things worth
fixing. Resist. A pull request that fixes one bug and also renames six variables
is harder to review than two pull requests, and the rename is the part that will
stall.

## Getting an agent oriented

Point it at [CLAUDE.md](CLAUDE.md) first, then the `README.md` inside whichever
`core/*` folder you are touching. Each one documents that module's public
interface, and they are kept current because reviewers ask for updates when an
interface changes.

Ask the agent to run `npm run typecheck` and `npm test` before it tells you it is
done. Both are fast and both catch things that look fine in a diff.

## Where agents reliably go wrong in this repo

Worth pasting into your agent's context if you are working in these areas:

**Office.js batching.** `Excel.run` proxies do not resolve until `sync()`. An
agent that adds a `load()` in a loop and syncs once per iteration writes code
that works and is twenty times slower than it should be. All Excel I/O belongs
in `core/tools/excel/` or `core/context/` for exactly this reason.

**Units.** Column widths are points. Row heights are points. Excel's Column
Width dialog shows character units and they are not the same number. An agent
that "helpfully" converts is introducing a bug.

**Assuming a screenshot shows what a screenshot shows.** `Range.getImage()`
returns cells with no headers. We paint headers on afterward. An agent reasoning
about what the model can see in an image should check
`src/core/tools/excel/paint-headers.ts` rather than assume.

**Defaults where data is missing.** The house rule is absent, never guessed. An
agent will often fill an optional field with a sensible default. Here, that
default gets fed to a model which then reports it as fact.

**Native dialogs.** `confirm()` returns false instantly in Excel for Mac and the
guarded action silently does not happen. Agents reach for `window.confirm`
constantly. Use `ui/taskpane/ConfirmButton`.

## Testing what an agent cannot test

Unit tests do not cover the part that breaks: the add-in running inside a real
Excel against a real model on a real workbook. Your agent cannot do that and
neither can our CI.

So before you open the pull request, load the add-in and use it. Say what you
did in the test plan, including the host, the model, and the workbook. See
[CONTRIBUTING.md](CONTRIBUTING.md) for what a useful test plan looks like.

If you genuinely cannot test in a host, say so in the pull request. That is fine
and we will test it. Silently implying you did is not.

## Skills

If you are adding or editing a skill, the format is Markdown with YAML
frontmatter and the details are in
[apps/excel-addin/skills/LICENSE.md](apps/excel-addin/skills/LICENSE.md).

One warning. Skills are prompt content, so an agent writing a skill is writing
instructions for itself, and they tend toward the generic. A skill that says
"follow best practices" changes nothing. A skill that says "column A is a
width-2 rail, row 1 is a height-14.4 spacer, inputs are blue and formulas are
black" changes behavior on the next turn. Specificity is the whole product.

Test a skill by using it, not by reading it.
