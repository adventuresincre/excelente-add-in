---
title: CRE Agents and the Intelligence Hub
description: The two A.CRE connectors that ship preconfigured, what they add, and how to turn each one on.
group: Connectors
order: 2
---

Two connectors come preconfigured under **Capabilities** → **Connectors**. Both are A.CRE services,
and both require an account with that service. Neither is needed to use Excelente.

## CRE Agents (Vic)

> CRE Agents (Vic) equips your AI with the data, methods, and ready-to-run tasks to do CRE work
> better, faster, and cheaper.

Vic is CRE Agents' analyst persona. The connector gives Excelente access to its task library, its
methodology skills, and its market, property, demographic, and capital-markets data.

### Connecting

Click **Connect** on the CRE Agents row. The server runs its own hosted sign-in, an email address and
a code sent to it, in an Office dialog. Excelente never sees your CRE Agents credentials.

If the dialog cannot open you get:

> Sign-in windows aren't available in this host. Open Excelente inside Excel and try again.

That means the pane is running somewhere without dialog support. Open it in Excel proper.

### What it does automatically

On the first message of each conversation, Excelente calls Vic's `discover_tasks` for you and seeds
the result into the transcript as an `auto` tool line:

> · discover_tasks · **auto** — Asked Vic which tasks fit · 5 matches

That is Excelente checking whether a ready-made CRE Agents task covers what you asked for, before the
agent improvises one. It re-triggers later in a conversation when you mention Vic or CRE Agents by
name.

The composer tooltip says what state it is in:

> CRE Agents (Vic) · On. Vic is consulted at the start of each new chat. Click to turn off.

## A.CRE Intelligence Hub

> Primary-source CRE data — market, employment, climate risk, rates — plus expert analysis skills
> from A.CRE.

The Hub serves primary-source data: FRED economic series with percentile ranks and trend directions,
federal incentive overlays for any US address, physical climate and contamination risk, and analysis
skills built from A.CRE's article archive and the Accelerator curriculum.

### Connecting

The Hub uses a personal URL rather than a login.

> Paste your personal Intelligence Hub MCP URL — it connects automatically.

Your URL comes from whichever A.CRE product you subscribe to:

- [A.CRE Accelerator](https://app.adventuresincre.ai)
- [AI.Edge Pro](https://members.aiedge.ac)

Both links are on the connector row. Paste the URL into the field and click **Add**.

The URL is a credential. Treat it like one.

### What it does automatically

On connection, Excelente calls `list_data` once and caches the result, then includes that data
catalog in the system prompt every turn. The agent knows which datasets exist without spending a
call to look, so when you ask about employment growth in a submarket it reaches straight for the
right source.

> A.CRE Intelligence Hub (Hub) · On. Hub data is available to the agent on every turn.

## Using them together

They answer different questions. Vic supplies method and ready-to-run tasks. The Hub supplies
primary-source numbers. On a real underwrite you want both: Vic's rent roll methodology to
standardize the file, Hub data to sanity-check the market rent assumption.

Both are off by default and cost nothing when off.

## Turning them on and off

The brand marks in the composer toolbar toggle each one per conversation. Full color is on,
grayscale is off. A mark with a dot means the server errored, and clicking it opens the connectors
menu rather than toggling, since a toggle will not fix an expired session.

## During setup

The last step of first-run setup offers both:

- ☐ **I'm a CRE Agents client** — Vic, CRE methods and ready-to-run tasks.
- ☐ **I use the A.CRE Intelligence Hub** — Primary-source CRE data, rates, employment, risk.

Skipping it costs nothing. Both can be added later from Capabilities.

## Domains

The add-in manifest allowlists the domains these connectors sign in against: `app.creagents.com`,
`creagents.com`, `intelligence.adventuresincre.com`, `app.adventuresincre.ai`, and
`members.aiedge.ac`. A fork that repoints a connector at a different host has to add that host to its
own manifest. See [Deploy your own instance](/documentation/deploy/).
