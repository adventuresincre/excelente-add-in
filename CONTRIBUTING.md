# Contributing to Excelente

Thanks for being here. This is a small project maintained by a team that also
runs a real estate education business, so I want to be upfront about how it
works and what you can expect.

## Before you write code

**Open an issue first for anything non-trivial.** A bug fix with an obvious
cause does not need one. A new tool, a change to the agent loop, a new provider,
or anything that touches the workbook context engine does. It saves you from
building something we have already tried and rejected, and it saves me from
reviewing a large diff cold.

Good issues include the Excel host you are on (Windows, Mac, or web), the model
you were using, and what the workbook looked like. Excel behaves differently
across hosts more often than you would expect, and the model matters more than
you would expect too.

## The workflow

1. Fork, then branch off `main`. Name it something readable like
   `fix/screenshot-margin-clipping`.
2. Make the change. Keep the pull request focused on one thing.
3. Run the gates from `apps/excel-addin/`:

   ```bash
   npm run check:boundary
   npm run typecheck
   npm test
   npm run lint
   npm run build
   ```

   All five must pass. If you touched `manifest.template.xml`, also run
   `npm run validate`. `check:boundary` guards the edition seam described in
   CLAUDE.md; a change under `src/core/` that imports `@edition` fails it.

4. Open the pull request with a test plan. See below.
5. Expect review comments. I read every one of these, but I am not always fast.

## Test plans are the part I actually read

Unit tests are necessary and they are not sufficient. This add-in runs inside a
host we do not control, against models that behave differently from each other,
on workbooks we have never seen. So tell me what you did in Excel.

A useful test plan looks like this:

> Tested on Excel 365 Windows 16.0.18xxx, model `anthropic/claude-sonnet-5`.
> Built a 10-year DCF on a blank sheet, then asked for a two-way sensitivity
> table on exit cap and rent growth. Before the fix the table wrote into B2
> and clobbered the header row. After, it writes into B14 as intended.
> Also checked the margin=0 path, which still produces an exact crop.

A test plan that says "works fine" tells me nothing and I will ask for the real
one, which wastes a round trip for both of us.

## What gets merged

Things that land easily:

- Bug fixes with a clear reproduction
- New Excel tools that follow the existing `ToolDef` shape
- Skills, as long as you own the content or it is properly licensed
- Host compatibility fixes, especially Mac and web
- Documentation that corrects something wrong
- Tests for paths that have none

Things that need a conversation first:

- New model providers beyond OpenRouter
- Changes to the agent orchestration loop
- Anything that adds a runtime dependency
- Changes to the context engine's tiering

Things I will decline:

- Reformatting passes and style-only churn
- Renaming things for consistency without a functional reason
- Features that only make sense against a hosted backend you do not have

## Code standards

The codebase has a few conventions that are load-bearing, not cosmetic:

- **All Excel I/O goes through `core/tools/excel/*`.** No `Excel.run` in UI code.
  Office.js proxies have batching semantics that will bite you if scattered.
- **All model calls go through `core/openrouter`.**
- **Each `core/*` folder exposes its interface through `index.ts`.** Read that
  folder's `README.md` before changing what it exports.
- **Comments explain why, not what.** If a line looks wrong and is correct, say
  why it is correct. Most of the comments in here exist because something broke
  once, and the ones that name a date and a symptom are the most valuable ones
  in the repo.
- **Fail soft on anything cosmetic.** A screenshot that cannot be annotated
  should return an unannotated screenshot, never throw. A missing catalog should
  return null. The agent is mid-task and an exception costs the user their work.

## Using a coding agent

Most of this codebase was written with AI assistance and we have no hangups
about you doing the same. [CLAUDE.md](CLAUDE.md) is written for that purpose and
[AGENTS.md](AGENTS.md) covers etiquette.

Two asks. Read the diff before you open the pull request, because you are the
author and you are accountable for it. And credit your assistant in the commit
trailer, the same way we do.

## Contributor License Agreement

You keep copyright in what you write. Alongside the Apache 2.0 grant that comes
with contributing to this repository, we ask for a license grant broad enough to
use your contribution in the hosted build of Excelente, which is not itself
Apache licensed.

The CLA bot will prompt you on your first pull request. It is one click and it
is the standard Apache-style individual agreement. If you are contributing on
company time, your employer may need to sign the corporate version.

If that is a dealbreaker, say so in the issue. I would rather know before you
spend a weekend on something.

## Security

Do not open a public issue for a vulnerability. [SECURITY.md](SECURITY.md) has
the disclosure path.

## Questions

Open a discussion, or reach us at
<https://www.adventuresincre.com/contact-us/>. If you are working on something
substantial and want to talk it through first, that is a good use of both our
time.
