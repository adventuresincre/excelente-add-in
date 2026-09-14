import { describe, expect, it } from "vitest";
import { gateInactiveConnectors } from "./useAgentStream";

// Mirrors how the tool registry tags MCP tools: source "mcp:<server>",
// name "mcp_<server>__<tool>". Built-in tools carry no source.
const TOOLS = [
  { name: "inspect_workbook" },
  { name: "write_range" },
  { name: "mcp_cre-agents__search_skills", source: "mcp:cre-agents" },
  { name: "mcp_cre-agents__fetch_data", source: "mcp:cre-agents" },
  { name: "mcp_intel-hub__query_data", source: "mcp:intel-hub" },
];

describe("gateInactiveConnectors", () => {
  it("hides every MCP tool when no connector is active (built-ins survive)", () => {
    expect(gateInactiveConnectors(TOOLS, new Set())).toEqual(["inspect_workbook", "write_range"]);
  });

  it("exposes only the active connectors' tools", () => {
    expect(gateInactiveConnectors(TOOLS, new Set(["cre-agents"]))).toEqual([
      "inspect_workbook",
      "write_range",
      "mcp_cre-agents__search_skills",
      "mcp_cre-agents__fetch_data",
    ]);
  });

  it("never gates a non-MCP tool, even one with an unrelated source tag", () => {
    const tools = [{ name: "custom_tool", source: "builtin:x" }];
    expect(gateInactiveConnectors(tools, new Set())).toEqual(["custom_tool"]);
  });

  it("keeps all tools when every connector is active", () => {
    const result = gateInactiveConnectors(TOOLS, new Set(["cre-agents", "intel-hub"]));
    expect(result).toHaveLength(TOOLS.length);
    expect(result).toContain("mcp_intel-hub__query_data");
  });
});
