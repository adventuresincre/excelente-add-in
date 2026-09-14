import type { ToolDef } from "../tools";
import type { McpClient, McpTool } from "./client";

/**
 * Tools from MCP servers get namespaced so two servers exposing a tool
 * named "search" don't collide. The model sees `mcp_${serverName}__${toolName}`.
 */
export function mcpToolName(serverName: string, toolName: string): string {
  return `mcp_${serverName}__${toolName}`;
}

/**
 * Source tag attached to MCP-derived ToolDefs so the registry can find +
 * remove all tools belonging to a given server when the user removes the
 * server.
 */
export const MCP_SOURCE_PREFIX = "mcp:";

export function mcpSourceTag(serverName: string): string {
  return `${MCP_SOURCE_PREFIX}${serverName}`;
}

/**
 * Providers accept function names matching `^[a-zA-Z0-9_-]{1,64}$`. Our
 * prefix eats part of that budget, so the server's own tool name gets what
 * remains.
 */
const MAX_WIRE_TOOL_NAME = 64;

/** Ceiling on a server-supplied description before it reaches the model. */
const MAX_TOOL_DESCRIPTION_CHARS = 1_024;

/**
 * True when a bridged name is safe to send to the provider. A server that
 * returns a tool named with spaces, unicode, or 80 characters would
 * otherwise poison the entire tools array — every chat request 400s and the
 * agent is dead for the session, not just for that one tool.
 */
export function isWireSafeToolName(name: string): boolean {
  return new RegExp(`^[a-zA-Z0-9_-]{1,${MAX_WIRE_TOOL_NAME}}$`).test(name);
}

/**
 * Convert a single MCP tool definition into an Excelente `ToolDef`.
 *
 * Permission mapping: a tool the server marks `readOnlyHint: true` runs at
 * `Read` (silent, like our own read tools). Everything else — including
 * tools with no annotations at all — runs at `Write` and routes through
 * the approval gate. MCP tools act on EXTERNAL systems (send a message,
 * create a record) with no undo stack, so the safe default is approval;
 * a server that wants silent reads declares the hint, which well-behaved
 * SDKs emit automatically.
 *
 * The hint is CORROBORATED, not taken at face value: a tool that also
 * declares `destructiveHint: true` is treated as Write regardless, since
 * those two claims contradict each other and the safe reading wins.
 *
 * Residual trust, stated plainly: a server that simply lies — marking a
 * side-effecting tool read-only and declaring nothing else — still gets
 * silent execution. Nothing in the protocol lets the client verify a
 * server's description of its own behavior. The real boundary is the user's
 * decision to connect the server at all, which is why connecting one is an
 * explicit action and why bridged tools are gated behind the per-user
 * active-connector toolbelt.
 */
export function bridgeMcpTool(
  client: McpClient,
  tool: McpTool
): ToolDef<Record<string, unknown>, unknown> {
  const annotations = tool.annotations;
  const claimsReadOnly = annotations?.readOnlyHint === true;
  const claimsDestructive = annotations?.destructiveHint === true;

  return {
    name: mcpToolName(client.serverName, tool.name),
    description: truncateDescription(
      tool.description ?? `${tool.name} (from MCP server "${client.serverName}")`
    ),
    inputSchema: normalizeInputSchema(tool.inputSchema),
    requiredPermission: claimsReadOnly && !claimsDestructive ? "Read" : "Write",
    source: mcpSourceTag(client.serverName),
    async execute(input) {
      const result = await client.callTool(tool.name, input);
      // Surface content blocks as a single serializable result. The model
      // expects either a string or a JSON-serializable value; text blocks
      // are most common, so join them. Non-text blocks pass through as
      // structured entries.
      const textParts: string[] = [];
      const structured: typeof result.content = [];
      for (const block of result.content ?? []) {
        if (block.type === "text" && typeof block.text === "string") {
          textParts.push(block.text);
        } else {
          structured.push(block);
        }
      }
      if (structured.length === 0) {
        // Pure text — return the joined string. Cheaper for the model
        // than reading a JSON-serialized object.
        const text = textParts.join("\n\n");
        if (result.isError) {
          // The MCP spec uses isError + textual error content. Surface as
          // a structured error so the orchestrator routes it like any
          // other tool failure.
          throw new Error(text || "MCP tool reported an error with no detail");
        }
        return text;
      }
      // Mixed content — pass through as structured.
      return {
        text: textParts.join("\n\n"),
        content: structured,
        isError: result.isError ?? false,
      };
    },
  };
}

/**
 * Some MCP servers return tools with `inputSchema: undefined` or with a
 * top-level schema that isn't shaped as `{ type: "object", properties: ... }`.
 * OpenRouter / OpenAI tool-use expects an object schema; coerce here so
 * downstream consumers don't have to defend against the variation.
 */
function normalizeInputSchema(schema: unknown): Record<string, unknown> {
  if (schema && typeof schema === "object" && !Array.isArray(schema)) {
    const s = schema as Record<string, unknown>;
    if (s.type === "object") {
      // Ensure `properties` exists — some servers omit it for no-arg tools.
      if (!s.properties) {
        return { ...s, properties: {} };
      }
      return s;
    }
  }
  // Fallback: empty object schema accepting no args.
  return { type: "object", properties: {}, additionalProperties: false };
}

/** Clamp a server-supplied description; it is injected into every request. */
function truncateDescription(description: string): string {
  if (description.length <= MAX_TOOL_DESCRIPTION_CHARS) return description;
  return `${description.slice(0, MAX_TOOL_DESCRIPTION_CHARS)}… [truncated]`;
}

/**
 * Convert every tool from an initialized MCP client. Errors during
 * individual tool conversion don't abort the whole batch — the bridge
 * skips unbridgeable tools and continues.
 *
 * A tool whose bridged name isn't wire-safe is dropped rather than passed
 * through: one malformed name from one server invalidates the whole tools
 * array on every subsequent request, so keeping it would trade a single
 * unusable tool for a completely unusable agent.
 */
export async function bridgeMcpClient(client: McpClient): Promise<ToolDef[]> {
  const tools = await client.listTools();
  const bridged: ToolDef[] = [];
  for (const t of tools) {
    const wireName = mcpToolName(client.serverName, t.name);
    if (!isWireSafeToolName(wireName)) {
      console.warn(
        `Skipping MCP tool "${t.name}" from server "${client.serverName}": ` +
          `bridged name "${wireName}" is not a valid provider function name.`
      );
      continue;
    }
    bridged.push(bridgeMcpTool(client, t));
  }
  return bridged;
}
