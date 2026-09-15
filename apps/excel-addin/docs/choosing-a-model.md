---
title: Choosing a model
description: How the model picker is organized, what the capability rank means, and which models can actually do the work.
group: Models
order: 1
---

With an OpenRouter key you can point Excelente at any model OpenRouter serves, and switch mid
conversation. Not every model can do this job.

## What the work requires

Excelente is a tool-use harness. A model that cannot call tools cannot read or write your workbook,
which rules it out entirely. Beyond that, two capabilities change the experience:

| Capability | Why it matters |
|---|---|
| **Tools** | Required. Without it the model cannot touch the workbook at all |
| **Vision** | The agent screenshots its work and reads the image back. A blind model routes screenshots to a separate vision model, which costs an extra call |
| **Reasoning** | Multi-step builds go better when the model can think before acting |

The details card under your selected model spells each one out in plain language, for example
"reads and writes your workbook", or "cannot see screenshots; a separate vision model is used".

## How the picker is organized

| Group | Contents |
|---|---|
| A.CRE Free Model (For Students / Learners) | The A.CRE-funded model |
| Free Models (may train on your data) | OpenRouter's free tier |
| Top 10 · Capability (tools, reasoning, vision) | The most capable models that can do all three |
| Top 10 · Value (tools, reasoning, vision) | Capability against price, paid models only |
| Paid Models (Latest) · *Lab* | Released in the last 12 months, grouped by lab |
| Paid Models (Legacy) · *Lab* | Older, still available |

Labs, in the order they appear: Alibaba (Qwen), Anthropic (Claude), DeepSeek, Google (Gemini), Meta,
Moonshot AI (Kimi), OpenAI (GPT), xAI (Grok), Z.AI (GLM). Within each lab, most capable first.

Models registered more than 365 days ago are omitted rather than listed as Legacy. If you had one
selected it still shows, marked `(not in current list)`.

Each option reads `name · #rank · $in/$out`, with prices per million tokens. Free models are prefixed
🆓 and priced `free`.

## The capability rank

The `#number` after a model is its rank among the models in this list, from
[Artificial Analysis](https://artificialanalysis.ai), an independent benchmark. `#1` is the most
capable.

Two rankings run in parallel. **Capability** is the raw score. **Value** ranks capability against
price and covers paid models only. A model can be `#14 by capability` and `#2 by value`, which is
usually the interesting one.

Some models are not yet benchmarked. The explorer says how many.

## About the free tier

**Free Models (may train on your data)** is labelled that way because it is true. OpenRouter's free
endpoints are free because the provider gets something in return, and that something is usually your
prompts.

Your prompts here contain your workbook. Do not point the free tier at a live deal.

A.CRE Free is a different arrangement. A.CRE pays a provider, and your workbook is not used for
training.

## Compare all models

The **Compare all models** link opens a full-pane explorer.

Sort by **Most capable**, **Best value**, **Cheapest**, **Fastest**, or **Newest**. Filter to
**Free only**, **Can see screenshots**, or **Reasoning can be turned off**.

Each row shows the name, lab, rank and score with a bar, price, speed, and capability chips. The
explorer opens per role, titled **Compare models · Primary**, **· Subagent**, **· Vision**, or
**· Summary**, so picking a Summary model opens it sorted cheapest first.

## Role models

With a key, **Settings** → **Advanced** lets three roles diverge from your primary.

### Subagent model

> Powers subagents (Explore, Audit, Builder, Reviewer). Leave blank to use the primary. A different
> model, especially for Reviewer, gives more independent verification.

This is the highest-value setting in Advanced. A Reviewer running on the same model that built the
thing shares the reasoning that produced the error. A different lab's model does not, and catches
more.

### Vision model

> Receives images from screenshot tools and returns a text description so the primary's conversation
> stays text-only.

If your primary can see images, leaving this blank sends screenshots straight to it with no extra
call and no lost context. If it cannot, Excelente routes to a vision model automatically and tells
you which one. You will also see an alert:

> **This model can't see your workbook.** Screenshots will be sent to *model* instead, billed
> separately on your key.

### Summary model

Used when a conversation passes about 200,000 tokens and gets compacted. It runs once per long
session and does not need frontier reasoning, so a cheap model here meaningfully lowers the cost of
long work.

## On A.CRE Free

Every role runs the A.CRE-selected model: primary, sub-agents, Reviewer, and vision. Advanced stays
hidden.

With a key added alongside, you can override individual roles. Those overrides run on your key and
are billed to you.

## A reasonable starting point

- A frontier model from any major lab as your primary, one with tools, reasoning, and vision.
- A different lab's model as your Subagent model, so the Reviewer is genuinely independent.
- A cheap model as your Summary model.
- Reasoning at Medium, raised to High for a build you care about.

Then use **Best value** in the explorer when the bill gets your attention.
