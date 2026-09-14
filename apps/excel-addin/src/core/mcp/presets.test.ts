import { describe, expect, it } from "vitest";
import { isValidMcpServerName, isValidMcpServerUrl } from "../storage/mcp-store";
import { ACRE_MCP_PRESETS } from "./presets";

describe("ACRE_MCP_PRESETS", () => {
  it("includes the CRE Agents and Intelligence Hub one-click presets", () => {
    const byId = new Map(ACRE_MCP_PRESETS.map((p) => [p.id, p]));
    expect(byId.get("cre-agents")?.connect.kind).toBe("oauth");
    expect(byId.get("acre-intelligence-hub")?.connect.kind).toBe("personal-url");
  });

  it("CRE Agents points at the confirmed app.creagents.com endpoint", () => {
    const vic = ACRE_MCP_PRESETS.find((p) => p.id === "cre-agents");
    expect(vic?.connect).toEqual({
      kind: "oauth",
      url: "https://app.creagents.com/api/mcp",
    });
  });

  it("every preset passes the server-name validator; oauth URLs and help links are valid", () => {
    for (const preset of ACRE_MCP_PRESETS) {
      expect(isValidMcpServerName(preset.name), preset.name).toBe(true);
      if (preset.connect.kind === "oauth") {
        expect(isValidMcpServerUrl(preset.connect.url), preset.connect.url).toBe(true);
      } else {
        expect(preset.connect.links.length).toBeGreaterThan(0);
        for (const link of preset.connect.links) {
          expect(isValidMcpServerUrl(link.url), link.url).toBe(true);
        }
      }
    }
  });

  it("carries a short label and brand marks under public/assets/connectors", () => {
    for (const preset of ACRE_MCP_PRESETS) {
      expect(preset.shortLabel.length).toBeGreaterThanOrEqual(2);
      expect(preset.shortLabel.length).toBeLessThanOrEqual(4);
      expect(preset.icon.small).toMatch(/^\/assets\/connectors\/[a-z-]+\.svg$/);
      expect(preset.icon.large).toMatch(/^\/assets\/connectors\/[a-z-]+\.svg$/);
    }
  });

  it("Vic primes with a first-turn discover_tasks call; the Hub with a cached list_data catalog only", () => {
    const vic = ACRE_MCP_PRESETS.find((p) => p.id === "cre-agents")!;
    expect(vic.priming?.firstTurn?.tool).toBe("discover_tasks");
    expect(vic.priming?.catalog).toBeUndefined();
    expect(vic.priming?.firstTurn?.args({ userText: "x", sheetName: null })).toEqual({
      request: "x",
      environment: "excel",
    });

    const hub = ACRE_MCP_PRESETS.find((p) => p.id === "acre-intelligence-hub")!;
    expect(hub.priming?.firstTurn).toBeUndefined();
    expect(hub.priming?.catalog?.tool).toBe("list_data");
    expect(hub.priming?.catalog?.format("not json")).toBeNull();
    expect(hub.priming?.catalog?.format(JSON.stringify({ data_sources: [] }))).toBeNull();
  });

  it("preset ids and names are unique", () => {
    const ids = ACRE_MCP_PRESETS.map((p) => p.id);
    const names = ACRE_MCP_PRESETS.map((p) => p.name);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
  });
});
