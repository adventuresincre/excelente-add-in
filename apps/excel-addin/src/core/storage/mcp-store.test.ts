import { describe, expect, it } from "vitest";
import {
  createInMemoryMcpServerStore,
  isValidMcpServerName,
  isValidMcpServerUrl,
  type McpServerConfig,
} from "./mcp-store";

function config(id: string, name: string, addedAt: number): McpServerConfig {
  return { id, name, url: `https://example.com/${name}`, addedAt };
}

describe("MCP server store (in-memory)", () => {
  it("list returns servers ordered by addedAt ascending", async () => {
    const s = createInMemoryMcpServerStore();
    await s.add(config("b", "b-srv", 200));
    await s.add(config("a", "a-srv", 100));
    await s.add(config("c", "c-srv", 300));
    expect((await s.list()).map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("add upserts by id (same id → replace)", async () => {
    const s = createInMemoryMcpServerStore();
    await s.add(config("a", "first-name", 100));
    await s.add({ ...config("a", "second-name", 100), url: "https://other.example.com" });
    const list = await s.list();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("second-name");
    expect(list[0].url).toBe("https://other.example.com");
  });

  it("remove deletes by id", async () => {
    const s = createInMemoryMcpServerStore();
    await s.add(config("a", "a", 100));
    await s.add(config("b", "b", 200));
    await s.remove("a");
    expect((await s.list()).map((c) => c.id)).toEqual(["b"]);
  });
});

describe("isValidMcpServerName", () => {
  it("accepts lower-kebab identifiers", () => {
    expect(isValidMcpServerName("acre-hub")).toBe(true);
    expect(isValidMcpServerName("a")).toBe(true);
    expect(isValidMcpServerName("server-1")).toBe(true);
  });

  it("rejects uppercase, underscores, and special chars", () => {
    expect(isValidMcpServerName("ACRE")).toBe(false);
    expect(isValidMcpServerName("acre_hub")).toBe(false);
    expect(isValidMcpServerName("acre.hub")).toBe(false);
    expect(isValidMcpServerName("acre hub")).toBe(false);
  });

  it("rejects names starting with a non-letter", () => {
    expect(isValidMcpServerName("1server")).toBe(false);
    expect(isValidMcpServerName("-server")).toBe(false);
  });

  it("rejects empty + overly long names", () => {
    expect(isValidMcpServerName("")).toBe(false);
    expect(isValidMcpServerName("a".repeat(32))).toBe(false);
  });
});

describe("isValidMcpServerUrl", () => {
  it("accepts https, and http only on loopback", () => {
    expect(isValidMcpServerUrl("https://mcp.example.com/rpc")).toBe(true);
    expect(isValidMcpServerUrl("http://localhost:3000")).toBe(true);
    expect(isValidMcpServerUrl("http://127.0.0.1:8080/rpc")).toBe(true);
  });

  // These URLs carry the member session token (or a credential embedded in
  // a personal URL) plus whatever workbook data the agent hands the server.
  it("rejects plaintext http to a remote host", () => {
    expect(isValidMcpServerUrl("http://mcp.example.com/rpc")).toBe(false);
    expect(isValidMcpServerUrl("http://10.0.0.5/rpc")).toBe(false);
    expect(isValidMcpServerUrl("http://localhost.evil.com/rpc")).toBe(false);
  });

  it("rejects non-http(s) protocols", () => {
    expect(isValidMcpServerUrl("file:///tmp")).toBe(false);
    expect(isValidMcpServerUrl("ftp://x")).toBe(false);
    expect(isValidMcpServerUrl("ws://x")).toBe(false);
  });

  it("rejects garbage", () => {
    expect(isValidMcpServerUrl("")).toBe(false);
    expect(isValidMcpServerUrl("not a url")).toBe(false);
  });
});
