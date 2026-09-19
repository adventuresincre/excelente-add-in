---
title: Connect a model
description: Bring an OpenRouter key and pick from hundreds of models. Excelente does not ship a model of its own.
group: First steps
order: 2
---

<!-- edition:include connect-a-model/ways -->
Excelente does not ship its own model. You bring an OpenRouter key, and one key reaches hundreds of
models. The first screen you see is **Connect your model**; paste the key there and you are working.

## OpenRouter
<!-- /edition:include -->

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

<!-- edition:include connect-a-model/setup-flow -->
First launch walks three steps inside the Chat tab.

1. **Connect your model.** OpenRouter is the provider on offer today. Paste your key.
2. **Model.** Pick your primary model. See [Choosing a model](/documentation/choosing-a-model/).
3. **Connectors.** Turn on CRE Agents or the A.CRE Intelligence Hub if you use them. You can skip
   this and add them later under Capabilities.
<!-- /edition:include -->

The composer stays disabled until setup is complete, showing **Finish setup above to begin**.

## Switching later

<!-- edition:include connect-a-model/switching -->
Everything here is reversible from **Settings**: paste a different key over the old one, clear it,
or change the model. Clearing the key keeps your model choice and pauses chat until a key is back.
Nothing is locked in at setup.
<!-- /edition:include -->

## What about signing in with an A.CRE account

There is no A.CRE account sign-in for models. The only A.CRE sign-in you will meet is the CRE Agents
connector's own hosted login, which authorizes that connector's tools and has nothing to do with
which model runs your work. See [CRE Agents and the Intelligence Hub](/documentation/acre-connectors/).
