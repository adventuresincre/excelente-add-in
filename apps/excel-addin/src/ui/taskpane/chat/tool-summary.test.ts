import { describe, it, expect } from "vitest";
import { summarizeTool, detailsFor, rawResult, parseMcpName, serverLabel } from "./tool-summary";
import type { ToolItem } from "./useAgentStream";

function tool(overrides: Partial<ToolItem>): ToolItem {
  return {
    kind: "tool",
    id: "i1",
    callId: "c1",
    toolName: "inspect_workbook",
    input: {},
    requiredPermission: "Read",
    status: "result",
    ...overrides,
  } as ToolItem;
}

describe("parseMcpName", () => {
  it("splits the bridge's namespaced form", () => {
    expect(parseMcpName("mcp_acme__classify")).toEqual({
      server: "acme",
      tool: "classify",
    });
  });

  it("keeps underscores inside the tool name", () => {
    expect(parseMcpName("mcp_vic__discover_tasks")).toEqual({
      server: "vic",
      tool: "discover_tasks",
    });
  });

  it("returns null for a built-in tool", () => {
    expect(parseMcpName("write_range")).toBeNull();
  });
});

describe("serverLabel", () => {
  it("uses the brand casing when we know the server", () => {
    expect(serverLabel("cre-agents")).toBe("CRE Agents");
  });

  it("title-cases an unknown, user-typed server rather than falling back to raw", () => {
    expect(serverLabel("my-expense-api")).toBe("My Expense Api");
  });
});

describe("summarizeTool — the outcome column", () => {
  it("reports how many skills a search found", () => {
    const out = summarizeTool(
      tool({
        toolName: "find_skill",
        input: { query: "chart of accounts" },
        result: { matches: [{ name: "t12-analyzer" }, { name: "revenue-tie-out" }] },
      })
    );
    expect(out.verb).toBe("Searched skills");
    expect(out.object).toBe("for “chart of accounts”");
    expect(out.outcome).toBe("2 found");
    expect(out.tone).toBe("neutral");
  });

  it("warns when a skill search found nothing, which used to look identical to success", () => {
    const out = summarizeTool(
      tool({ toolName: "find_skill", input: { query: "zzz" }, result: { matches: [] } })
    );
    expect(out.outcome).toBe("none found");
    expect(out.tone).toBe("warn");
  });

  it("counts a loaded skill's references", () => {
    const out = summarizeTool(
      tool({
        toolName: "load_skill",
        input: { name: "t12-analyzer" },
        result: { name: "t12-analyzer", body: "# T-12", resources: ["references/coa.md"] },
      })
    );
    expect(out.verb).toBe("Loaded skill");
    expect(out.object).toBe("t12-analyzer");
    expect(out.outcome).toBe("+ 1 reference");
  });

  it("names the sheet and address for a range read", () => {
    const out = summarizeTool(
      tool({
        input: { sheetName: "Ave 19 - T-12 Jan 2025", address: "a7:b175" },
        result: { address: "A7:B175", values: [[1], [2], [3]], formulas: [] },
      })
    );
    expect(out.verb).toBe("Read");
    expect(out.object).toBe("Ave 19 - T-12 Jan 2025 · A7:B175");
    expect(out.outcome).toBe("3 rows");
  });

  it("flags a clipped read instead of reporting a clean row count", () => {
    const out = summarizeTool(
      tool({
        input: { sheetName: "S", address: "A1:B2" },
        result: { values: [[1]], note: "stopped short of populated cells" },
      })
    );
    expect(out.outcome).toBe("1 row · clipped");
    expect(out.tone).toBe("warn");
  });

  it("reports a write as cells, not as a bare tick", () => {
    const out = summarizeTool(
      tool({
        toolName: "write_range",
        requiredPermission: "Write",
        input: { sheetName: "T12 Analysis", address: "A1" },
        result: { written: "T12 Analysis!A1:D40", rowCount: 40, columnCount: 4 },
      })
    );
    expect(out.outcome).toBe("40×4 cells");
  });

  it("calls a failed script failed", () => {
    const out = summarizeTool(
      tool({ toolName: "run_excel_script", result: { ok: false, error: "boom" } })
    );
    expect(out.outcome).toBe("script failed");
    expect(out.tone).toBe("bad");
  });

  it("surfaces status before any result parsing", () => {
    expect(summarizeTool(tool({ status: "pending" })).outcome).toBe("needs approval");
    expect(summarizeTool(tool({ status: "rejected" })).outcome).toBe("declined");
    expect(summarizeTool(tool({ status: "error", error: "nope" })).outcome).toBe("failed");
    expect(summarizeTool(tool({ status: "approved" })).outcome).toBeNull();
  });
});

