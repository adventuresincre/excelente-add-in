import { describe, expect, it } from "vitest";
import { parseSimpleYaml, parseSkillFile } from "./frontmatter";

describe("parseSimpleYaml", () => {
  it("parses key/value pairs", () => {
    expect(parseSimpleYaml("name: foo\nversion: 1.0.0")).toEqual({
      name: "foo",
      version: "1.0.0",
    });
  });

  it("strips quotes around string values", () => {
    expect(parseSimpleYaml(`title: "Hello world"`)).toEqual({ title: "Hello world" });
    expect(parseSimpleYaml(`title: 'Hi'`)).toEqual({ title: "Hi" });
  });

  it("parses inline arrays", () => {
    expect(parseSimpleYaml(`tools: [read_range, "write_range", undo]`)).toEqual({
      tools: ["read_range", "write_range", "undo"],
    });
  });

  it("ignores comments and blank lines", () => {
    const yaml = `# comment\nname: foo\n\nversion: 1`;
    expect(parseSimpleYaml(yaml)).toEqual({ name: "foo", version: "1" });
  });
});

describe("parseSkillFile", () => {
  const FILE = `---
name: direct-cap-valuation
description: Value a stabilized property by Direct Capitalization
when-to-use: User asks to value a property using direct cap, NOI / cap rate
version: 1.0.0
author: A.CRE
tool-allowlist: [read_workbook_outline, read_sheet_outline, write_range]
---

# Direct cap valuation

Step 1: ask the user for NOI and cap rate.
Step 2: compute value = NOI / cap rate.
`;

  it("splits frontmatter from body", () => {
    const { frontmatter, body } = parseSkillFile(FILE);
    expect(frontmatter.name).toBe("direct-cap-valuation");
    expect(frontmatter.description).toMatch(/Direct Capitalization/);
    expect(frontmatter.whenToUse).toMatch(/direct cap/);
    expect(frontmatter.version).toBe("1.0.0");
    expect(frontmatter.author).toBe("A.CRE");
    expect(frontmatter.toolAllowlist).toEqual([
      "read_workbook_outline",
      "read_sheet_outline",
      "write_range",
    ]);
    expect(body).toContain("# Direct cap valuation");
    expect(body.startsWith("# Direct cap valuation")).toBe(true);
  });

  it("handles CRLF line endings", () => {
    const crlf = FILE.replace(/\n/g, "\r\n");
    const { frontmatter } = parseSkillFile(crlf);
    expect(frontmatter.name).toBe("direct-cap-valuation");
  });

  it("rejects files without frontmatter", () => {
    expect(() => parseSkillFile("# No frontmatter")).toThrow(/frontmatter/);
  });

  it("rejects frontmatter missing required fields", () => {
    expect(() => parseSkillFile(`---\ndescription: missing name\n---\nbody`)).toThrow(/name/);
    expect(() => parseSkillFile(`---\nname: x\n---\nbody`)).toThrow(/description/);
  });
});
