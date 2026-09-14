# `core/mcp` — MCP client, manager, tool bridge, presets, priming

Browser-side Model Context Protocol integration. JSON-RPC 2.0 over HTTP POST
(Streamable HTTP); no stdio. Bridged tools are tagged `source: "mcp:<name>"`
so the tool registry can bulk-remove them on disconnect.

## Public interface (`index.ts`)

| Export | Role |
|---|---|
| `createMcpClient({ serverName, url, getAuthToken?, fetchImpl? })` | One server connection: `initialize()`, `listTools()`, `callTool()`. After `initialize()`, `client.instructions` holds the server's own usage guidance from the handshake (`null` when absent). |
| `bridgeMcpClient(client)` / `bridgeMcpTool(client, tool)` | Convert MCP tools into Excelente `ToolDef`s named `mcp_<server>__<tool>`; `readOnlyHint` → Read, everything else → Write. |
| `mcpToolName`, `mcpSourceTag`, `MCP_SOURCE_PREFIX` | Naming helpers shared with the UI gate (`gateInactiveConnectors`). |
| `createMcpManager({ store, registry, getAuthToken? })` | Connection lifecycle for every persisted server. `getStatuses()` / `subscribe()` expose `McpServerStatus` rows; a connected state carries `toolCount` and `instructions`. |
| `ACRE_MCP_PRESETS` | The one-click A.CRE presets (CRE Agents / Vic, A.CRE Intelligence Hub). Each has `id`, `name`, `label`, `shortLabel`, `description`, `icon`, `connect`, and an optional `priming` recipe. |
| `primeConnectors(input)` | Harness-side auto-invoke for active, connected servers (below). |
| `presetForServer`, `shouldRunFirstTurn`, `clampInstructions` | Pure helpers used by priming and the composer's brand toggles. |
| OAuth + Office dialog helpers | `runMcpOAuthFlow`, `refreshOAuthTokens`, `mcpRequiresAuth`, `openAuthWindowViaOfficeDialog`, … |

## Priming (`priming.ts`)

Once a user has a connector installed **and** toggled on, they expect the
agent to use it without being asked. `primeConnectors` does that in two
layers, chosen for token cost:

1. **Prompt section, every turn (cached).** For each active + connected server:
   the server's `instructions` inside `<<<CONNECTOR_INSTRUCTIONS … >>>` markers
   (preamble says it is reference text, never a permission grant; capped at
   `CONNECTOR_INSTRUCTIONS_MAX_CHARS`), then the preset's `rule`, then — if the
   preset declares a `catalog` — the formatted result of that tool, fetched
   once per session and memoised in the caller's `PrimingCache`. The Hub uses
   this for `list_data`, trimmed to one line per data source.
2. **First-turn call, once per conversation.** If the preset declares
   `firstTurn`, the harness executes that bridged tool with the user's message
   (Vic: `discover_tasks` with `request`, `environment: "excel"`, active sheet
   as `context`) and returns a `SeededToolCall`. `useAgentStream` places it in
   the transcript as a `ToolItem{ auto: true }` and on the wire as an
   assistant `tool_calls` + tool result — the same shape `itemsToMessages`
   replays, so one item serves rendering, persistence, and replay. The
   recipe's `mentions` regex re-fires it on later turns that name the service.

Every call has a per-call ceiling (`PRIMING_TIMEOUT_MS`) and fails soft: a slow
or broken server contributes nothing that turn. Catalog failures are memoised
per server id and retried only after `CATALOG_RETRY_MS`, so a broken Hub is
awaited once per five minutes, not once per send. Priming runs outside the
orchestrator's approval gate, so it only ever executes tools the server marked
read-only (`requiredPermission === "Read"`); anything else is left for the model
to call through the normal Write approval path.

Servers without a preset still get their `instructions` into the section;
servers with neither instructions nor a preset contribute nothing.

## Invariants

- Credentials never go over plaintext `http://` (loopback exempt).
- Server-authored text (tool descriptions, `instructions`, results) is untrusted
  and length-capped before it reaches a model.
- Registry mutation only through `addAll` / `removeBySource`.
- Priming recipes call only tools the server itself exposes, by bare name; the
  bridged name is resolved at run time, so a server missing the tool is a no-op.

Tests: `client.test.ts`, `manager.test.ts`, `tool-bridge.test.ts`,
`presets.test.ts`, `priming.test.ts`, `oauth.test.ts`.
