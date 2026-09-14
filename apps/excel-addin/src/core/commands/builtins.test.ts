import { describe, expect, it } from "vitest";
import { BUILTIN_COMMANDS, filterCommands } from "./builtins";

describe("BUILTIN_COMMANDS", () => {
  it("ships the expected core commands in stable order", () => {
    expect(BUILTIN_COMMANDS.map((c) => c.name)).toEqual([
      "plan",
      "work",
      "undo",
      "init",
      "skillify",
      "clear",
      "help",
      "cost",
    ]);
  });

  it("every command has a non-empty description", () => {
    for (const cmd of BUILTIN_COMMANDS) {
      expect(cmd.description.length).toBeGreaterThan(10);
    }
  });

  it("names are URL/identifier-safe (lower kebab)", () => {
    for (const cmd of BUILTIN_COMMANDS) {
      expect(cmd.name).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });
});

describe("filterCommands", () => {
  it("returns all commands when the query is empty", () => {
    expect(filterCommands("").map((c) => c.name)).toEqual(BUILTIN_COMMANDS.map((c) => c.name));
  });

  it("matches by name (case-insensitive)", () => {
    expect(filterCommands("PLA").map((c) => c.name)).toEqual(["plan"]);
    expect(filterCommands("Clear").map((c) => c.name)).toEqual(["clear"]);
  });

  it("matches by description content", () => {
    // 'numbered plan' appears in the /plan description
    expect(filterCommands("numbered").map((c) => c.name)).toEqual(["plan"]);
    // 'fresh conversation' appears in the /clear description
    expect(filterCommands("fresh conversation").map((c) => c.name)).toEqual(["clear"]);
  });

  it("preserves declaration order across matches", () => {
    // Both "plan" and "work" descriptions contain "mode"; declaration order
    // puts plan first.
    const names = filterCommands("mode").map((c) => c.name);
    expect(names.indexOf("plan")).toBeLessThan(names.indexOf("work"));
  });

  it("returns [] when nothing matches", () => {
    expect(filterCommands("xyzzy-nothing")).toEqual([]);
  });
});
