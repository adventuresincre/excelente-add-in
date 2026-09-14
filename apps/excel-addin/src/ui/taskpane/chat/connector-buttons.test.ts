import { describe, expect, it } from "vitest";
import { ACRE_MCP_PRESETS, type McpServerStatus } from "../../../core/mcp";
import { connectorButtons } from "./connector-buttons";

function status(name: string, state: McpServerStatus["state"], presetId?: string): McpServerStatus {
  return {
    config: { id: `id-${name}`, name, url: "https://x.example/mcp", addedAt: 1, presetId },
    state,
  };
}
const ok = (name: string, presetId?: string) =>
  status(name, { status: "connected", serverId: `id-${name}`, toolCount: 2 }, presetId);

describe("connectorButtons", () => {
  it("renders no button for a preset that is not installed", () => {
    expect(connectorButtons([], new Set(["cre-agents"]), ACRE_MCP_PRESETS)).toEqual([]);
    const hubOnly = connectorButtons([ok("acre-intelligence-hub")], new Set(), ACRE_MCP_PRESETS);
    expect(hubOnly.map((b) => b.preset.id)).toEqual(["acre-intelligence-hub"]);
  });

  it("derives on / off / error from toolbelt membership and connection state", () => {
    const statuses = [
      ok("cre-agents"),
      status("acre-intelligence-hub", {
        status: "error",
        serverId: "h",
        message: "Sign-in expired.",
      }),
    ];
    const on = connectorButtons(
      statuses,
      new Set(["cre-agents", "acre-intelligence-hub"]),
      ACRE_MCP_PRESETS
    );
    expect(on.map((b) => [b.preset.shortLabel, b.state])).toEqual([
      ["Vic", "on"],
      ["Hub", "error"],
    ]);
    expect(on[0].label).toContain("Vic is consulted at the start of each new chat");
    expect(on[0].label).toContain("Click to turn off");
    expect(on[1].label).toContain("Sign-in expired.");
    expect(on[1].detail).toBe("Sign-in expired.");

    const off = connectorButtons(statuses, new Set(), ACRE_MCP_PRESETS);
    expect(off.map((b) => b.state)).toEqual(["off", "off"]);
    expect(off[0].label).toContain("Click to turn on");
  });

  it("shows a connecting server as 'connecting' (dimmed, still toggles), not as an error", () => {
    const statuses = [status("cre-agents", { status: "connecting", serverId: "v" })];
    const [btn] = connectorButtons(statuses, new Set(["cre-agents"]), ACRE_MCP_PRESETS);
    expect(btn.state).toBe("connecting");
    expect(btn.label).toContain("Connecting…");
    expect(btn.label).toContain("Click to turn off");
    expect(btn.detail).toBeUndefined();
  });

  it("matches a renamed server to its preset through presetId and keeps preset order", () => {
    const statuses = [ok("hub-personal", "acre-intelligence-hub"), ok("vic-work", "cre-agents")];
    const buttons = connectorButtons(statuses, new Set(["vic-work"]), ACRE_MCP_PRESETS);
    expect(buttons.map((b) => [b.preset.id, b.serverName, b.state])).toEqual([
      ["cre-agents", "vic-work", "on"],
      ["acre-intelligence-hub", "hub-personal", "off"],
    ]);
  });

  it("ignores custom servers that are not presets", () => {
    const buttons = connectorButtons([ok("my-comps")], new Set(["my-comps"]), ACRE_MCP_PRESETS);
    expect(buttons).toEqual([]);
  });
});
