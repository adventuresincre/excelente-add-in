---
title: How the agent works
description: The loop between your prompt and a finished build, and the limits that keep it predictable.
group: Core concepts
order: 1
---

Excelente runs an agent loop, not a single request. Understanding the loop explains most of what you
see in the transcript, including why it pauses where it does.

## The loop

Every message you send starts a turn sequence:

1. Excelente sends your message, the conversation so far, and the list of available tools to your model.
2. The model streams back text, tool calls, or both.
3. Each tool call is checked against its permission level. Read tools run immediately. Write tools stop for your approval.
4. The tool result goes back into the conversation.
5. Repeat from step 2 until the model stops, or until the turn limit is reached.

A "turn" here is one round trip to the model, so a build that writes eight ranges and takes four
screenshots has burned at least a dozen turns before it says a word to you.

## What the agent brings to each turn

Alongside your message, the system prompt carries:

- The workbook outline, which sheets exist and roughly what is in them.
- A.CRE house modeling conventions, injected in full on every turn so formatting and formula
  discipline stay consistent without you asking.
- Any skills you have enabled, as short summaries the agent can expand on demand.
- Instructions from any connected MCP servers, plus their cached data catalogs.
- Workbook memory, if this workbook has any.

Everything else is pulled in only when the agent asks for it. See
[What the agent can see](/documentation/workbook-context/).

## How long it works before checking in

Excelente pauses after a stretch of work rather than running unbounded. You set the stretch under
**Settings** → **Advanced** → **How long the agent works**:

| Setting | Turns | Behavior |
|---|---|---|
| Shorter | 50 | Checks in sooner |
| Balanced | 100 | A moderate stretch |
| Longer | 200 | The default, does more before pausing |

When it pauses you get a notice and a **Continue Working** button:

> Excelente paused after 200 steps, its limit for one message. Nothing it has done is lost.

Clicking it picks up where it left off. You can also type what you want instead, which redirects
rather than resumes.

The same prompt appears when the agent stops with items still open on its checklist, worded to say
how many.

<!-- edition:include how-it-works/hosted-turns -->
<!-- /edition:include -->

## Steering a run

The composer stays live while the agent works. Anything you type and send is queued and delivered at
the agent's next tool boundary, so you can redirect mid-build without stopping it:

> ⏳ Use 4% growth instead — *queued, delivers at the next step*

Queued messages show a ✕ to withdraw them. If a run ends while something is still queued, the text
goes back into the composer rather than disappearing.

To stop outright, click the **Stop** button, which replaces Send while a run is in flight.

## Compaction on long conversations

Conversations have a working budget of roughly 200,000 tokens. Past that, Excelente folds the older
turns into a structured summary and carries on, which keeps a long session coherent instead of
truncating from the top.

Three tool results are never compacted away, because losing them mid-build causes the agent to
repeat expensive work or forget your workbook's rules: `load_skill`, `read_skill_resource`, and
`read_workbook_memory`.

Compaction runs once per long session. If you have a key, you can point it at a cheaper model under
**Settings** → **Advanced** → **Summary model**, since summarizing does not need frontier reasoning.

## Where verification fits

In Work mode the loop does not end when the last cell is written. The agent screenshots what it
built, reads the screenshot, then spawns a Reviewer sub-agent for an independent check. Only then
does it summarize. See [Sub-agents and verification](/documentation/subagents/).

## Reading the transcript

| Marker | Meaning |
|---|---|
| `·` | A read tool, run silently |
| `✎` | A write tool, which required your approval |
| **auto** badge | A connector call Excelente ran for you, not one the model asked for |
| Tasks card | The agent's working checklist |
| Plan pill | A submitted plan, click to open it |
| Change card | A completed write, with undo on the newest |
