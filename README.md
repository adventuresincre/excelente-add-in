# Excelente

**An open-source AI harness for Excel. You choose the model, you choose the capabilities, and the work lands in the cells.**

**[Install from Microsoft Marketplace](https://marketplace.microsoft.com/en-us/product/WA200012017)** · [excelente.aiedge.ac](https://excelente.aiedge.ac) · [Apache 2.0](LICENSE) · Built by [A.CRE](https://www.adventuresincre.com) and [AI.Edge](https://aiedge.ac)

---

## Why We Built Excelente

At A.CRE we've been teaching CRE professionals the technical skills that matter since 2015. Our flagship A.CRE Accelerator teaches real estate financial modeling while our AI.Edge teaches AI proficiency. Both are built for people who work in CRE, and as the industry enters the AI era, being AI-native has become increasingly important, whether the task is underwriting a deal or building a quarterly report for investors. Watching the AI tech stack take shape has taught us one thing above the rest: the harness matters as much as the model. The harness is the environment that makes the AI model capable of producing work that one can actually use. It determines what tools the model can reach, what knowledge and data flow in, and how the output lands in the file.

We went looking for a harness in Excel to teach with. Every option was proprietary, limited which models it would talk to, and didn't have the CRE-specific capabilities to be useful for our industry. We wanted our students in an open-source environment where they control the harness, the model, and the capabilities plugged into it. We also needed it to run at low or no cost, because many students cannot pay for inference on top of tuition.

Nothing met both requirements, so we built Excelente.

It's initially released as an optional component of our real estate financial modeling training and AI.Edge programs. Over time we expect it to become central to how students learn where their own judgment belongs in a model and where AI can carry the work.

---

## What Excelente Is

There are good AI harnesses for Excel today. Claude for Excel, ChatGPT for Excel, Endex, and Shortcut AI all read a workbook and write into it. Every one of them is proprietary, and every one of them decides which models you may use. The vendor picks the intelligence, the vendor picks the tools, and you rent the result.

Excelente is the same category of tool with the ownership flipped. The code is Apache 2.0. The model is whichever one you point it at. The capabilities are files you can read and change. It reads the workbook open in front of you (every sheet, the formulas, the named ranges, the charts), plans a sequence of steps, and writes back into the cells with your approval. Every write can be undone.

We built it to teach CRE, so the modeling conventions are CRE conventions and the bundled skills are the ones we use in the Accelerator. The harness itself has no real estate in it. If you model anything in Excel, it works.

## What You Control

**The model.** By default, Excelente talks to OpenRouter, so any model listed there is available: Claude, GPT, Gemini, Qwen, DeepSeek, Grok, etc. Bring your own key and OpenRouter bills you directly at their rates. The picker ranks every model by an independent capability index and by value, so you can see what a given choice costs and what it buys. Or fork the code, and build access to whichever model you choose, including locally installed models.

**The effort.** Reasoning is a slider from off through high, and you can see what each setting costs on the model you picked. A second control sets how long the agent works before it pauses to check in with you.

**The capabilities.** Three kinds are included:

- *Skills* consistent with the Agent Skill standard. A skill is a folder with a `SKILL.md`, in the same format as Open Agent Skills. Drop one into the skills directory and the agent can find it and load it. The bundled ones are worth reading as examples of how we encode a method.
- *MCP servers* bring in outside tools and data. Add any server that speaks the protocol. Two presets ship because our students and clients use them: CRE Agents gives the AI access to CRE-specific tasks, skills, and datasets while the A.CRE Intelligence Hub serves primary-source real estate data.
- *Attachments* optimized for accuracy. PDFs are sent as page images rather than extracted text, because in this business a misread number is worse than a slower answer. Images and spreadsheets attach too, and a spreadsheet can be inserted into the workbook as worksheets instead.

**Subagents.** The main agent can hand a focused job to a child agent and see only its summary. Four roles ship: Explore finds things, Audit hunts errors, Builder executes one write task, and Reviewer gives a second opinion. Each has its own prompt and tool allowlist, and a child cannot spawn children.

**Reviewer agents.** In Work mode, every non-trivial write is followed by a review you did not have to ask for. A read-only Reviewer checks the section against the workbook's conventions and CRE modeling standards, then reports what is correct and what looks off, citing cells rather than vibes.

**Agent screenshots.** The agent can capture any range or chart as an image and look at it, the way you would after pasting a table. It does this after formatting passes, sensitivity tables, and charts, because values alone will not show a column rendering as hash marks or negatives that lost their parentheses.

**Plan mode.** Plan mode investigates and proposes without touching a cell. Work mode executes, then verifies its own writes with a screenshot and a reviewer sub-agent before reporting back. Reads happen silently. Writes wait for your approval, and the undo stack takes any of them back.

## Get It

**[Install from Microsoft Marketplace](https://marketplace.microsoft.com/en-us/product/WA200012017)** and it is added to Excel in about a minute. That is the version we host and support, and it runs on Microsoft 365 for Windows and Mac and on Excel for the web.

Our hosted version of Excelente is free to use. Add your own OpenRouter key and use any of the dozens of free and paid AI models directly through OpenRouter. We do not resell model usage.

This repository is for people who want to read the code, change it, run their own build, or contribute a fix.

## Running It Yourself

You need Node 22 or newer, Excel with the `ExcelApi 1.9` requirement set (Microsoft 365 on Windows or Mac, or Excel on the web), and an [OpenRouter API key](https://openrouter.ai/keys).

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

That launches Excel with the add-in registered. The first run asks you to trust a local development certificate, which is normal for Office add-ins on localhost.

Open the task pane, go to Settings, and paste your OpenRouter key. The key lives in `OfficeRuntime.storage`, which Office sandboxes per add-in on your own machine. It is not encrypted at rest. We have written that gap down rather than papered over it (see `src/core/storage/README.md`). The key is sent to OpenRouter and to nothing else.

Useful commands, all from `apps/excel-addin/`:

```bash
npm test           # vitest, about 970 tests
npm run typecheck  # tsc --noEmit, the correctness gate
npm run lint       # office-addin-lint
npm run build      # production bundle into dist/
npm run validate   # validate manifest.xml
```

## How It Is Put Together

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
│   │   ├── vision/       # attachments: images, PDF pages, spreadsheets
│   │   └── storage/      # settings, API key, conversation history
│   └── ui/               # React task pane
└── skills/               # bundled skills, see skills/LICENSE.md
```

Two rules hold it together, and both are enforced in review:

- Every Excel read and write goes through `core/tools/excel/*`. No `Excel.run` calls in UI code.
- Every model call goes through `core/openrouter`.

Each `core/*` folder has its own `README.md` describing what it exposes. Read that before changing anything inside it. [CLAUDE.md](CLAUDE.md) was written for coding agents and is the fastest orientation for a human too.

## The Workbook Context Engine

Sending a whole workbook to a model is expensive and, past a certain size, useless, because the model drowns. So `core/context` builds a tiered view: a workbook outline first (about 1k tokens), then a sheet outline on request (about 5k), then exact values and formulas for a specific range.

The screenshot tool deserves a mention. `Range.getImage()` renders cells without row numbers or column letters, which once led a model to describe "columns A through Q" in an image that had no such labels. So we paint the headers on ourselves, positioned as each column's share of total width rather than a points-to-pixels constant, because the render DPI is not knowable in advance. `src/core/tools/excel/paint-headers.ts` has the details.

## What Is Not in This Repository

The hosted service at excelente.aiedge.ac runs from a private repository that adds the deployment tooling, the landing page, the terms and privacy pages, the marketplace submission material, and the server-side pieces that hold our own API keys.

Nine of the bundled CRE skills are also absent. They incorporate methodology licensed to us by CRE Agents, Inc. under terms that cover use of the add-in but not redistribution, so we cannot put them here. The skill loader globs whatever is present, so nothing breaks. See [apps/excel-addin/skills/LICENSE.md](apps/excel-addin/skills/LICENSE.md).

What is here is the add-in: the whole harness, the agent, the Excel tool layer, the UI, and the five method skills that are wholly ours.

## Contributing

Yes, please. [CONTRIBUTING.md](CONTRIBUTING.md) covers the workflow, the review standard, and the CLA.

The short version: open an issue before you build something large, keep pull requests focused, and include a test plan that says what you did in Excel. A clear account of what you tried matters more to us than a perfect diff.

If you are driving this with a coding agent, read [AGENTS.md](AGENTS.md) first.

## License

Code is [Apache 2.0](LICENSE). Use it commercially, fork it, ship your own product on top of it. We would appreciate a mention.

Two carve-outs, both spelled out in [NOTICE](NOTICE):

- The **names and logos** are not licensed. "Excelente", "A.CRE", "AI.Edge" and the brand assets stay ours. [TRADEMARKS.md](TRADEMARKS.md) explains what you may and may not do, and includes a checklist for renaming a fork.
- The **skills** carry their own licenses. See [apps/excel-addin/skills/LICENSE.md](apps/excel-addin/skills/LICENSE.md).

## Disclaimer

Excelente is provided as is, without warranty of any kind. Its output consists of estimates generated from assumptions you provide. It is not investment, financial, tax, legal, or accounting advice, and it must not be relied on for any real transaction without independent verification by a qualified professional.

CRE Edge, LLC accepts no liability for any loss or damage arising from the use of, or inability to use, this software. You are responsible for any decision you make using its output.

Verify the model. That was true before AI and it is true now.
