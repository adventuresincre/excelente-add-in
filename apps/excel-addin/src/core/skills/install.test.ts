import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { installSkill, installSkillFromZip, SkillZipError } from "./install";
import { createInMemorySkillStore } from "./store-memory";

const SKILL_BODY = `---
name: test-skill
description: A skill for tests
when-to-use: When the test asks
version: "1.0.0"
---

# Test skill

This is the body.
`;

async function buildZip(entries: Record<string, string>): Promise<Blob> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(entries)) {
    zip.file(path, content);
  }
  // Build as ArrayBuffer + wrap in a Blob — Node's Blob constructor handles
  // ArrayBuffer reliably, whereas `generateAsync({ type: "blob" })` doesn't
  // round-trip through JSZip.loadAsync in Node's test environment.
  const buf = await zip.generateAsync({ type: "arraybuffer" });
  return new Blob([buf]);
}

/**
 * Wrap a blob in a File-like object exposing `.name` so installSkill() can
 * detect the extension. Node 18+ has File globally; if not, we synthesize.
 */
function asFile(blob: Blob, name: string): File {
  if (typeof File !== "undefined") {
    return new File([blob], name, { type: blob.type });
  }
  const f = blob as Blob & { name?: string };
  f.name = name;
  return f as File;
}

describe("installSkillFromZip", () => {
  it("installs a skill with SKILL.md at the root", async () => {
    const store = createInMemorySkillStore();
    const zip = await buildZip({ "SKILL.md": SKILL_BODY });
    const result = await installSkillFromZip(zip, store);
    expect(result.name).toBe("test-skill");
    expect(result.replaced).toBe(false);

    const stored = await store.get("test-skill");
    expect(stored).not.toBeNull();
    expect(stored!.frontmatter.description).toBe("A skill for tests");
    expect(stored!.body.trim()).toContain("# Test skill");
    expect(Object.keys(stored!.resources)).toEqual([]);
  });

  it("strips a single top-level folder", async () => {
    const store = createInMemorySkillStore();
    const zip = await buildZip({
      "test-skill/SKILL.md": SKILL_BODY,
      "test-skill/references/notes.md": "# notes",
    });
    await installSkillFromZip(zip, store);
    const stored = await store.get("test-skill");
    expect(stored!.resources["references/notes.md"]).toBe("# notes");
  });

  it("collects only text-ish resources", async () => {
    const store = createInMemorySkillStore();
    const zip = await buildZip({
      "SKILL.md": SKILL_BODY,
      "data.json": '{"k":1}',
      "config.yaml": "a: b",
      "ignore.exe": "binary",
      "thumb.png": "binary",
    });
    await installSkillFromZip(zip, store);
    const stored = await store.get("test-skill");
    const keys = Object.keys(stored!.resources).sort();
    expect(keys).toEqual(["config.yaml", "data.json"]);
  });

  it("excludes a lowercase skill.md sibling", async () => {
    const store = createInMemorySkillStore();
    const zip = await buildZip({
      "SKILL.md": SKILL_BODY,
      "skill.md": "duplicate",
    });
    await installSkillFromZip(zip, store);
    const stored = await store.get("test-skill");
    expect(stored!.resources).not.toHaveProperty("skill.md");
  });

  it("rejects zips with no SKILL.md", async () => {
    const store = createInMemorySkillStore();
    const zip = await buildZip({ "notes.md": "# nope" });
    await expect(installSkillFromZip(zip, store)).rejects.toThrowError(SkillZipError);
    await expect(installSkillFromZip(zip, store)).rejects.toMatchObject({ kind: "no-skill-md" });
  });

  it("rejects multiple top-level folders", async () => {
    const store = createInMemorySkillStore();
    const zip = await buildZip({
      "a/SKILL.md": SKILL_BODY,
      "b/extra.md": "hi",
    });
    await expect(installSkillFromZip(zip, store)).rejects.toMatchObject({ kind: "no-skill-md" });
  });

  it("rejects bad frontmatter", async () => {
    const store = createInMemorySkillStore();
    const badBody = `---
description: missing name
---
body
`;
    const zip = await buildZip({ "SKILL.md": badBody });
    await expect(installSkillFromZip(zip, store)).rejects.toMatchObject({ kind: "parse-failed" });
  });

  it("rejects invalid skill names", async () => {
    const store = createInMemorySkillStore();
    const badBody = `---
name: "Bad Name With Spaces"
description: nope
---
body
`;
    const zip = await buildZip({ "SKILL.md": badBody });
    await expect(installSkillFromZip(zip, store)).rejects.toMatchObject({ kind: "invalid-name" });
  });

  it("rejects collisions with reserved (bundled) names", async () => {
    const store = createInMemorySkillStore();
    const zip = await buildZip({ "SKILL.md": SKILL_BODY });
    await expect(
      installSkillFromZip(zip, store, { reservedNames: new Set(["test-skill"]) })
    ).rejects.toMatchObject({ kind: "name-collision" });
  });

  it("replaces an existing user skill with the same name and reports replaced=true", async () => {
    const store = createInMemorySkillStore();
    const zip1 = await buildZip({ "SKILL.md": SKILL_BODY });
    await installSkillFromZip(zip1, store);

    const updated = SKILL_BODY.replace("description: A skill for tests", "description: Updated");
    const zip2 = await buildZip({ "SKILL.md": updated });
    const result = await installSkillFromZip(zip2, store);

    expect(result.replaced).toBe(true);
    const stored = await store.get("test-skill");
    expect(stored!.frontmatter.description).toBe("Updated");
  });

  it("rejects files above the per-file size cap", async () => {
    const store = createInMemorySkillStore();
    const huge = "x".repeat(2 * 1024 * 1024); // 2 MB
    const zip = await buildZip({
      "SKILL.md": SKILL_BODY,
      "big.md": huge,
    });
    await expect(
      installSkillFromZip(zip, store, { maxPerFileBytes: 1024 * 1024 })
    ).rejects.toMatchObject({ kind: "size-limit" });
  });

  it("rejects when accumulated bytes exceed the total cap", async () => {
    const store = createInMemorySkillStore();
    const chunk = "x".repeat(512 * 1024); // 512 KB
    const zip = await buildZip({
      "SKILL.md": SKILL_BODY,
      "a.md": chunk,
      "b.md": chunk,
      "c.md": chunk,
    });
    await expect(
      installSkillFromZip(zip, store, { maxTotalBytes: 1 * 1024 * 1024 })
    ).rejects.toMatchObject({ kind: "size-limit" });
  });

  it("rejects zips with too many files", async () => {
    const store = createInMemorySkillStore();
    const files: Record<string, string> = { "SKILL.md": SKILL_BODY };
    for (let i = 0; i < 5; i++) files[`f${i}.md`] = "x";
    const zip = await buildZip(files);
    await expect(installSkillFromZip(zip, store, { maxFileCount: 3 })).rejects.toMatchObject({
      kind: "size-limit",
    });
  });
});

