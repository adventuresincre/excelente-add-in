---
title: Architecture
description: How the code is laid out, the rules that keep it testable, and where to add things.
group: Run it yourself
order: 3
---

For anyone reading or extending the source. Excelente is Office.js, React, and Vite, with no backend
of its own in BYOK mode.

## Module map

```text
src/
├── core/
│   ├── openrouter/   Client, SSE streaming, tool-call assembly, reasoning mapping, vision calls
│   ├── context/      ExcelDataSource abstraction, workbook and sheet outlines, range reads
│   ├── agent/        Orchestrator, sub-agent spawning, mode prompts, compaction, truncation
│   ├── tools/        Registry and implementations, including tools/excel/*
│   ├── skills/       Registry, frontmatter parser, bundled and user sources, install logic
│   ├── storage/      Settings, conversation store, MCP store, workbook id
│   ├── mcp/          Client, manager, tool bridge, presets, priming
│   ├── hooks/        PreToolUse, PostToolUse, worksheet change events
│   ├── memory/       Workbook memory and per-workbook settings
│   ├── vision/       Image downscaling, PDF rasterization
│   ├── attachments/  Spreadsheet import
│   ├── commands/     Slash commands
│   ├── auth/         Session store and operating mode derivation
│   ├── relay/        Relay and concierge clients
│   └── config/       Server-driven config with hardcoded fallback
├── ui/
│   ├── taskpane/     React components: chat, settings, skills, history, plan, capabilities
│   └── design/       tokens.css
├── taskpane/         Vite entry points only. App.tsx and main.tsx
└── commands/         Ribbon command entry point
```

## The orchestrator

`core/agent/orchestrator.ts` runs the loop: send messages and tools, stream the response, check each
tool call's permission, execute or gate it, feed the result back, repeat until the model stops or the
turn cap is hit. Compaction triggers at roughly a 200,000-token budget.

Sub-agents are isolated orchestrator instances with their own tool allowlists and turn caps. They
cannot spawn sub-agents.

## Rules that hold the design together

These are enforced by convention and review rather than by the compiler, and breaking one tends to
break testing rather than production, which is why they are easy to break by accident.

**Office.js stays behind `ExcelDataSource`.** No `Excel.run` outside `core/tools/excel/` and
`core/context/`. Tests use `inMemoryDataSource`, which is why 60-plus test files run in node in
seconds with no Excel.

**Model calls go through `core/openrouter/client.ts`.** No direct `fetch` to OpenRouter elsewhere.

**Core imports no UI.** No React, no CSS, under `core/`.

**Every tool declares `requiredPermission`.** The registry throws on a tool that does not, and on any
value other than `Read` or `Write`.

**Each module exposes its public API through `index.ts`.** Do not import another module's internal
files.

**Components live in `src/ui/taskpane/`, never in `src/taskpane/`.** The latter is the Vite entry
point.

## The context engine

Three levels, loaded lazily: a workbook outline of about 1,000 tokens on every turn, sheet outlines of
about 5,000 tokens each on demand, and range reads when asked for. `ExcelDataSource` abstracts the
host, so the same tool code runs against Excel and against a plain object in tests.

## The permission model

Two levels, `Read` and `Write`, defined in `core/tools/types.ts`. There is no danger tier because
every Excel write is reversible through the undo stack, so no write has a different recovery path
from any other.

MCP tools are classified at bridge time from the annotations the server declares.

## Compaction

At the budget, older turns fold into a structured summary. Three tool results are exempt:
`load_skill`, `read_skill_resource`, and `read_workbook_memory`. Adding to that list has a direct
cost in every long session, so it is not a free decision.

## MCP

Browser JSON-RPC 2.0 over HTTP POST, the Streamable HTTP variant. No stdio. `McpManager` owns
connection lifecycle; `toolBridge` converts MCP schemas into Excelente `ToolDef`s tagged
`source: "mcp:<name>"`, which is how the registry bulk-removes them on disconnect.

`presets.ts` declares the built-in connectors and their priming recipes. `priming.ts` decides what
reaches the system prompt each turn. Keep recipes token-cheap and fail-soft; a connector that is down
must not slow a turn down.

## Adding things

**A tool.** Create it in `core/tools/` with a name, description, JSON schema, `requiredPermission`,
and `execute`. Register it in `core/tools/index.ts`. Go through `ExcelDataSource` for any workbook
access. Add a test using `inMemoryDataSource`.

**A skill.** Drop a folder with `SKILL.md` into `skills/`. Markdown only, never executable
JavaScript, which is a Marketplace content policy. See
[Write your own skill](/documentation/writing-skills/).

**A connector preset.** Add it to `ACRE_MCP_PRESETS` in `core/mcp/presets.ts`. An OAuth domain also
needs an `<AppDomains>` entry in `manifest.template.xml`.

**A slash command.** Add it to `core/commands/builtins.ts` and handle it in `ChatPanel`.

**A UI component.** `src/ui/taskpane/`. Function components and hooks only. No Office.js and no
OpenRouter `fetch`; use the context from `AppProvider.tsx` and the `useAgentStream` bridge. Tokens
from `src/ui/design/tokens.css`.

## Code the UI cannot reach

`core/auth`, `core/relay`, and parts of `core/config` implement an authenticated member mode with a
relay and metered credits. It is written and tested, and **nothing in the shipped UI renders it**.
`AuthDialog.tsx` is never mounted, and `deriveOperatingMode` is not called outside its own module.

Worth knowing before you spend an afternoon tracing why a member session never appears. In a fork you
can delete that machinery or wire it up, and either is a real decision rather than a bug fix.

## Verifying

```bash
npm run typecheck   # the correctness gate
npm run test
npm run lint
```

`npm run build` is not a correctness gate. Vite ignores type errors that `tsc` catches.

## The three version identities

They are deliberately not synced:

| Identity | Set by | Purpose |
|---|---|---|
| `package.json` semver | By hand | Human-readable release number |
| Build id, `<semver>+<git sha>` | `vite.config.ts` at build time | What Settings → About shows, and what a deploy verifies |
| Manifest `<Version>` | By hand, for store submissions only | Kept still so a file-only deploy does not change the manifest checksum and trigger a review |
