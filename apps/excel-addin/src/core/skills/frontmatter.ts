import type { SkillFrontmatter } from "./types";

/**
 * Parse a skill.md file's content into its frontmatter object + markdown body.
 *
 * Frontmatter is a YAML block between `---` delimiters at the top of the file:
 *
 *     ---
 *     name: direct-cap-valuation
 *     description: Value a stabilized property by Direct Capitalization
 *     ---
 *     <body>
 */
export function parseSkillFile(content: string): { frontmatter: SkillFrontmatter; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content);
  if (!m) {
    throw new Error("skill.md must begin with a YAML frontmatter block (--- … ---)");
  }
  const yamlBlock = m[1];
  const body = m[2] ?? "";

  const parsed = parseSimpleYaml(yamlBlock);

  if (typeof parsed.name !== "string" || !parsed.name.trim()) {
    throw new Error("skill.md frontmatter missing required field: name");
  }
  if (typeof parsed.description !== "string" || !parsed.description.trim()) {
    throw new Error("skill.md frontmatter missing required field: description");
  }

  const fm: SkillFrontmatter = {
    name: parsed.name.trim(),
    description: parsed.description.trim(),
  };

  if (typeof parsed["when-to-use"] === "string") {
    fm.whenToUse = parsed["when-to-use"].trim();
  } else if (typeof parsed.whenToUse === "string") {
    fm.whenToUse = parsed.whenToUse.trim();
  }
  if (typeof parsed.version === "string") fm.version = parsed.version.trim();
  if (typeof parsed.author === "string") fm.author = parsed.author.trim();
  if (Array.isArray(parsed["tool-allowlist"])) {
    fm.toolAllowlist = (parsed["tool-allowlist"] as unknown[])
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim());
  } else if (Array.isArray(parsed.toolAllowlist)) {
    fm.toolAllowlist = (parsed.toolAllowlist as unknown[])
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim());
  }

  return { frontmatter: fm, body: body.trimStart() };
}

/**
 * Minimal YAML parser sufficient for skill frontmatter:
 *   - `key: value` pairs (string values)
 *   - Quoted strings (single or double)
 *   - Inline arrays: `[a, b, "c"]`
 *   - `# comments` and blank lines ignored
 *
 * Does NOT support nested mappings, block scalars, anchors, or multi-line.
 * If a skill needs those, we'll pull in js-yaml at that point.
 */
export function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const rawLine of yaml.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    const rawValue = line.slice(colon + 1).trim();
    out[key] = decodeValue(rawValue);
  }
  return out;
}

function decodeValue(v: string): unknown {
  if (!v) return "";
  if (v.startsWith("[") && v.endsWith("]")) {
    return v
      .slice(1, -1)
      .split(",")
      .map((s) => stripQuotes(s.trim()))
      .filter((s) => s !== "");
  }
  return stripQuotes(v);
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}
