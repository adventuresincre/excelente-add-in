---
title: Connectors overview
description: Bring outside tools and data into the agent's toolbelt over MCP.
group: Connectors
order: 1
---

A connector is an MCP server whose tools get bridged into Excelente's tool registry at runtime. Once
connected, the agent calls those tools exactly as it calls `write_range`, and the results land in the
same conversation.

Connectors live under **Capabilities** → **Connectors**.

## What MCP is

The Model Context Protocol is an open standard for exposing tools and data to an AI agent. Excelente
speaks browser JSON-RPC 2.0 over HTTP POST, the Streamable HTTP variant.

It cannot run stdio servers. A task pane is a sandboxed web view with no process to spawn, so a
connector has to be reachable over HTTPS. Anything running locally needs an HTTP bridge in front of
it.

## Connected versus loaded

Two independent states, and the distinction matters when you are managing cost.

| State | Meaning |
|---|---|
| **Connected** | Excelente has completed the handshake and knows the server's tools |
| **Loaded** (on) | Those tools are in the agent's toolbelt this conversation |

The checkbox on each server row controls loading. Turning a server off keeps it connected but drops
its tools from the toolbelt, which shortens the tool list the model reads on every turn.

> On. This connector's tools are loaded into the agent. Click to turn off.

Connectors also toggle from the composer's brand marks and from the **+** menu.

## Permissions for bridged tools

Excelente reads the annotations each MCP tool declares about itself:

- Read-only **and** not destructive becomes a **Read** tool, which runs silently.
- Everything else becomes a **Write** tool, which routes through the approval card.

The rule is deliberately conservative. A server that does not describe itself carefully gets treated
as capable of doing damage, and you see a prompt. See
[Approvals and undo](/documentation/approvals-and-undo/).

## Priming

Some connectors are worth consulting before you ask anything. A preset can declare a priming recipe
that Excelente runs for you:

- **Instructions.** The server's own `instructions` string joins the system prompt while the
  connector is on. It is treated as untrusted and capped in length.
- **Catalog.** A single call made once per connection whose result is cached and included each turn,
  so the agent knows what data is available without spending a call to find out.
- **First turn.** A call made automatically on the first message of a conversation, seeded into the
  transcript as an `auto` tool line.

`auto` lines are Excelente acting on your behalf, not the model requesting something. That badge is
there so the transcript never implies the model did something it did not.

Priming recipes are token-cheap and fail soft. A connector that is down slows nothing down.

## Connector states in the composer

Each installed preset gets a brand mark right of the Undo button:

| State | Mark | Meaning |
|---|---|---|
| On | Full color | Connected and in the toolbelt |
| Off | Grayscale | Connected, toggled out of the toolbelt |
| Connecting | Dimmed color | Handshake in flight, still clickable |
| Error | Grayscale with a dot | Toggled on but the server errored |

Clicking an **error** mark opens the connectors menu rather than toggling, because an expired session
is not something a toggle fixes.

Servers you add yourself do not get a composer mark. Manage them from the Connectors panel or the
**+** menu.

## Persistence

Connector configuration is stored in IndexedDB on your machine and reconnects when the pane opens.
Credentials from an OAuth flow are held by that server's own session, not by Excelente.

## What ships

Two A.CRE connectors come preconfigured. See
[CRE Agents and the Intelligence Hub](/documentation/acre-connectors/).

Any other MCP server can be added by name and URL. See
[Add your own MCP server](/documentation/custom-mcp-servers/).

## Trust

A connector's tools run inside your conversation with access to whatever the agent chooses to pass
them, and its `instructions` text reaches the system prompt. Connect servers you trust, the same way
you would think about installing a plugin. Excelente fences server-supplied instructions as reference
material rather than commands, and a write-classified tool still stops at your approval card, which
limits the blast radius without eliminating it.
