---
title: Add your own MCP server
description: Point Excelente at any Streamable HTTP MCP server and its tools join the agent's toolbelt.
group: Connectors
order: 3
---

Any MCP server reachable over HTTPS can be added by name and URL.

## Adding one

**Capabilities** → **Connectors**, below the preset rows:

> Or connect any external connector (MCP). Each added connector appears in the agent's toolbelt.

Two fields:

| Field | Rules |
|---|---|
| **Name** | Lower-kebab: letters, digits, and hyphens. Forced lowercase as you type. Must be unique |
| **URL** | A valid `http://` or `https://` address |

Click **Add Connector**. Excelente handshakes immediately, and adding a server also turns it on.

Validation messages are specific:

> Name must be lower-kebab: letters, digits, and hyphens only (e.g. 'acre-hub').
>
> An MCP server named "acre-hub" already exists.
>
> URL must be a valid http:// or https:// address.

The name is how bridged tools are tagged internally, which is how Excelente bulk-removes them when
you disconnect. Pick something short and stable.

## Requirements for the server

- **Streamable HTTP.** JSON-RPC 2.0 over HTTP POST. Excelente cannot spawn a stdio server, because a
  task pane has no process to spawn.
- **Reachable over HTTPS from the browser.** The pane runs in a sandboxed web view. `localhost` is
  not reachable from Excel on the web, and a self-signed certificate will fail.
- **CORS configured** to allow the origin your Excelente instance is served from
  (`https://excelente.aiedge.ac` for the hosted build).
- **Authentication in the URL or handled by the server.** The add form takes a name and a URL.
  Servers that need a token generally issue a personal URL containing one. Excelente does not have a
  header field.

A local server can be exposed with a tunnel, but that URL is a credential and reaches whatever the
tunnel points at. Be deliberate about it.

## What you see once connected

Each row in the server list shows its name, URL, a load checkbox, and a status:

> Connecting…
>
> Connected · 12 tools
>
> Error · Failed to fetch

Errors are truncated at 60 characters. The most common causes are CORS, an expired credential in the
URL, or a server that is not speaking Streamable HTTP.

## Tool permissions

Excelente reads the annotations each tool declares. Read-only and non-destructive tools run silently;
everything else stops at the approval card. A server that does not annotate its tools gets the
cautious treatment, which means prompts.

## Turning tools off without disconnecting

The checkbox on each row controls whether that server's tools are loaded into the agent:

> Connecting a server also turns it on for chat. Turn one off to keep it connected without loading
> its tools.

Worth using. Every loaded tool is schema the model reads on every turn, so a server with forty tools
that you need twice a week is better left off between uses.

## Removing one

The ✕ on a row, with an in-pane confirm:

> Remove "acre-hub"? Its tools will be unregistered. — **Remove**

The confirm renders inside the panel because Excel for Mac's task pane does not implement native
browser dialogs.

## Storage

Server configurations live in IndexedDB on your machine and reconnect when the pane opens. They are
not synced between devices and are not sent anywhere.

## If you are running a fork

Preset connectors are declared in `src/core/mcp/presets.ts`, including their connect method, help
copy, and any priming recipe. Adding a preset there gives it a composer brand mark and an entry in
the setup flow. Any OAuth domain also has to be added to `<AppDomains>` in `manifest.template.xml` or
the sign-in dialog will be blocked. See [Architecture](/documentation/architecture/).
