# CLAUDE.md

Orientation for coding agents working in this repository. Humans get value out
of it too, and it is probably the fastest way to understand the codebase.

Read [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow and
[AGENTS.md](AGENTS.md) for etiquette. This file is the technical map.

## Commands

All from `apps/excel-addin/`:

```
npm run dev           # Vite dev server on https://localhost:3000
npm run build         # production bundle into dist/
npm run typecheck     # tsc --noEmit (the primary correctness gate)
npm run test          # vitest run (93 files, ~970 tests)
npm run test:watch    # vitest watch mode
npm run lint          # office-addin-lint check (lint:fix to auto-fix)
npm start             # sideload into Excel desktop
npm run manifest:dev  # generate manifest.xml from the template
npm run validate      # validate manifest.xml
```

Single test file: `npx vitest run src/core/agent/compaction.test.ts`. Add
`-t "name"` to filter by test name.

**Verify with typecheck, not build.** Vite's build tolerates some type errors
that `tsc` catches. Tests run in node under vitest, so no browser is needed.

## Where things live

```
apps/excel-addin/
├── src/
│   ├── core/
│   │   ├── openrouter/   # Client, SSE streaming, tool-call assembly, reasoning mapping, vision call, image downscale
│   │   ├── context/      # ExcelDataSource abstraction, workbook/sheet outlines, range reads, formula normalization, run_excel_script sandbox
│   │   ├── agent/        # Orchestrator (tool-use loop, compaction, approval gates), sub-agent spawning, mode prompts, conversation summary, truncation
│   │   ├── tools/        # Tool registry + implementations: excel/{read,write,screenshot,run-script}, plan, todo, undo, subagent, skills, memory, ask-user, plan-mode, workbook-settings
│   │   ├── skills/       # Skill system: registry, frontmatter parser, bundled/user sources, IndexedDB + memory stores, install logic
│   │   ├── storage/      # Settings and API key (OfficeRuntime.storage, see module README), conversation store, MCP store, workbook id
│   │   ├── config/       # Server-driven config, hardcoded defaults, ETag cache
│   │   ├── auth/         # Session store, operating mode derivation, member and tier types
│   │   ├── mcp/          # MCP client, manager, OAuth, connector presets, tool bridge
│   │   ├── hooks/        # Pre/PostToolUse hooks, Excel worksheet-change events
│   │   ├── modes/        # Mode system (scaffold)
│   │   ├── memory/       # Workbook memory (hidden `_excelente` sheet), workbook-level setting overrides
│   │   ├── vision/       # Attachments: images (downscale), PDFs (pdfjs-dist), spreadsheets (xlsx/jszip)
│   │   ├── commands/     # Slash commands
│   │   └── attachments/  # Spreadsheet import
│   ├── ui/taskpane/      # React UI (chat, settings, skills, history, plan, design tokens)
│   ├── taskpane/         # Vite entry points only. DO NOT add components here
│   └── commands/         # Ribbon command entry point
├── skills/               # Bundled Open Agent Skills. See skills/LICENSE.md
├── scripts/              # build-manifest.mjs, build-version.mjs, generate-brand-assets.mjs, measure-*
└── manifest.template.xml # Source of truth. manifest.xml is generated from it
```

Every `core/*` folder has a `README.md` describing its public interface. Read it
before you change what the folder exports.

## Architecture

**Orchestrator** (`core/agent/orchestrator.ts`) is a streaming tool-use loop.
Send messages plus tools, stream the response, check permission, execute the
tool, feed the result back, repeat until stop or the turn cap. Compaction kicks
in around a 200k token budget.

**Plan and Work modes** are distinct system prompts in
`core/agent/mode-prompts/`. Plan mode is read-only investigation ending in
`submit_plan`. Work mode is autonomous execution with mandatory post-write
verification, meaning a screenshot plus a Reviewer sub-agent.

**Sub-agents** have typed roles (Reviewer, Builder, Explore, Audit), isolated
orchestrator instances, tool allowlists, and turn caps. No recursive spawning.

**Tool surface**: every tool declares `requiredPermission: "Read" | "Write"`.
Read tools run silently, Write tools route through approval. The registry
accepts MCP tools at runtime through `addAll` / `removeBySource`.

**Context engine** is hierarchical and lazy. Workbook outline (about 1k tokens),
then sheet outline (about 5k each), then range reads on demand.
`ExcelDataSource` abstracts Office.js and `inMemoryDataSource` backs the tests.

**Operating modes** are derived from capability through `deriveOperatingMode`,
never stored. An API key means BYOK. In this build that is the path that
matters.

## Gotchas

These are all here because something broke once.

- **No `Excel.run` outside `core/tools/excel/` and `core/context/`.** All
  Office.js I/O goes through the datasource abstraction. Office.js proxy
  batching will bite you if it is scattered.
- **No direct `fetch("openrouter.ai/...")` outside `core/openrouter/`.**
- **`src/taskpane/` is the Vite entry point only.** Components live under
  `src/ui/taskpane/`.
- **`manifest.template.xml` is the source of truth.** `manifest.xml` is
  generated and gitignored. Do not hand-edit it.
- **`strictPort: true`** on the dev server. Vite will not quietly move to 3001,
  because silently serving stale code on a port Excel is not watching costs an
  hour of "why aren't my changes showing up". Kill the stale process.
- **No `window.confirm`, `alert`, or `prompt`.** Excel for Mac's WKWebView task
  pane does not implement native dialogs. `confirm()` returns false instantly
  and the guarded action silently never runs. This shipped once as "won't let me
  delete history on Mac". Use `ui/taskpane/ConfirmButton`.
- **No VBA generation.** Office.js cannot do it. Permanently out of scope.
- **Compaction-exempt tools**: `load_skill`, `read_skill_resource`, and
  `read_workbook_memory` are never compacted away.
- **`run_excel_script` runs in a sandbox** with restricted globals. Do not
  expand it without a security review.
- **Two-level permission model, Read and Write only.** Every Excel write is
  reversible through the undo stack.
- **Column widths are POINTS**, not the character units Excel's Column Width
  dialog shows. An untouched column reports 48, which is 8.43 character units,
  which is 64 pixels. Read and write agree; only the dialog differs. This was
  documented wrong once and the agent acted on it.
- **`Range.getImage()` renders cells only.** No row numbers, no column letters,
  no host chrome. A model once described "column letters A through Q" in an
  image containing none and then reasoned from it. `paint-headers.ts` draws them
  on, positioned as each column's share of total width rather than a
  points-to-pixels constant, because render DPI is not knowable in advance. A
  test fixture holds real measured gridline positions, so reintroducing a scale
  constant fails the suite.

## House style

- **Comments explain why, not what.** The most valuable comments in this repo
  name a date and a symptom. Keep writing those.
- **Fail soft on anything cosmetic.** No canvas, no dimensions, an unparseable
  address: return the unannotated screenshot, never throw. The user is mid-task
  and an exception costs them their work.
- **Absent, never guessed.** If the host will not report a dimension, omit the
  field. Do not substitute a default and let the agent reason from it.
- **Tests are node-only.** If you need Office.js, you need `inMemoryDataSource`
  or a fake, not a browser.
