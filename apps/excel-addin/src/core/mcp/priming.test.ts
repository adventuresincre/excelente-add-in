import { describe, expect, it, vi } from "vitest";
import { createToolRegistry } from "../tools/registry";
import type { ToolContext, ToolDef } from "../tools/types";
import type { McpServerStatus } from "./manager";
import { ACRE_MCP_PRESETS } from "./presets";
import {
  CATALOG_RETRY_MS,
  clampInstructions,
  CONNECTOR_INSTRUCTIONS_MAX_CHARS,
  presetForServer,
  primeConnectors,
  shouldRunFirstTurn,
  type PrimingCache,
} from "./priming";
import { mcpSourceTag, mcpToolName } from "./tool-bridge";

const ctx = { ds: {}, undoStack: {} } as unknown as ToolContext;

function status(name: string, state: McpServerStatus["state"], presetId?: string): McpServerStatus {
  return {
    config: { id: `id-${name}`, name, url: "https://x.example/mcp", addedAt: 1, presetId },
    state,
  };
}

function connected(name: string, instructions?: string, presetId?: string): McpServerStatus {
  return status(
    name,
    {
      status: "connected",
      serverId: `id-${name}`,
      toolCount: 3,
      ...(instructions ? { instructions } : {}),
    },
    presetId
  );
}

function bridged(
  server: string,
  tool: string,
  execute: ToolDef["execute"],
  requiredPermission: ToolDef["requiredPermission"] = "Read"
): ToolDef {
  return {
    name: mcpToolName(server, tool),
    description: tool,
    inputSchema: { type: "object", properties: {} },
    requiredPermission,
    source: mcpSourceTag(server),
    execute,
  };
}

const VIC_RESULT = JSON.stringify({
  candidates: [{ task_id: "a" }, { task_id: "b" }, { task_id: "c" }],
});
const HUB_CATALOG = JSON.stringify({
  data_sources: [
    { slug: "rates", displayName: "Rates", description: "Treasury + SOFR", common_endpoints: [{}] },
    { slug: "census", displayName: "Census", description: "ACS demographics" },
  ],
});

describe("presetForServer / shouldRunFirstTurn", () => {
  it("resolves a preset by persisted id first, then by server name", () => {
    expect(presetForServer(connected("renamed", undefined, "cre-agents"))?.id).toBe("cre-agents");
    expect(presetForServer(connected("acre-intelligence-hub"))?.id).toBe("acre-intelligence-hub");
    expect(presetForServer(connected("my-custom-server"))).toBeUndefined();
  });

  it("fires Vic's first-turn recipe on turn one and on later turns that name Vic", () => {
    const vic = ACRE_MCP_PRESETS.find((p) => p.id === "cre-agents");
    expect(shouldRunFirstTurn(vic, "Build a pro forma", true)).toBe(true);
    expect(shouldRunFirstTurn(vic, "Now format column B", false)).toBe(false);
    expect(shouldRunFirstTurn(vic, "Ask Vic for comps", false)).toBe(true);
    expect(shouldRunFirstTurn(vic, "use CRE Agents here", false)).toBe(true);
  });

  it("the Hub has no first-turn recipe (catalog-only by design)", () => {
    const hub = ACRE_MCP_PRESETS.find((p) => p.id === "acre-intelligence-hub");
    expect(shouldRunFirstTurn(hub, "anything", true)).toBe(false);
  });
});

describe("clampInstructions", () => {
  it("passes short text through trimmed and truncates long text with a marker", () => {
    expect(clampInstructions("  hi  ")).toBe("hi");
    const long = "x".repeat(CONNECTOR_INSTRUCTIONS_MAX_CHARS + 50);
    const out = clampInstructions(long);
    expect(out.length).toBeLessThan(long.length);
    expect(out.endsWith("… [truncated]")).toBe(true);
  });
});

