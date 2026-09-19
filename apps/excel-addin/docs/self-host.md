---
title: Build and sideload your own
description: Clone the public repo, run the dev server, and load your build into Excel.
group: Run it yourself
order: 1
---

Excelente is Apache 2.0. Everything you need to run your own build is in
[excelente-add-in](https://github.com/adventuresincre/excelente-add-in).

## Prerequisites

- **Node 22 or newer.** Vite 6 also accepts 18 and 20, but 22 is what we build against.
- **Excel desktop** on Windows or Mac, on Microsoft 365. Sideloading needs a desktop host.
<!-- edition:include self-host/key-bullet -->
- **An OpenRouter key.** The community edition has no hosted model tier; your build talks to
  OpenRouter with your key and nothing else.
<!-- /edition:include -->

## Setup

```bash
git clone https://github.com/adventuresincre/excelente-add-in.git
cd excelente-add-in/apps/excel-addin
npm install
```

The install generates local HTTPS certificates through `office-addin-dev-certs`. Excel refuses to
load a task pane over plain HTTP, so this step is not optional. On the first run your OS will ask to
trust a local certificate authority.

## Run the dev server

```bash
npm run dev
```

Vite serves on `https://localhost:3000`.

**Port 3000 is not negotiable.** `strictPort` is on, so Vite fails rather than moving to 3001,
because the sideloaded manifest points at 3000 and a silently relocated server produces a blank pane
with no useful error. If the port is taken, kill the stale process rather than changing the port.

## Sideload into Excel

In a second terminal:

```bash
npm start
```

This builds the dev manifest and hands it to Excel, which opens with the add-in loaded. Look for the
**excelente** button on the Home tab.

To generate the manifest without launching:

```bash
npm run manifest:dev
```

That writes `manifest.xml` from `manifest.template.xml` with localhost defaults. **Edit the template,
never the generated file.**

To stop sideloading:

```bash
npm run stop
```

## Verifying a change

```bash
npm run typecheck   # tsc --noEmit. This is the correctness gate
npm run test        # vitest, runs in node with no browser
npm run lint
```

Use `typecheck`, not `build`, to decide whether your change is sound. Vite ignores some type errors
that `tsc` catches, so a successful build is not evidence of a correct one.

Tests run against an in-memory workbook rather than Excel, so the full suite runs in a few seconds
without a host.

A single file, or a single test:

```bash
npx vitest run src/core/agent/compaction.test.ts
npx vitest run src/core/agent/compaction.test.ts -t "compacts at the budget"
```

## Building for production

```bash
npm run build     # → dist/
npm run validate  # validates manifest.xml
```

To build this documentation into `dist/documentation/` as well:

```bash
node scripts/build-docs.mjs
```

Run it after `npm run build`, never before. `vite build` empties `dist/`, and the page generators
write into it afterwards.

The public repo has no `build:pages` script. That one bundles the A.CRE landing page and legal page
generators, which are specific to our deployment. `build-docs.mjs` stands alone.

## Where things are

```text
apps/excel-addin/
├── src/
│   ├── core/         # Agent, tools, context, skills, MCP, storage
│   ├── ui/taskpane/  # React components
│   └── taskpane/     # Vite entry points. Components do not go here
├── skills/           # Bundled skills
├── scripts/          # Manifest, page, and asset builders
├── docs/             # This documentation, as Markdown
└── manifest.template.xml
```

More in [Architecture](/documentation/architecture/).

## Things that will trip you up

**The dev proxy is off by default.** `vite.config.ts` reads `EXCELENTE_DEV_PROXY_TARGET`, and it is
unset in the public repo so a fork running `npm run dev` never sends traffic at A.CRE's dev instance.
Leave it unset unless you have your own target.

**No `Excel.run` outside `core/tools/excel/` and `core/context/`.** All Office.js access goes through
the `ExcelDataSource` abstraction. That rule is what makes the tools testable in node.

**No direct `fetch` to OpenRouter outside `core/openrouter/`.** Model calls go through the client.

**No `window.confirm`, `alert`, or `prompt`.** Excel for Mac's task pane runs in WKWebView, which does
not implement native dialogs. `confirm()` returns false instantly and the guarded action silently
never runs. Use the in-pane `ConfirmButton` component.

**Bundled skills must be Markdown only, never executable JavaScript.** That is a Microsoft
Marketplace content policy, and it applies to anything you intend to list.

## Deploying it somewhere

See [Deploy your own instance](/documentation/deploy/).
