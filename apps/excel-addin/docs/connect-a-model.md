---
title: Connect a model
description: Start on A.CRE Free with no account at all, or bring an OpenRouter key and pick from hundreds of models.
group: First steps
order: 2
---

Excelente does not ship its own model. You choose one, and there are two ways to get connected.

| | A.CRE Free | Your own OpenRouter key |
|---|---|---|
| Account needed | None | An OpenRouter account |
| Who pays | A.CRE | You, billed by OpenRouter |
| Model choice | One model, selected by A.CRE | Hundreds, switchable mid-conversation |
| Reasoning control | Fixed at medium | Off, Low, Medium, High |
| Sub-agent and vision model overrides | Not available | Available |
| Good for | Trying it out, students, learners | Everything else |

## A.CRE Free

Pick **Use A.CRE Free, no key or sign-in** in the setup flow and you are working immediately. No
email, no key, no account.

A.CRE pays for a capable lower-cost model so students, learners, and anyone curious can see what an
AI agent inside Excel actually does. It carries limits to keep shared usage sane, and A.CRE may
change the model or end the offer at any point. Your workbook is sent to the model to do the work
and is not used to train it.

On A.CRE Free every role runs on the same A.CRE-selected model: the primary agent, sub-agents, the
Reviewer, and vision. Reasoning is fixed at medium, and the Advanced settings section stays hidden,
since none of its controls apply.

The model behind A.CRE Free is not baked into the add-in. Excelente asks the proxy which model is
live and shows you the name, so the label reads something like **A.CRE Free (GLM 5.3 Flash)** and
stays right when A.CRE repoints it.

When you are ready for better work, add a key. Excelente will say so too: the Settings panel nudges
you toward one once you are past experimenting.

## Your own OpenRouter key

OpenRouter is a single API in front of most commercial models, so one key reaches Claude, GPT,
Gemini, Grok, Llama, DeepSeek, Qwen, Kimi, and GLM. You pay OpenRouter directly at its published
rates. CRE Edge does not resell or process those payments.

1. Open [openrouter.ai/keys](https://openrouter.ai/keys) and create an account.
2. Click **Create Key** and copy it.
3. Paste it into Excelente and click **Save**.

Add credit to your OpenRouter account before you start. A key with no balance authenticates fine and
then fails on the first call, which reads like a broken add-in.

### Where the key is stored

Your key goes into `OfficeRuntime.storage`, Office's per-user add-in storage on your own machine. It
is used to authenticate directly to OpenRouter and is never sent to CRE Edge. Nothing about BYOK
mode routes through our servers.

It is stored in plaintext, which is what that storage offers. On a shared machine, treat it the way
you would any other saved credential, and use a key with a spend limit set at OpenRouter.

To change or remove it: **Settings** → **OpenRouter API key** → **Clear**, or paste a replacement
over it.

## The setup flow

First launch walks four steps inside the Chat tab.

1. **Start.** Choose an OpenRouter key or A.CRE Free. Choosing A.CRE Free shows a short disclosure
   about the shared limits before it continues.
2. **Key.** Paste your OpenRouter key. Skipped on A.CRE Free.
3. **Model.** Pick your primary model. See [Choosing a model](/documentation/choosing-a-model/).
4. **Connectors.** Turn on CRE Agents or the A.CRE Intelligence Hub if you use them. You can skip
   this and add them later under Capabilities.

The composer stays disabled until setup is complete, showing **Finish setup above to begin**.

## Switching later

Everything here is reversible from **Settings**. Add a key on top of A.CRE Free and the Advanced
section appears. Clear your key and A.CRE Free is offered again. Nothing is locked in at setup.

## What about signing in with an A.CRE account

There is no A.CRE account sign-in for models. The only A.CRE sign-in you will meet is the CRE Agents
connector's own hosted login, which authorizes that connector's tools and has nothing to do with
which model runs your work. See [CRE Agents and the Intelligence Hub](/documentation/acre-connectors/).
