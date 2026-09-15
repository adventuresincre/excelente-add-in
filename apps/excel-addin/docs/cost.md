---
title: Cost and limits
description: Who bills you, where to watch the running total, and what drives it up.
group: Models
order: 3
---

Excelente is free and has no in-app purchases. What you spend is what the model costs, billed by
OpenRouter directly.

## Who charges what

| | A.CRE Free | Your own key |
|---|---|---|
| Who pays | A.CRE | You |
| Billed by | Nobody | OpenRouter, at its published rates |
| Limits | Shared, metered per network address | Whatever you set at OpenRouter |

CRE Edge does not resell model access and does not process payments. The relationship is between you
and OpenRouter.

## Watching the total

The header carries an info popover showing your running session cost. It also lists the active model,
the reasoning level when it is not Off, prompt cache statistics, the build version, and a **Reset
session cost** button.

`/cost` prints the same figure into the transcript:

> 💰 **Session cost** — No usage recorded yet this session.
>
> 💰 **Session cost** — $0.42m (sub-millidollar)
>
> 💰 **Session cost** — $0.1234

Sub-millidollar totals are shown in millidollars rather than rounded to `$0.00`, because "$0.00" on a
run that cost something tells you nothing.

On A.CRE Free the cost row carries an asterisk:

> \* Session cost paid for by A.CRE to help students and young professionals learn to use AI in Excel.

## What drives cost

In rough order of impact:

1. **Model choice.** Frontier models cost multiples of mid-tier ones. The **Best value** sort in the
   model explorer exists for this.
2. **Reasoning level.** Reasoning tokens bill as output. High on a long build adds up.
3. **Conversation length.** Every turn resends the conversation. A long session costs more per turn
   than a fresh one, which is a good reason to start a **New chat** when you change subject.
4. **Screenshots and PDFs.** Images are expensive. A 90-page PDF attached whole is a large bill for
   the four pages you needed.
5. **Sub-agents.** Each one is its own conversation. Worth it for verification, and not free.

## Prompt caching

Where the provider supports it, the stable head of your conversation (system prompt, skills,
conventions) is cached, so repeat turns bill a fraction for those tokens. The header popover shows
cache statistics so you can see it working.

Caching is the reason a long conversation in one workbook is cheaper per turn than the token counts
suggest. It is also why switching models mid-conversation costs a full re-read on the next turn.

## Controlling spend

- **Set a limit at OpenRouter.** Their dashboard has spend caps. Use one.
- **Match reasoning to the work.** Off for reading, High for building.
- **Start a new chat when the subject changes.** History keeps the old one.
- **Attach the pages you need**, not the whole document.
- **Turn off connectors you are not using.** Loaded tools are schema on every turn.
- **Enable the skills the job needs**, not all of them.
- **Point the Summary model at something cheap.** Compaction does not need frontier reasoning.

## A.CRE Free limits

A.CRE Free carries limits to keep shared usage sane, metered per network address, and A.CRE may
change the model or end the offer at any point. It is there so students, learners, and anyone curious
can see what the add-in actually does.

If you are using it for real work, add a key. You will get better models, control over reasoning,
independent Reviewer verification, and no shared ceiling.

## Nothing runs unattended

Excelente only calls a model in response to something you did. It does not poll, does not run in the
background, and does not spend anything while the pane sits open. Closing the pane mid-run stops the
run.