describe("summarizeTool — MCP rows lead with the server", () => {
  const classifyResult = JSON.stringify({
    summary: {
      items: 110,
      ok: 110,
      failed: 0,
      needs_review: 6,
      est_cost_usd: 0.0006,
      elapsed_ms: 1902,
      model: "jev-latest",
    },
    results: [],
  });

  it("names the connector, not just the tool", () => {
    const out = summarizeTool(
      tool({
        toolName: "mcp_acme__classify",
        input: { items: new Array(110).fill("x") },
        result: classifyResult,
      })
    );
    expect(out.verb).toBe("Acme");
    expect(out.object).toBe("classify · 110 rows");
    expect(out.outcome).toBe("6 to review");
    expect(out.tone).toBe("warn");
  });

  it("says so when every row came back confident", () => {
    const out = summarizeTool(
      tool({
        toolName: "mcp_acme__classify",
        result: JSON.stringify({ summary: { items: 15, ok: 15, failed: 0, needs_review: 0 } }),
      })
    );
    expect(out.outcome).toBe("all confident");
    expect(out.tone).toBe("neutral");
  });

  it("distinguishes a wholly failed batch from a partial one", () => {
    const all = summarizeTool(
      tool({
        toolName: "mcp_acme__classify",
        result: JSON.stringify({ summary: { items: 2, ok: 0, failed: 2 } }),
      })
    );
    expect(all.outcome).toBe("all rows failed");
    expect(all.tone).toBe("bad");

    const some = summarizeTool(
      tool({
        toolName: "mcp_acme__classify",
        result: JSON.stringify({ summary: { items: 10, ok: 9, failed: 1 } }),
      })
    );
    expect(some.outcome).toBe("1 failed");
  });

  it("reports rows dropped against the batch deadline", () => {
    const out = summarizeTool(
      tool({
        toolName: "mcp_acme__classify",
        result: JSON.stringify({ summary: { items: 200, ok: 150, failed: 0, skipped: 50 } }),
      })
    );
    expect(out.outcome).toBe("50 skipped");
    expect(out.tone).toBe("warn");
  });

  it("prefers a harness-supplied summary for primed connector calls", () => {
    const out = summarizeTool(
      tool({
        toolName: "mcp_vic__discover_tasks",
        auto: true,
        summary: "Asked Vic which tasks fit · 5 matches",
        result: "{}",
      })
    );
    expect(out.verb).toBe("Vic");
    expect(out.object).toBe("Asked Vic which tasks fit · 5 matches");
  });
});

describe("detailsFor", () => {
  it("always ends with the real tool name and permission, for bug reports", () => {
    const rows = detailsFor(tool({ toolName: "write_range", requiredPermission: "Write" }));
    const last = rows[rows.length - 1];
    expect(last.label).toBe("Tool");
    expect(last.value).toBe("write_range · Write");
  });

  it("marks harness-run and reverted calls in that machine row", () => {
    const rows = detailsFor(tool({ auto: true, reverted: true }));
    expect(rows[rows.length - 1].value).toContain("run automatically");
    expect(rows[rows.length - 1].value).toContain("reverted");
  });

  it("lists which skills matched, so a reader can see what was considered", () => {
    const rows = detailsFor(
      tool({ toolName: "find_skill", result: { matches: [{ name: "a" }, { name: "b" }] } })
    );
    expect(rows[0]).toEqual({ label: "Matched, best first", value: "a · b" });
  });

  it("says plainly when nothing matched", () => {
    const rows = detailsFor(tool({ toolName: "find_skill", result: { matches: [] } }));
    expect(rows[0].value).toBe("nothing matched the query");
  });

  it("breaks out an MCP batch with its cost", () => {
    const rows = detailsFor(
      tool({
        toolName: "mcp_acme__classify",
        result: JSON.stringify({
          summary: {
            items: 110,
            ok: 110,
            needs_review: 6,
            est_cost_usd: 0.00061,
            elapsed_ms: 1902,
            model: "jev-latest",
          },
        }),
      })
    );
    expect(rows.find((r) => r.label === "Batch")?.value).toBe(
      "110 rows · 110 answered · 6 flagged"
    );
    // The model is part of the cost row on purpose: which model answered is
    // exactly what you need when a batch's judgments look off.
    expect(rows.find((r) => r.label === "Cost")?.value).toBe("$0.00061 · 1.9s · jev-latest");
  });

  it("carries an error message into the panel", () => {
    const rows = detailsFor(tool({ status: "error", error: "MCP server returned HTTP 401" }));
    expect(rows.find((r) => r.label === "Error")?.value).toContain("401");
  });

  it("clips a long string result rather than flooding the panel", () => {
    const rows = detailsFor(tool({ result: "x".repeat(5000) }));
    const returned = rows.find((r) => r.label === "Returned");
    expect(returned?.value.length).toBeLessThan(450);
    expect(returned?.value.endsWith("…")).toBe(true);
  });
});

describe("rawResult", () => {
  it("carries input and result together", () => {
    const raw = rawResult(tool({ input: { sheetName: "S" }, result: { ok: true } })) ?? "";
    expect(JSON.parse(raw)).toEqual({ input: { sheetName: "S" }, result: { ok: true } });
  });

  it("truncates a huge payload so the pane cannot hang on it", () => {
    const raw = rawResult(tool({ result: { blob: "y".repeat(80_000) } })) ?? "";
    expect(raw.length).toBeLessThan(21_000);
    expect(raw).toContain("truncated");
  });

  it("survives a result that cannot be serialized", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(rawResult(tool({ result: circular }))).toBe("(result could not be serialized)");
  });
});
