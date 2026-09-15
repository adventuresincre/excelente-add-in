---
title: Conversation history
description: Every conversation auto-saves against its workbook, and you can pick any of them back up.
group: Working in Excel
order: 5
---

The **History** tab lists saved conversations for the workbook you have open, newest first.

## What gets saved

Everything, automatically. Conversations save as you chat, so there is no button to press and nothing
to lose if Excel closes unexpectedly.

Each row shows the conversation title, when it happened (the time if it was today, otherwise the
date), and how many messages it holds. The active conversation is marked, and its tooltip reads
**Active conversation** rather than **Resume this conversation**.

## Scoped to the workbook

History is per workbook. Open a different file and you see that file's conversations. This is almost
always what you want: the conversation about the Marigold Flats acquisition belongs with Marigold
Flats, not mixed into a list with everything else you have underwritten this quarter.

## Resuming

Click any row to pick that conversation back up. The full transcript comes back and you can keep
going.

The undo stack belongs to a conversation, so resuming an old one restores its undo history too.
Whether those reverts still make sense depends on what you have done to the workbook since.

## Deleting

The ✕ on a row deletes that conversation, with a confirm step in the pane:

> Delete "Five-year cash flow"? — **Delete**

The confirm renders inside the panel rather than as a browser dialog. Excel for Mac's task pane does
not implement native dialogs, and a `confirm()` there returns false instantly, which silently ate
delete actions until this was changed.

There is no rename. Titles are derived from the conversation and stored with it.

## Storage

Conversations live in IndexedDB in the add-in's own storage on your machine, keyed by a workbook id.
They are not uploaded anywhere.

Clearing your browser or Office cache clears them. So does uninstalling the add-in.

## Starting fresh

The **New chat** button in the header saves the current conversation to History and opens an empty
one. `/clear` resets the current conversation in place without saving it first. Use New chat when
there is any chance you want the conversation back.

## When history will not load

> Couldn't load saved chats for this workbook. The current conversation is still in this pane. Reload
> the add-in and try History again.

Close and reopen the task pane. The live conversation is held in the pane, so nothing in flight is
lost by reloading.
