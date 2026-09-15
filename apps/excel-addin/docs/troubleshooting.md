---
title: Troubleshooting
description: The failures people actually hit, what causes each one, and how to clear it.
group: Resources
order: 1
---

## The pane is blank, or says it will not load

**Outside Excel.** Opening `taskpane.html` in a browser gives you a notice instead of the add-in. The
agent has no workbook to read there, so it refuses to mount. Open it from the **excelente** button on
Excel's Home tab.

**Inside Excel and still blank.** Close the pane and reopen it. The pane caches its bundle, and a
reopen picks up the current one.

## Settings says a newer build is deployed

> A newer build (0.4.7+a1b2c3d) is deployed. Close and reopen the task pane to load it.

Exactly what it says. Close the pane and reopen it. Excel holds the old bundle until you do.

## The agent will not send anything

**Finish setup above to begin** means setup is incomplete. You need both a model selected and either
an OpenRouter key or A.CRE Free chosen. See [Connect a model](/documentation/connect-a-model/).

## Requests fail right after adding a key

Usually an OpenRouter account with no balance. The key authenticates and then the first call is
refused. Add credit at OpenRouter and try again.

If the key was copied with surrounding whitespace, clear it and paste again. An OpenRouter key starts
with `sk-or-`.

## It cannot see my screenshots or attached images

Your model is text-only. Excelente warns you:

> The active model doesn't accept image input. Switch to a vision-capable model (look for the `[vis]`
> tag in Settings) so attachments are actually read.

Two fixes: pick a model that reads images, or set a **Vision model** under **Settings** → **Advanced**
so screenshots are described by a second model and fed back as text. The second option costs an extra
call per image. See [Choosing a model](/documentation/choosing-a-model/).

## An attachment was rejected

Every limit message names the limit and the fix.

| Message | Fix |
|---|---|
| Over the 8.0MB limit for a single image | Resize or crop |
| Exceeds the 100-page limit | Split the PDF or attach the pages you need |
| Rendered N of M pages and hit 28.3MB | Send fewer pages, or remove image-heavy ones |
| Inserting worksheets needs Excel 2021 or Microsoft 365 | Use **Read as text** |
| File is too large to insert | Use **Read as text** |
| Page N could not be rendered on this version of Excel | Export the PDF at a smaller page size, or attach those pages as images |

See [Attachments](/documentation/attachments/).

## A connector shows an error

> Error · Failed to fetch

Usually one of three things:

1. **An expired session.** For CRE Agents, disconnect and connect again to redo the sign-in.
2. **A stale personal URL.** For the Intelligence Hub, get a current URL from your A.CRE product and
   re-add it.
3. **CORS or an unreachable host**, on a server you added yourself. The server has to allow your
   Excelente origin and speak Streamable HTTP over HTTPS.

Clicking an errored brand mark in the composer opens the connectors menu rather than toggling,
because a toggle does not fix an expired session.

## The agent stopped partway through

> Excelente paused after 200 steps, its limit for one message. Nothing it has done is lost.

Click **Continue Working**. To make it happen less often, set **How long the agent works** to
**Longer** under Advanced. See [Reasoning and agent pace](/documentation/reasoning-and-pace/).

## A write failed

Most often a protected sheet or a protected range. Excel rejects the write and the agent reports the
error. Unprotect the sheet, or ask the agent to write somewhere else.

A write to a range that is part of an array formula fails the same way. Excel will not let anything
overwrite part of an array.

## Undo says there is nothing to undo

The undo stack belongs to a conversation. A new conversation starts with an empty one, and `/clear`
empties it.

If the write you want to revert is not the newest, its card reads **superseded**. Revert the newer
writes first. See [Approvals and undo](/documentation/approvals-and-undo/).

## Excel's Ctrl+Z does not undo what the agent did

Office.js writes do not reliably enter Excel's own undo stack. Use Excelente's undo for anything the
agent did, and save before a large build if you want a file-level fallback.

## Confirmations do nothing on Mac

If you are running a build from before this was fixed, deleting a conversation or removing a
connector on Excel for Mac silently does nothing. WKWebView does not implement `window.confirm`, so
it returns false instantly and the guarded action never runs. Current builds use in-pane confirms.
Update to a current build.

## History will not load

> Couldn't load saved chats for this workbook. The current conversation is still in this pane. Reload
> the add-in and try History again.

Close and reopen the pane. Nothing in flight is lost.

## The model keeps ignoring my conventions

Put them in workbook memory rather than repeating them in chat. Run `/init`, review the draft on the
approval card, and approve it. From then on they reach the agent on every turn. See
[Workbook memory](/documentation/workbook-memory/).

For conventions that apply across every workbook, write a skill instead. See
[Write your own skill](/documentation/writing-skills/).

## It is doing the right work the wrong way

Switch to Plan mode and ask again. You get a numbered plan to argue with before anything moves, and
the plan traces what a change would touch downstream. See
[Plan mode and Work mode](/documentation/plan-and-work-modes/).

## Development: the dev server will not start

Port 3000 is occupied. `strictPort` is on, so Vite fails rather than moving to 3001, because the
sideloaded manifest points at 3000. Kill the stale process on 3000 and start again. See
[Build and sideload your own](/documentation/self-host/).

## Still stuck

Open an issue on [GitHub](https://github.com/adventuresincre/excelente-add-in/issues), or use
[/support](/support). Include the build id from **Settings** → **About**, your host (Windows, Mac, or
web), and the model you were running. Those three make most reports reproducible.
