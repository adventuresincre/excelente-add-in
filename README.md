# Excelente

**An AI-first Excel add-in for financial modeling. You pick the model, it reads your whole workbook, and it does the work in the cells.**

[excelente.aiedge.ac](https://excelente.aiedge.ac) · [Apache 2.0](LICENSE) · Built by [A.CRE](https://www.adventuresincre.com) and [AI.Edge](https://aiedge.ac)

---

Most AI tools for Excel hand you a chat box that writes a formula you then paste
somewhere. Excelente is built the other way around. It reads the workbook that is
actually open in front of you (every sheet, the formulas, the named ranges, the
charts), plans a sequence of steps, and writes back into the cells with your
approval.

It came out of building real estate models for a living. The conventions are CRE
conventions, and the skills that ship here are the ones we use. Nothing about the
harness is real estate specific, though. If you model anything in Excel, it works.

Three things make it different from the alternatives:

**You choose the model.** Excelente talks to OpenRouter, so any model on
OpenRouter is available: Claude, GPT, Gemini, Qwen, DeepSeek, whatever comes out
next month. You bring your own key and you pay OpenRouter directly. There is no
model lock-in because there is no model relationship to protect.

**Reasoning effort is a control, not a mystery.** Off, low, medium, high, exposed
as a slider. Same for how long the agent is allowed to work before it reports
back.

**Skills are just Markdown.** Drop a folder with a `SKILL.md` into the skills
directory and the agent can load it. The bundled ones are worth reading as
examples, and they are the same format as Open Agent Skills.

## Try the hosted version first

The easiest way to see what this does is [excelente.aiedge.ac](https://excelente.aiedge.ac).
That is the build we host and support, and it is free to use with your own
OpenRouter key.

This repository is for people who want to read the code, change it, run their own
build, or contribute a fix.

## Running it yourself

You need Node 22 or newer, Excel with the `ExcelApi 1.9` requirement set (Microsoft
365 on Windows or Mac, or Excel on the web), and an
[OpenRouter API key](https://openrouter.ai/keys).

```bash
git clone https://github.com/adventuresincre/excelente-add-in.git
cd excelente-add-in/apps/excel-addin
npm install
npm run manifest:dev   # writes a localhost manifest.xml
npm run dev            # serves the task pane on https://localhost:3000
```

Then sideload it. In another terminal:

```bash
npm start
```

That launches Excel with the add-in registered. First run will ask you to trust a
local development certificate, which is normal for Office add-ins on localhost.

Open the task pane, go to Settings, paste your OpenRouter key, and you are
running. The key lives in `OfficeRuntime.storage`, which Office sandboxes per
add-in on your own machine. It is not encrypted at rest, which is a gap we have
written down rather than papered over (see
`src/core/storage/README.md`). It is sent to OpenRouter and to nothing else.

Useful commands, all from `apps/excel-addin/`:

```bash
npm test           # vitest, ~970 tests
npm run typecheck  # tsc --noEmit
npm run lint       # office-addin-lint
npm run build      # production bundle into dist/
npm run validate   # validate manifest.xml
```

## How it is put together

```
apps/excel-addin/
├── src/
│   ├── core/
│   │   ├── openrouter/   # model client: chat, SSE streaming, tool calls, reasoning
│   │   ├── context/      # the workbook context engine
│   │   ├── agent/        # orchestrator loop, sub-agents, context budget
│   │   ├── tools/        # tool registry and the Excel tool implementations
│   │   ├── skills/       # skill loader with progressive disclosure
│   │   ├── mcp/          # MCP client, OAuth, connector presets
│   │   ├── modes/        # mode presets
│   │   └── storage/      # encrypted settings, API key, conversation history
│   └── ui/               # React task pane
└── skills/               # bundled skills, see skills/LICENSE.md
```

Two rules hold the thing together, and both are enforced in review:

- Every Excel read and write goes through `core/tools/excel/*`. No `Excel.run`
  calls in UI code.
- Every model call goes through `core/openrouter`.

Each `core/*` folder has its own `README.md` describing what it exposes. Read that
before changing anything inside it. There is also a [CLAUDE.md](CLAUDE.md) written
for coding agents, which is honestly the fastest orientation for a human too.

## A note on the workbook context engine

This is the part we spent the most time on and the part most likely to surprise
you. Sending an entire workbook to a model is both expensive and useless, because
the model drowns. So `core/context` builds a tiered view: a workbook outline first
(about 1k tokens), then a sheet outline on request (about 5k), then exact values
and formulas for a specific range.

The screenshot tool is worth calling out. `Range.getImage()` renders cells without
row numbers or column letters, which led to a model confidently describing
"columns A through Q" in an image containing no such labels. So we paint the
headers on ourselves, positioned as each column's share of total width rather than
a points-to-pixels constant, because the render DPI is not knowable in advance.
`src/core/tools/excel/paint-headers.ts` has the details.

## What is not in this repository

The hosted service at excelente.aiedge.ac runs from a private repository that adds
the deployment tooling, the landing page, the terms and privacy pages, the
marketplace submission material, and the server-side pieces that hold our own API
keys. None of that is useful to you and some of it is ours to keep.

Nine of the bundled CRE skills are also absent. They incorporate methodology
licensed to us by CRE Agents, Inc. under terms that cover use of the add-in but
not redistribution, so we cannot put them here. The skill loader globs whatever is
present, so nothing breaks. See
[apps/excel-addin/skills/LICENSE.md](apps/excel-addin/skills/LICENSE.md).

What is here is the add-in: the whole harness, the agent, the Excel tool layer,
the UI, and our own method skills.

## Contributing

Yes, please. [CONTRIBUTING.md](CONTRIBUTING.md) covers the workflow, the review
standard, and the CLA.

The short version: open an issue before you build something large, keep pull
requests focused, and include a test plan describing what you actually did in
Excel. We care more about a clear description of what you tried than about a
perfect diff.

If you are driving this with a coding agent, read [AGENTS.md](AGENTS.md) first.

## License

Code is [Apache 2.0](LICENSE). Use it commercially, fork it, ship your own product
on top of it. We would appreciate a mention.

Two carve-outs, both spelled out in [NOTICE](NOTICE):

- The **names and logos** are not licensed. "Excelente", "A.CRE", "AI.Edge" and
  the brand assets stay ours. [TRADEMARKS.md](TRADEMARKS.md) explains what you may
  and may not do, and includes a checklist for renaming a fork.
- The **skills** carry their own licenses. See
  [apps/excel-addin/skills/LICENSE.md](apps/excel-addin/skills/LICENSE.md).

## Disclaimer

Excelente is provided as is, without warranty of any kind. Its output consists of
estimates generated from assumptions you provide. It is not investment, financial,
tax, legal, or accounting advice, and it must not be relied on for any real
transaction without independent verification by a qualified professional.

CRE Edge, LLC accepts no liability for any loss or damage arising from the use of,
or inability to use, this software. You are responsible for any decision you make
using its output.

Verify the model. Always. That advice predates AI and it has not aged.
