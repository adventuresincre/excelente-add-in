---
title: Deploy your own instance
description: Host the built bundle, generate a manifest with your own add-in id, and distribute it.
group: Run it yourself
order: 2
---

An Office add-in is static files plus a manifest. Host the files anywhere that serves HTTPS, point a
manifest at them, and distribute the manifest.

## Build

```bash
cd apps/excel-addin
npm run build
node scripts/build-docs.mjs   # optional: ships this documentation at /documentation
```

`dist/` now holds `taskpane.html`, `commands.html`, `assets/`, and whatever pages you generated into
it. That directory is the whole deployment.

## Host it

Any HTTPS static host works. Requirements:

- **A real certificate.** Excel will not load a task pane from an untrusted origin.
- **Directory indexes.** Pages like `/privacy` and `/documentation/install` are
  `<dir>/index.html`. On nginx that is `index index.html;`. On most static hosts it is the default.
- **No caching on HTML.** Serve `.html` with `no-store, must-revalidate`. Without it, users keep
  running a stale bundle after you deploy and you spend your week debugging code that is not running.
- **Long caching on assets.** `/assets/` can safely take `expires 1y; immutable`, since Vite
  fingerprints those filenames.

## Generate your manifest

You need your own add-in id. **Do not reuse Excelente's.** The GUID is the add-in's identity to
Microsoft, and reusing it collides with the published listing.

Generate one:

```bash
node -e "console.log(crypto.randomUUID())"
```

Then build the manifest:

```bash
EXCELENTE_BASE_URL=https://excel.yourdomain.com \
EXCELENTE_ADDIN_ID=<your-guid> \
EXCELENTE_DISPLAY_NAME="Your Add-in Name" \
  npm run manifest:prod
```

That writes `dist/manifest.xml`. The builder refuses a non-localhost base URL without an explicit id
and display name, so a production manifest cannot accidentally ship with dev identity.

`manifest.env.example` documents each variable. `BASE_URL` is the host serving `taskpane.html`,
`commands.html`, and `/assets/`; a trailing slash is stripped for you.

## Distributing it

| Path | How | Good for |
|---|---|---|
| **Sideload** | Share `manifest.xml` and have people add it via Excel's trust center or a shared folder catalog | A handful of users |
| **Microsoft 365 admin center** | Integrated Apps, upload a custom app | An organization |
| **Microsoft Marketplace** | Partner Center submission and review | Public distribution |

Microsoft 365 admin deployment is the usual answer for a firm. It pushes the add-in to users without
asking each of them to sideload.

## If you add a connector domain

Any host an OAuth sign-in dialog opens against has to be listed in `<AppDomains>` in
`manifest.template.xml`. A domain that is not there gets blocked and the sign-in window fails with
no obvious cause.

## Before you publish anything

Excelente's Apache 2.0 licence covers the code. Two things it does not cover:

**The marks.** "Excelente", "A.CRE", "Adventures in CRE", "AI.Edge", and "CRE Edge", with their logos
and wordmarks, are trademarks of CRE Edge, LLC. Apache 2.0 Section 6 grants no trademark rights. A
fork needs its own name and its own brand assets. See `TRADEMARKS.md` in the repository.

**Nine of the bundled skills.** `acquisition-model`, `comp-analysis`, `development-pro-forma`,
`loan-sizing`, `quick-underwrite`, `rent-roll-standardizer`, `revenue-tie-out`,
`sensitivity-analysis`, and `t12-analyzer` incorporate methodology proprietary to CRE Agents, Inc.,
used by Excelente under written permission that does not extend to redistribution.

They are already absent from the public repository, so a clean clone has nothing to strip. If you
obtained them another way, do not ship them. The five skills the public repo does carry are wholly
ours and licensed CC BY 4.0. See [Bundled skills](/documentation/bundled-skills/).

## Two instances are worth the trouble

Excelente itself runs a development instance and a production instance with different add-in ids and
different hosts, and promotes a tested commit from one to the other rather than deploying a branch.

Two ids means the two can be installed side by side in the same Excel, and it means testing never
touches the add-in your users have. If you are shipping to anyone but yourself, do the same.

Verify which instance you are in from **Settings** → **About**, which shows the build id and marks a
development build.

## A deployment check worth automating

After uploading, request each of these and fail the deploy on anything that is not a 200:

```text
/taskpane.html
/manifest.xml
/assets/icon-32.png
/privacy/
/terms/
/support/
/documentation/
```

A deploy that silently half-succeeded is the failure mode this catches, and it catches it before your
users do.
