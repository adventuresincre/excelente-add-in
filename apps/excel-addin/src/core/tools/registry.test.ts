import { describe, expect, it } from "vitest";
import { createToolRegistry } from "./registry";
import type { ToolDef } from "./types";

function fakeTool(name: string, isWrite = false): ToolDef {
  return {
    name,
    description: `tool ${name}`,
    inputSchema: { type: "object", properties: {} },
    requiredPermission: isWrite ? "Write" : "Read",
    async execute() {
      return null;
    },
  };
}

describe("createToolRegistry", () => {
  it("looks up tools by name", () => {
    const reg = createToolRegistry([fakeTool("read_range"), fakeTool("write_range", true)]);
    expect(reg.get("read_range")?.name).toBe("read_range");
    expect(reg.get("write_range")?.requiredPermission).toBe("Write");
    expect(reg.get("missing")).toBeUndefined();
  });

  it("preserves registration order in all()", () => {
    const reg = createToolRegistry([fakeTool("a"), fakeTool("b"), fakeTool("c")]);
    expect(reg.all().map((t) => t.name)).toEqual(["a", "b", "c"]);
  });

  it("rejects duplicate tool names", () => {
    expect(() => createToolRegistry([fakeTool("x"), fakeTool("x")])).toThrow(/Duplicate/);
  });

  it("rejects tools that ship without a declared requiredPermission", () => {
    const bad = {
      name: "rogue",
      description: "no perm declared",
      inputSchema: { type: "object", properties: {} },
      async execute() {
        return null;
      },
    } as unknown as ToolDef;
    expect(() => createToolRegistry([bad])).toThrow(/must declare requiredPermission/);
  });

  it("rejects tools with a bogus requiredPermission value", () => {
    const bad = {
      name: "rogue",
      description: "wrong perm value",
      inputSchema: { type: "object", properties: {} },
      requiredPermission: "DangerFullAccess",
      async execute() {
        return null;
      },
    } as unknown as ToolDef;
    expect(() => createToolRegistry([bad])).toThrow(/must declare requiredPermission/);
  });

  it("filter() returns only allowlisted tools, preserving order", () => {
    const reg = createToolRegistry([fakeTool("a"), fakeTool("b"), fakeTool("c")]);
    expect(reg.filter(["c", "a"]).map((t) => t.name)).toEqual(["a", "c"]);
  });

  it("toWireFormat() emits OpenRouter-shaped tool definitions", () => {
    const reg = createToolRegistry([fakeTool("a")]);
    const wire = reg.toWireFormat();
    expect(wire).toEqual([
      {
        type: "function",
        function: {
          name: "a",
          description: "tool a",
          parameters: { type: "object", properties: {} },
        },
      },
    ]);
  });

  it("toWireFormat(allowlist) filters", () => {
    const reg = createToolRegistry([fakeTool("a"), fakeTool("b")]);
    expect(reg.toWireFormat(["b"]).map((t) => t.function.name)).toEqual(["b"]);
  });
});
