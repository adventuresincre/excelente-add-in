import { parseSkillFile } from "./frontmatter";
import type { Skill, SkillSource, SkillSummary } from "./types";

/**
 * Vite picks up every `SKILL.md` (preferred per spec) and `skill.md` (legacy)
 * under `apps/excel-addin/skills/*` at build time. Sibling files / sub-folders
 * (references/, scripts/, assets/, …) are also globbed and exposed as
 * resources on the loaded skill.
 *
 * Reaching outside `src/` is intentional — skills are first-class
 * user-visible content, not source code.
 */
const SKILL_FILES_UPPER = import.meta.glob("../../../skills/*/SKILL.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const SKILL_FILES_LOWER = import.meta.glob("../../../skills/*/skill.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/**
 * Resource files: any text file under a skill folder OTHER than SKILL.md /
 * skill.md. Restricted to text-ish extensions to avoid pulling binaries
 * into the bundle.
 */
const RESOURCE_FILES = import.meta.glob("../../../skills/*/**/*.{md,txt,json,yaml,yml,csv}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export const BUNDLED_SOURCE_ID = "bundled";

interface FolderEntry {
  frontmatter: SkillSummary;
  body: string;
  resources: Map<string, string>;
}

/**
 * Read-only `SkillSource` backed by the files Vite globbed at build time.
 * Tests can pass `files` and `resourceFiles` directly to inject synthetic
 * skills without touching the filesystem.
 */
export function bundledSkillSource(files?: {
  skill?: Record<string, string>;
  resources?: Record<string, string>;
}): SkillSource {
  const skillFiles = files?.skill ?? { ...SKILL_FILES_UPPER, ...SKILL_FILES_LOWER };
  const resourceFiles = files?.resources ?? RESOURCE_FILES;
  const skills = buildSkills(skillFiles, resourceFiles);

  return {
    id: BUNDLED_SOURCE_ID,
    async list() {
      return Array.from(skills.values()).map((s) => s.frontmatter);
    },
    async load(name) {
      const found = skills.get(name);
      if (!found) throw new Error(`Bundled skill not found: ${name}`);
      return {
        summary: found.frontmatter,
        body: found.body,
        resources: found.resources,
      } satisfies Skill;
    },
  };
}

function buildSkills(
  skillFiles: Record<string, string>,
  resourceFiles: Record<string, string>
): Map<string, FolderEntry> {
  // First pass: parse each SKILL.md, indexed by folder name. Uppercase wins
  // over lowercase if both exist for the same folder.
  const byFolder = new Map<string, { content: string; usedUppercase: boolean }>();
  for (const [path, content] of Object.entries(skillFiles)) {
    const m = /\/skills\/([^/]+)\/(SKILL|skill)\.md$/.exec(path);
    if (!m) continue;
    const folder = m[1];
    const isUppercase = m[2] === "SKILL";
    const existing = byFolder.get(folder);
    if (!existing || (isUppercase && !existing.usedUppercase)) {
      byFolder.set(folder, { content, usedUppercase: isUppercase });
    }
  }

  const result = new Map<string, FolderEntry>();
  for (const [folder, { content }] of byFolder) {
    let parsed;
    try {
      parsed = parseSkillFile(content);
    } catch (e) {
      console.warn(`bundled skill "${folder}" failed to parse: ${(e as Error).message}`);
      continue;
    }
    if (folder !== parsed.frontmatter.name) {
      console.warn(
        `bundled skill folder "${folder}" doesn't match frontmatter name "${parsed.frontmatter.name}"`
      );
    }
    result.set(parsed.frontmatter.name, {
      frontmatter: { ...parsed.frontmatter, sourceId: BUNDLED_SOURCE_ID },
      body: parsed.body,
      resources: new Map<string, string>(),
    });
  }

  // Second pass: attach resources to their skill folder.
  // We have to map folder name -> frontmatter name (the public key) because
  // a misconfigured skill might use a different name from its folder. We
  // build a folder->name lookup so we attach resources to the right entry.
  const folderToName = new Map<string, string>();
  for (const [folder, { content }] of byFolder) {
    try {
      const parsed = parseSkillFile(content);
      folderToName.set(folder, parsed.frontmatter.name);
    } catch {
      // already warned above
    }
  }

  for (const [path, content] of Object.entries(resourceFiles)) {
    const m = /\/skills\/([^/]+)\/(.+)$/.exec(path);
    if (!m) continue;
    const [, folder, relPath] = m;
    // Skip the SKILL.md / skill.md file itself
    if (relPath.toLowerCase() === "skill.md") continue;
    const skillName = folderToName.get(folder);
    if (!skillName) continue;
    const entry = result.get(skillName);
    if (entry) entry.resources.set(relPath, content);
  }

  return result;
}
