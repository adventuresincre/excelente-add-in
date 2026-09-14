import type { ToolDef, ToolRegistry } from "./types";
import type { ToolDef as WireToolDef } from "../openrouter";

export function createToolRegistry(tools: ToolDef[]): ToolRegistry {
  // Mutable internal state — addAll / removeBySource splice through these.
  // The registry exposes the same instance to consumers (orchestrator,
  // useAgentStream), so adding MCP tools after mount becomes visible to
  // the next chat request without recreating the registry.
  const byName = new Map<string, ToolDef>();
  const ordered: ToolDef[] = [];

  function register(tool: ToolDef): void {
    if (byName.has(tool.name)) {
      throw new Error(`Duplicate tool: ${tool.name}`);
    }
    if (tool.requiredPermission !== "Read" && tool.requiredPermission !== "Write") {
      throw new Error(
        `Tool "${tool.name}" must declare requiredPermission as "Read" or "Write" (got ${JSON.stringify(tool.requiredPermission)}).`
      );
    }
    byName.set(tool.name, tool);
    ordered.push(tool);
  }

  for (const tool of tools) register(tool);

  return {
    all() {
      return ordered;
    },
    get(name) {
      return byName.get(name);
    },
    filter(allowlist) {
      const allow = new Set(allowlist);
      return ordered.filter((t) => allow.has(t.name));
    },
    toWireFormat(allowlist) {
      const list = allowlist ? this.filter(allowlist) : ordered;
      return list.map(toWireTool);
    },
    addAll(newTools) {
      for (const tool of newTools) register(tool);
    },
    removeBySource(source) {
      for (let i = ordered.length - 1; i >= 0; i--) {
        if (ordered[i].source === source) {
          byName.delete(ordered[i].name);
          ordered.splice(i, 1);
        }
      }
    },
  };
}

function toWireTool(t: ToolDef): WireToolDef {
  return {
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  };
}