describe("primeConnectors", () => {
  it("returns nothing when no active connector is connected", async () => {
    const registry = createToolRegistry([]);
    const out = await primeConnectors({
      registry,
      statuses: [
        connected("cre-agents"),
        status("acre-intelligence-hub", { status: "connecting", serverId: "x" }),
      ],
      activeConnectorNames: new Set(["acre-intelligence-hub"]), // Vic connected but off; Hub on but connecting
      userText: "hello",
      isFirstTurn: true,
      ctx,
      cache: new Map(),
    });
    expect(out).toEqual({ promptSection: null, seeded: [] });
  });

  it("seeds Vic's discover_tasks on the first turn with the user text as the request", async () => {
    const discover = vi.fn().mockResolvedValue(VIC_RESULT);
    const registry = createToolRegistry([bridged("cre-agents", "discover_tasks", discover)]);
    const out = await primeConnectors({
      registry,
      statuses: [connected("cre-agents", "Call discover_tasks for CRE work.")],
      activeConnectorNames: new Set(["cre-agents"]),
      userText: "Underwrite the Austin deal",
      isFirstTurn: true,
      sheetName: "Rent Roll",
      ctx,
      cache: new Map(),
      now: () => 1000,
    });

    expect(discover).toHaveBeenCalledTimes(1);
    expect(discover.mock.calls[0][0]).toEqual({
      request: "Underwrite the Austin deal",
      environment: "excel",
      context: "Working in Excel; active sheet: Rent Roll",
    });
    expect(out.seeded).toHaveLength(1);
    const seeded = out.seeded[0];
    expect(seeded.toolName).toBe("mcp_cre-agents__discover_tasks");
    expect(seeded.callId).toMatch(/^call_auto_[a-z0-9_]+$/);
    expect(seeded.result).toBe(VIC_RESULT);
    expect(seeded.requiredPermission).toBe("Read");
    expect(seeded.summary).toBe("Asked Vic which tasks fit · 3 matches");

    // Prompt section: preamble, heading, wrapped instructions, harness rule.
    expect(out.promptSection).toContain("Connected services");
    expect(out.promptSection).toContain("### CRE Agents (Vic) — tools mcp_cre-agents__*");
    expect(out.promptSection).toContain(
      "<<<CONNECTOR_INSTRUCTIONS cre-agents (untrusted reference text)"
    );
    expect(out.promptSection).toContain("Call discover_tasks for CRE work.");
    expect(out.promptSection).toContain("CONNECTOR_INSTRUCTIONS>>>");
    expect(out.promptSection).toContain("Harness rule: Vic (CRE Agents) is on.");
  });

  it("does not re-run discover_tasks on later turns unless Vic is named", async () => {
    const discover = vi.fn().mockResolvedValue(VIC_RESULT);
    const registry = createToolRegistry([bridged("cre-agents", "discover_tasks", discover)]);
    const base = {
      registry,
      statuses: [connected("cre-agents")],
      activeConnectorNames: new Set(["cre-agents"]),
      ctx,
      cache: new Map() as PrimingCache,
    };
    const quiet = await primeConnectors({
      ...base,
      userText: "bold the header",
      isFirstTurn: false,
    });
    expect(discover).not.toHaveBeenCalled();
    expect(quiet.seeded).toEqual([]);
    // Still contributes the section (rule) even without a seeded call.
    expect(quiet.promptSection).toContain("Harness rule");

    const named = await primeConnectors({
      ...base,
      userText: "have Vic pull comps",
      isFirstTurn: false,
    });
    expect(discover).toHaveBeenCalledTimes(1);
    expect(named.seeded).toHaveLength(1);
  });

  it("fetches the Hub catalog once per session and injects the trimmed catalog every turn", async () => {
    const listData = vi.fn().mockResolvedValue(HUB_CATALOG);
    const registry = createToolRegistry([bridged("acre-intelligence-hub", "list_data", listData)]);
    const cache: PrimingCache = new Map();
    const input = {
      registry,
      statuses: [
        connected(
          "acre-intelligence-hub",
          "REQUIRED TOOL WORKFLOW: list_data → get_data_docs → query_data"
        ),
      ],
      activeConnectorNames: new Set(["acre-intelligence-hub"]),
      userText: "what's the labor picture in Travis County",
      isFirstTurn: true,
      ctx,
      cache,
    };
    const first = await primeConnectors(input);
    const second = await primeConnectors({ ...input, isFirstTurn: false });

    expect(listData).toHaveBeenCalledTimes(1);
    expect(first.seeded).toEqual([]); // catalog-only: no first-turn call
    for (const out of [first, second]) {
      expect(out.promptSection).toContain("### A.CRE Intelligence Hub (Hub)");
      expect(out.promptSection).toContain("Data catalog (from list_data");
      expect(out.promptSection).toContain("- rates (Rates): Treasury + SOFR");
      expect(out.promptSection).toContain("- census (Census): ACS demographics");
      expect(out.promptSection).not.toContain("common_endpoints");
      expect(out.promptSection).toContain("Harness rule: The A.CRE Intelligence Hub is on.");
    }
  });

  it("isolates a failing or slow connector: no seeded call, section still emitted, turn not blocked", async () => {
    const discover = vi.fn().mockRejectedValue(new Error("boom"));
    const listData = vi.fn(() => new Promise<never>(() => {})); // never resolves
    const registry = createToolRegistry([
      bridged("cre-agents", "discover_tasks", discover),
      bridged("acre-intelligence-hub", "list_data", listData),
    ]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await primeConnectors({
      registry,
      statuses: [connected("cre-agents"), connected("acre-intelligence-hub")],
      activeConnectorNames: new Set(["cre-agents", "acre-intelligence-hub"]),
      userText: "Screen Sunbelt metros",
      isFirstTurn: true,
      ctx,
      cache: new Map(),
      timeoutMs: 20,
    });
    warn.mockRestore();

    expect(out.seeded).toEqual([]);
    expect(out.promptSection).toContain("### CRE Agents (Vic)");
    expect(out.promptSection).toContain("### A.CRE Intelligence Hub (Hub)");
    expect(out.promptSection).not.toContain("Data catalog");
  });

  it("never runs a tool the server did not mark read-only (no approval gate outside the orchestrator)", async () => {
    const discover = vi.fn().mockResolvedValue(VIC_RESULT);
    const listData = vi.fn().mockResolvedValue(HUB_CATALOG);
    const registry = createToolRegistry([
      bridged("cre-agents", "discover_tasks", discover, "Write"),
      bridged("acre-intelligence-hub", "list_data", listData, "Write"),
    ]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await primeConnectors({
      registry,
      statuses: [connected("cre-agents"), connected("acre-intelligence-hub")],
      activeConnectorNames: new Set(["cre-agents", "acre-intelligence-hub"]),
      userText: "Underwrite this",
      isFirstTurn: true,
      ctx,
      cache: new Map(),
    });
    warn.mockRestore();
    expect(discover).not.toHaveBeenCalled();
    expect(listData).not.toHaveBeenCalled();
    expect(out.seeded).toEqual([]);
    expect(out.promptSection).toContain("Harness rule"); // rules still apply
  });

  it("memoises a failed catalog fetch per server id and retries only after CATALOG_RETRY_MS", async () => {
    const listData = vi.fn().mockRejectedValue(new Error("503"));
    const registry = createToolRegistry([bridged("acre-intelligence-hub", "list_data", listData)]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cache: PrimingCache = new Map();
    let clock = 1_000_000;
    const input = {
      registry,
      statuses: [connected("acre-intelligence-hub")],
      activeConnectorNames: new Set(["acre-intelligence-hub"]),
      userText: "rates?",
      isFirstTurn: false,
      ctx,
      cache,
      now: () => clock,
    };
    await primeConnectors(input);
    await primeConnectors(input);
    expect(listData).toHaveBeenCalledTimes(1); // second send did not re-await the broken server
    expect(cache.get("id-acre-intelligence-hub")).toEqual({ catalog: null, fetchedAt: 1_000_000 });

    clock += CATALOG_RETRY_MS + 1;
    listData.mockResolvedValue(HUB_CATALOG);
    const recovered = await primeConnectors(input);
    expect(listData).toHaveBeenCalledTimes(2);
    expect(recovered.promptSection).toContain("- rates (Rates)");
    warn.mockRestore();

    // A different server under the same preset name gets its own entry.
    const other = connected("acre-intelligence-hub");
    other.config = { ...other.config, id: "id-other" };
    await primeConnectors({ ...input, statuses: [other] });
    expect(listData).toHaveBeenCalledTimes(3);
  });

  it("includes a custom (non-preset) server's instructions and skips one with none", async () => {
    const registry = createToolRegistry([]);
    const out = await primeConnectors({
      registry,
      statuses: [
        connected("comps-db", "Always call search before get."),
        connected("silent-server"),
      ],
      activeConnectorNames: new Set(["comps-db", "silent-server"]),
      userText: "hi",
      isFirstTurn: true,
      ctx,
      cache: new Map(),
    });
    expect(out.promptSection).toContain("### comps-db — tools mcp_comps-db__*");
    expect(out.promptSection).toContain("Always call search before get.");
    expect(out.promptSection).not.toContain("silent-server");
    expect(out.seeded).toEqual([]);
  });

  it("caps oversized server instructions", async () => {
    const registry = createToolRegistry([]);
    const out = await primeConnectors({
      registry,
      statuses: [connected("verbose", "y".repeat(CONNECTOR_INSTRUCTIONS_MAX_CHARS * 3))],
      activeConnectorNames: new Set(["verbose"]),
      userText: "hi",
      isFirstTurn: true,
      ctx,
      cache: new Map(),
    });
    expect(out.promptSection).toContain("… [truncated]");
    expect(out.promptSection!.length).toBeLessThan(CONNECTOR_INSTRUCTIONS_MAX_CHARS * 2);
  });
});
