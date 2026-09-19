---
title: Reasoning and agent pace
description: How much the model thinks before it acts, and how long it works before checking in with you.
group: Models
order: 2
---

<!-- edition:include reasoning-and-pace/intro -->
Both settings live under **Settings** → **Advanced**, which appears once you have saved an OpenRouter
key.
<!-- /edition:include -->

## Reasoning

Four levels:

| Level | Meaning |
|---|---|
| **Off** | No reasoning tokens |
| **Low** | Light reasoning, low cost |
| **Medium** | Balanced |
| **High** | Deep reasoning, higher cost and latency |

Reasoning tokens are billed as output. High on a frontier model on a long build is a real number, and
it is often worth it, because a wrong model rebuilt twice costs more than thinking once.

### Levels your model does not have

Stops that do not exist on the active model are shown but disabled rather than hidden, so the control
does not change shape when you switch models. Tooltips explain what happened:

> This model always reasons. It cannot be turned off.
>
> Same as Low on this model, both ask for "minimal".

Some models reason unconditionally. For those, **Off** asks for the least the provider will do, and a
hint says so:

> This model always reasons. Its provider doesn't allow it to be turned off. **Off** asks for the
> least it will do (`minimal`).

When the mapping is not one to one, you get the actual values:

> On this model: Low = `minimal` · Medium = `low` · High = `medium`

That line exists so you can reason about cost. "High" on one model can be a lower effort request than
"Medium" on another.

### Choosing a level

| Work | Level |
|---|---|
| Reading, explaining, tracing formulas | Off or Low |
| Normalizing data, standardizing a rent roll | Low or Medium |
| Building a model, sizing debt, auditing | Medium |
| A build you will put in front of a committee | High |

<!-- edition:include reasoning-and-pace/medium -->
Medium is the sensible default.
<!-- /edition:include -->

## How long the agent works

> Excelente pauses to check in with you after a stretch of work. Pick how much it does before
> pausing. You can always click "Continue Working" to keep it going.

| Setting | Turns | When to use it |
|---|---|---|
| **Shorter** | 50 | You are learning what it does with your prompts, or working on something delicate |
| **Balanced** | 100 | A moderate stretch |
| **Longer** | 200 | The default. Large builds finish without interruption |

A turn is one round trip to the model, so a build that writes eight ranges and takes four screenshots
has burned a dozen or more before it speaks.

Reaching the limit stops nothing permanently:

> Excelente paused after 200 steps, its limit for one message. Nothing it has done is lost.

**Continue Working** resumes. Or type something else and redirect instead.

The same prompt appears when a run ends with items still open on the agent's checklist, worded to say
how many.

<!-- edition:include reasoning-and-pace/hosted-turns -->
<!-- /edition:include -->

## Interaction between the two

They pull in opposite directions on cost. High reasoning with a Longer pace is the expensive corner,
and it is the right corner for a real build. Off with Shorter is the cheap corner, and it is right
for exploring an unfamiliar workbook.

Watch the session cost in the header popover for the first few real tasks and you will find your own
setting quickly. See [Cost and limits](/documentation/cost/).
