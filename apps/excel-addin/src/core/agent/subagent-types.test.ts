import { describe, expect, it } from "vitest";
import {
  DEFAULT_SUBAGENT_READONLY_ALLOWLIST,
  SUBAGENT_TYPES,
  type SubagentType,
} from "./subagent-types";

const ALL_TYPES = Object.keys(SUBAGENT_TYPES) as SubagentType[];

describe("SUBAGENT_TYPES", () => {
  it("ships the expected four roles", () => {
    expect(ALL_TYPES.sort()).toEqual(["Audit", "Builder", "Explore", "Reviewer"]);
  });

  it("every role has a non-empty description and system prompt", () => {
    for (const t of ALL_TYPES) {
      const cfg = SUBAGENT_TYPES[t];
      expect(cfg.description.length).toBeGreaterThan(20);
      expect(cfg.systemPrompt.length).toBeGreaterThan(100);
      // System prompt should name the role so the model knows which hat it's wearing.
      expect(cfg.systemPrompt).toContain(`${t} sub-agent`);
    }
  });

  it("only Builder runs at Write — the rest are Read-only by construction", () => {
    expect(SUBAGENT_TYPES.Explore.sessionPermission).toBe("Read");
    expect(SUBAGENT_TYPES.Audit.sessionPermission).toBe("Read");
    expect(SUBAGENT_TYPES.Reviewer.sessionPermission).toBe("Read");
    expect(SUBAGENT_TYPES.Builder.sessionPermission).toBe("Write");
  });

  it("read-only roles' allowlists exclude write tools", () => {
    for (const t of ["Explore", "Audit", "Reviewer"] as const) {
      const list = SUBAGENT_TYPES[t].toolAllowlist;
      expect(list).not.toContain("write_range");
      expect(list).not.toContain("format_range");
      expect(list).not.toContain("undo");
      expect(list).not.toContain("write_workbook_memory");
    }
  });

  it("Builder's allowlist includes write_range and format_range", () => {
    const list = SUBAGENT_TYPES.Builder.toolAllowlist;
    expect(list).toContain("write_range");
    expect(list).toContain("format_range");
  });

  it("every role's allowlist is a superset of the default read-only allowlist", () => {
    for (const t of ALL_TYPES) {
      const list = SUBAGENT_TYPES[t].toolAllowlist;
      for (const required of DEFAULT_SUBAGENT_READONLY_ALLOWLIST) {
        expect(list).toContain(required);
      }
    }
  });

  it("no role grants spawn_subagent (would break the recursion lock)", () => {
    for (const t of ALL_TYPES) {
      expect(SUBAGENT_TYPES[t].toolAllowlist).not.toContain("spawn_subagent");
    }
  });
});