/* -------- new in chore/skill-upload-formats: .skill + .md uploads ------- */

describe("installSkill — multiple input formats", () => {
  it("accepts .skill files (which are mechanically zip archives)", async () => {
    const store = createInMemorySkillStore();
    const zip = await buildZip({ "SKILL.md": SKILL_BODY });
    const file = asFile(zip, "acre-accelerator-1-direct-cap-v2026.skill");
    const result = await installSkill(file, store);
    expect(result.name).toBe("test-skill");
    expect(result.replaced).toBe(false);
  });

  it("accepts standalone .md uploads (no zip wrapper, no resources)", async () => {
    const store = createInMemorySkillStore();
    const blob = new Blob([SKILL_BODY], { type: "text/markdown" });
    const file = asFile(blob, "test-skill.md");
    const result = await installSkill(file, store);
    expect(result.name).toBe("test-skill");

    const stored = await store.get("test-skill");
    expect(stored).not.toBeNull();
    expect(stored!.body).toContain("# Test skill");
    expect(stored!.resources).toEqual({});
  });

  it("rejects a .md upload whose frontmatter doesn't parse", async () => {
    const store = createInMemorySkillStore();
    const blob = new Blob(["just plain text, no frontmatter"], { type: "text/markdown" });
    const file = asFile(blob, "bad.md");
    await expect(installSkill(file, store)).rejects.toMatchObject({ kind: "parse-failed" });
  });

  it("rejects a .md upload that exceeds the per-file size cap", async () => {
    const store = createInMemorySkillStore();
    const big = SKILL_BODY + "\n" + "x".repeat(2 * 1024 * 1024);
    const blob = new Blob([big], { type: "text/markdown" });
    const file = asFile(blob, "big.md");
    await expect(installSkill(file, store, { maxPerFileBytes: 1024 * 1024 })).rejects.toMatchObject(
      { kind: "size-limit" }
    );
  });

  it("routes a .md filename that secretly contains zip bytes to the zip path", async () => {
    // Belt-and-suspenders: if someone renames a zip to .md, we should still
    // accept it (the magic bytes tell us the truth).
    const store = createInMemorySkillStore();
    const zip = await buildZip({ "SKILL.md": SKILL_BODY });
    const file = asFile(zip, "trickster.md"); // misleading extension
    const result = await installSkill(file, store);
    expect(result.name).toBe("test-skill");
  });

  it("falls back to the zip path for unknown extensions", async () => {
    // Anything that isn't .md goes through the zip handler. JSZip throws a
    // clean error if the content isn't actually zip-formatted.
    const store = createInMemorySkillStore();
    const zip = await buildZip({ "SKILL.md": SKILL_BODY });
    const file = asFile(zip, "no-extension");
    const result = await installSkill(file, store);
    expect(result.name).toBe("test-skill");
  });

  it("installSkillFromZip is a backward-compat alias for installSkill", () => {
    expect(installSkillFromZip).toBe(installSkill);
  });
});
