import { describe, expect, it, vi } from "vitest";
import { bridgeMcpClient, bridgeMcpTool, mcpSourceTag, mcpToolName } from "./tool-bridge";
import type { McpClient, McpTool } from "./client";

function fakeClient(opts: {
  serverName?: string;
  tools?: McpTool[];
  call?: McpClient["callTool"];
}): McpClient {
  return {
    serverName: opts.serverName ?? "acre",
    url: "https://example.com",
    async initialize() {},
    async listTools() {
      return opts.tools ?? [];
    },
    callTool: opts.call ?? (async () => ({ content: [{ type: "text", text: "ok" }] })),
  };
}

describe("mcpToolName + mcpSourceTag", () => {
  it("namespaces tools by server name", () => {
    expect(mcpToolName("acre", "lookup")).toBe("mcp_acre__lookup");
    expect(mcpSourceTag("acre")).toBe("mcp:acre");
  });
});

describe("bridgeMcpTool", () => {
  it("produces a ToolDef with namespaced name + source tag; unannotated tools default to Write", () => {
    const client = fakeClient({});
    const def = bridgeMcpTool(client, {
      name: "lookup",
      description: "Look something up",
      inputSchema: { type: "object", properties: { q: { type: "string" } } },
    });
    expect(def.name).toBe("mcp_acre__lookup");
    expect(def.description).toBe("Look something up");
    // No annotations → the server hasn't declared the tool side-effect-free,
    // so it must route through the approval gate.
    expect(def.requiredPermission).toBe("Write");
    expect(def.source).toBe("mcp:acre");
    expect(def.inputSchema).toEqual({
      type: "object",
      properties: { q: { type: "string" } },
    });
  });

  it("maps readOnlyHint:true to Read (silent execution)", () => {
    const def = bridgeMcpTool(fakeClient({}), {
      name: "search",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
    });
    expect(def.requiredPermission).toBe("Read");
  });

  it("treats readOnlyHint:false and destructive tools as Write", () => {
    const explicit = bridgeMcpTool(fakeClient({}), {
      name: "send_message",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: false, destructiveHint: true },
    });
    expect(explicit.requiredPermission).toBe("Write");
  });

  it("synthesizes a description when the MCP tool omits one", () => {
    const def = bridgeMcpTool(fakeClient({}), {
      name: "ping",
      inputSchema: {},
    });
    expect(def.description).toMatch(/ping/);
    expect(def.description).toMatch(/acre/);
  });

  it("normalizes non-object input schemas to an empty object schema", () => {
    const def = bridgeMcpTool(fakeClient({}), {
      name: "noargs",
      inputSchema: undefined as unknown as Record<string, unknown>,
    });
    expect(def.inputSchema).toEqual({
      type: "object",
      properties: {},
      additionalProperties: false,
    });
  });

  it("adds a missing `properties` field on object schemas", () => {
    const def = bridgeMcpTool(fakeClient({}), {
      name: "noprops",
      inputSchema: { type: "object" },
    });
    expect(def.inputSchema).toEqual({ type: "object", properties: {} });
  });

  it("execute() joins text content blocks into a single string", async () => {
    const call = vi.fn().mockResolvedValue({
      content: [
        { type: "text", text: "first" },
        { type: "text", text: "second" },
      ],
    });
    const def = bridgeMcpTool(fakeClient({ call }), {
      name: "talk",
      inputSchema: {},
    });
    const result = await def.execute({ q: "x" }, { ds: null as never, undoStack: null as never });
    expect(call).toHaveBeenCalledWith("talk", { q: "x" });
    expect(result).toBe("first\n\nsecond");
  });

  it("execute() throws on isError + text content (so the orchestrator routes it as a tool failure)", async () => {
    const call = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "Server says: no" }],
      isError: true,
    });
    const def = bridgeMcpTool(fakeClient({ call }), {
      name: "fail",
      inputSchema: {},
    });
    await expect(def.execute({}, { ds: null as never, undoStack: null as never })).rejects.toThrow(
      /Server says: no/
    );
  });

  it("execute() returns structured content when blocks aren't pure text", async () => {
    const call = vi.fn().mockResolvedValue({
      content: [
        { type: "text", text: "see image" },
        { type: "image", data: "...", mimeType: "image/png" },
      ],
    });
    const def = bridgeMcpTool(fakeClient({ call }), {
      name: "mixed",
      inputSchema: {},
    });
    const result = (await def.execute({}, { ds: null as never, undoStack: null as never })) as {
      text: string;
      content: unknown[];
    };
    expect(result.text).toBe("see image");
    expect(result.content).toHaveLength(1);
  });
});

describe("bridgeMcpClient", () => {
  it("converts every tool from listTools()", async () => {
    const client = fakeClient({
      tools: [
        { name: "a", description: "A", inputSchema: { type: "object", properties: {} } },
        { name: "b", description: "B", inputSchema: { type: "object", properties: {} } },
      ],
    });
    const defs = await bridgeMcpClient(client);
    expect(defs.map((d) => d.name)).toEqual(["mcp_acre__a", "mcp_acre__b"]);
  });
});

describe("bridgeMcpTool — untrusted server input", () => {
  it("treats a tool claiming both readOnly and destructive as Write", () => {
    // The two hints contradict each other; the safe reading wins rather
    // than handing the tool silent execution.
    const tool = bridgeMcpTool(fakeClient({}), {
      name: "purge",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true, destructiveHint: true },
    });
    expect(tool.requiredPermission).toBe("Write");
  });

  it("still honors a plain readOnlyHint for silent reads", () => {
    const tool = bridgeMcpTool(fakeClient({}), {
      name: "search",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
    });
    expect(tool.requiredPermission).toBe("Read");
  });

  it("caps an oversized server-supplied description", () => {
    const tool = bridgeMcpTool(fakeClient({}), {
      name: "verbose",
      description: "x".repeat(50_000),
      inputSchema: { type: "object", properties: {} },
    });
    expect(tool.description.length).toBeLessThan(2_000);
    expect(tool.description).toContain("[truncated]");
  });

  it("drops tools whose bridged name is not a valid provider function name", async () => {
    // One malformed name would otherwise 400 every subsequent chat request,
    // disabling the whole agent rather than just this tool.
    const client = fakeClient({
      serverName: "acre",
      tools: [
        { name: "good_one", inputSchema: { type: "object", properties: {} } },
        { name: "has spaces", inputSchema: { type: "object", properties: {} } },
        { name: "emoji🙂", inputSchema: { type: "object", properties: {} } },
        { name: "z".repeat(120), inputSchema: { type: "object", properties: {} } },
      ],
    });

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bridged = await bridgeMcpClient(client);
    warn.mockRestore();

    expect(bridged.map((t) => t.name)).toEqual(["mcp_acre__good_one"]);
  });
});
