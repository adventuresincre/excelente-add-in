---
title: Privacy and data handling
description: What leaves your workbook, where it goes, and what is stored on your machine rather than ours.
group: Resources
order: 2
---

A summary of how Excelente handles your data. The [privacy policy](/privacy) governs, and where this
page and that document disagree, the policy is authoritative.

## The honest starting point

Excelente reads your workbook and sends what it needs to a language model. That is how it works.
Nothing here pretends otherwise, and the useful question is which content, to whom, and what is kept.

## What leaves your device

Only what the agent reads for the request in front of it. The context engine loads a workbook outline
first, then sheets, then ranges, so a prompt about one sheet does not ship the other nine. See
[What the agent can see](/documentation/workbook-context/).

Attachments go too: images, rendered PDF pages, and spreadsheet contents when you attach one.

## Where it goes

### With your own key

Excel to OpenRouter to the model provider you selected. **Nothing routes through CRE Edge.** There is
no server of ours in the path.

<!-- edition:include privacy-and-data/hosted-path -->
<!-- /edition:include -->

### What happens at OpenRouter and the model provider

Out of our hands and worth your attention. OpenRouter's handling is governed by
[its privacy policy](https://openrouter.ai/privacy), and each provider's by its own terms. OpenRouter
documents provider data-handling and training policies per model.

This is the reason the picker labels one group **Free Models (may train on your data)**. Those
endpoints are free because the provider gets your prompts. Your prompts contain your workbook. Do not
point them at a live deal.

## What is stored, and where

On your machine:

| Item | Where |
|---|---|
| Your OpenRouter API key | Office's per-user add-in storage. Sent only to OpenRouter over TLS, never logged, never sent to CRE Edge |
| Installed skills, saved conversations, MCP server configurations | IndexedDB, in the add-in's own storage |
| Workbook memory | A hidden `_excelente` sheet inside your own `.xlsx`, so it travels with the file rather than with us |

Your key is held in plaintext, which is what that storage offers. Your device's own security protects
it. On a shared machine, use a key with a spend limit, and revoke it if the device is lost.

## What we do not do

- We do not use your workbook content, prompts, attachments, or model outputs to train, fine-tune, or
  evaluate any model.
<!-- edition:include privacy-and-data/hosted-bullet -->
<!-- /edition:include -->

## Workbook memory travels with the file

Memory lives in the workbook. Send the `.xlsx` and your notes go with it. Keep anything confidential
out of it for that reason, and read it once when a file arrives with memory already written.

Memory arriving in someone else's file was written by them, so Excelente treats it as untrusted
reference data and fences it in the system prompt as information rather than as instructions. A
workbook cannot smuggle commands into your agent. See
[Workbook memory](/documentation/workbook-memory/).

## Connectors

A connector's tools run inside your conversation and receive whatever the agent passes them, and the
server's own `instructions` text reaches the system prompt, capped and treated as untrusted.

Connect servers you trust. A write-classified connector tool still stops at your approval card, which
bounds the damage without eliminating the consideration. See
[Connectors overview](/documentation/connectors/).

## Nothing runs unattended

Excelente calls a model only in response to something you did. It does not poll, does not run in the
background, and spends nothing while the pane sits open. Closing the pane mid-run stops the run.

## Removing your data

| To remove | Do this |
|---|---|
| Your API key | **Settings** → **OpenRouter API key** → **Clear** |
| One conversation | The ✕ on its row in History |
| All local data | Uninstall the add-in |
| Workbook memory | Unhide and delete the `_excelente` sheet |

For A.CRE-stored data, use the [Contact Us](https://www.adventuresincre.com/contact-us/) form. Verified requests are answered within thirty days.

## Also worth reading

- [Privacy policy](/privacy), the governing document
- [Terms of use](/terms)
- [License](/license.txt), Apache 2.0
