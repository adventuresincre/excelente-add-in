# Trademark and brand policy

Excelente's source code is licensed under the [Apache License 2.0](LICENSE).
Its name and brand are not.

Section 6 of the Apache License 2.0 says:

> This License does not grant permission to use the trade names, trademarks,
> service marks, or product names of the Licensor, except as required for
> reasonable and customary use in describing the origin of the Work and
> reproducing the content of the NOTICE file.

This page says what that means in practice, so you can fork with confidence
instead of guessing.

## The marks

These names, and the logos and wordmarks that go with them, are trademarks of
CRE Edge, LLC or its affiliates:

- **Excelente**
- **A.CRE** and **Adventures in CRE**
- **AI.Edge**
- **CRE Edge**

**CRE Agents** is a trademark of CRE Agents, Inc. We hold no rights in it to
grant you, so treat it as fully off limits.

The brand asset files in this repository, including everything under
`apps/excel-addin/public/assets/` and `apps/excel-addin/public/assets/connectors/`,
are covered by this policy. They are not licensed under the Apache License 2.0
even though they sit inside an Apache-licensed repository.

## What you may do

Without asking us:

- **Fork, modify, and ship the code, including commercially.** That is the
  point of the Apache 2.0 grant and we are not going to be precious about it.
- **Say truthfully where your software came from.** "Built on Excelente," "a
  fork of Excelente," "derived from Excelente by CRE Edge, LLC" are all fine.
  Apache 2.0 Section 6 preserves this kind of nominative use.
- **Keep the NOTICE file intact**, which necessarily reproduces our name.
  Section 4(d) requires it and Section 6 permits it.
- **Reference the marks** in documentation, comparisons, articles, talks, and
  academic work.

## What you may not do

Without written permission from CRE Edge, LLC:

- **Name your fork or product "Excelente"**, or anything confusingly similar.
- **Ship our logos, wordmarks, icons, or brand assets** in a redistributed
  build. Replace them with your own first. Removing them is a normal part of
  forking and we do not read it as a hostile act.
- **Imply endorsement, affiliation, sponsorship, or certification** by CRE
  Edge, LLC, Adventures in CRE, or CRE Agents, Inc.
- **Use the marks in a domain name, app name, marketplace listing,
  organization name, or social handle** for your fork.
- **Use the CRE Agents marks or brand assets at all.** Those belong to CRE
  Agents, Inc.

## Checklist for a redistributable fork

Four things:

1. **Rename the product.** Change `name`, `author`, `repository`, and
   `homepage` in `apps/excel-addin/package.json`, and set your own
   `EXCELENTE_ADDIN_ID` (a fresh GUID) and `EXCELENTE_DISPLAY_NAME` when you
   generate a manifest. Two add-ins sharing a GUID cannot be installed side by
   side.
2. **Replace the artwork.** Everything under `apps/excel-addin/public/assets/`,
   including the connector marks.
3. **Keep LICENSE and NOTICE**, add your own copyright line for your changes,
   and mark modified files as Apache 2.0 Section 4(b) asks.
4. **Change the OpenRouter attribution header.** `HTTP-Referer` in
   `src/core/openrouter/client.ts` points at `excelente.aiedge.ac`, which is
   how OpenRouter attributes application traffic. Point it at your own site so
   your usage is reported as yours.

Then read [apps/excel-addin/skills/LICENSE.md](apps/excel-addin/skills/LICENSE.md),
because the bundled skills are not under the Apache license and carry their own
terms.

## Questions

Trademark questions, permission requests, and anything this page does not
answer: <https://www.adventuresincre.com/contact-us/>

We would much rather grant permission than argue about it. Just ask.
