import JSZip from "jszip";
import { parseSkillFile } from "./frontmatter";
import type { SkillStore, StoredSkill } from "./store";

/* ------------------------------- options ---------------------------------- */

/** Caps that prevent a malicious or just-too-big zip from blowing up the tab. */
export interface InstallOptions {
  /** Reject when total uncompressed size exceeds this. Default 10 MB. */
  maxTotalBytes?: number;
  /** Reject any single file larger than this. Default 1 MB. */
  maxPerFileBytes?: number;
  /** Reject zips containing more files than this. Default 200. */
  maxFileCount?: number;
  /** Names that may not be used (e.g. bundled skill names). Case-sensitive. */
  reservedNames?: ReadonlySet<string>;
}

const DEFAULTS: Required<Omit<InstallOptions, "reservedNames">> = {
  maxTotalBytes: 10 * 1024 * 1024,
  maxPerFileBytes: 1 * 1024 * 1024,
  maxFileCount: 200,
};

/** Text-ish extensions we keep as `resources`. Mirrors bundled.ts. */
const RESOURCE_EXTENSIONS = new Set([".md", ".txt", ".json", ".yaml", ".yml", ".csv"]);

/* --------------------------------- errors --------------------------------- */

export type SkillZipErrorKind =
  | "no-skill-md"
  | "parse-failed"
  | "name-collision"
  | "size-limit"
  | "invalid-name"
  | "invalid-zip";

/**
 * Thrown by `installSkillFromZip` on validation failures. The `kind` field
 * lets the UI map an error to a remedy without parsing the message.
 */
export class SkillZipError extends Error {
  constructor(
    public readonly kind: SkillZipErrorKind,
    message: string
  ) {
    super(message);
    this.name = "SkillZipError";
  }
}

/* ---------------------------------- API ----------------------------------- */

export interface InstallResult {
  /** Frontmatter name of the installed skill. */
  name: string;
  /** True when a previously installed user skill with the same name was replaced. */
  replaced: boolean;
}

/**
 * Install a skill from one of three accepted formats:
 *
 *  - `.zip` — standard zip archive containing SKILL.md + optional resources.
 *  - `.skill` — Open Agent Skills convention; mechanically identical to a zip.
 *  - `.md` — a single SKILL.md file with frontmatter (no resources).
 *
 * Format is detected from the filename when available, then validated with
 * magic-byte sniffing so `.skill` files (which ARE zips) get the zip path
 * and rogue ".md" files that happen to contain zip data also get routed
 * correctly. Throws `SkillZipError` for any user-fixable problem.
 *
 * Zip layout rules (for `.zip` / `.skill`):
 * - SKILL.md may live at the zip root OR inside a single top-level folder
 * - Resource files keep their path relative to the SKILL.md file
 * - Only text-ish extensions are kept as resources; binaries silently dropped
 */
export async function installSkill(
  input: File | Blob,
  store: SkillStore,
  opts: InstallOptions = {}
): Promise<InstallResult> {
  const filename = input instanceof File ? input.name : undefined;
  const ext = filename ? extOf(filename) : "";

  // Read the buffer once — we may need it for both extension matching and
  // magic-byte sniffing.
  let buf: ArrayBuffer;
  try {
    buf = await input.arrayBuffer();
  } catch (e) {
    throw new SkillZipError("invalid-zip", `Failed to read the file: ${(e as Error).message}`);
  }

  // Markdown path: filename ends in .md AND the content isn't actually a zip
  // in disguise (rare, but cheap to guard).
  if (ext === ".md" && !looksLikeZip(buf)) {
    return installFromMarkdownBuffer(buf, store, opts);
  }

  // Everything else routes through the zip handler. `.skill` is just a zip
  // with a different extension; for unknown extensions we trust the magic
  // bytes inside JSZip's parser to reject non-zip files cleanly.
  return installFromZipBuffer(buf, store, opts);
}

/**
 * Backward-compat alias kept so existing callers (AppProvider's
 * `installSkill` context value) don't need to change. Will be removed in a
 * later cleanup once all callers move to `installSkill`.
 */
export const installSkillFromZip = installSkill;

/* --------------------------- markdown-only path --------------------------- */

async function installFromMarkdownBuffer(
  buf: ArrayBuffer,
  store: SkillStore,
  opts: InstallOptions
): Promise<InstallResult> {
  const max = { ...DEFAULTS, ...opts };
  const reserved = opts.reservedNames ?? new Set<string>();

  if (buf.byteLength > max.maxPerFileBytes) {
    throw new SkillZipError(
      "size-limit",
      `SKILL.md is larger than the per-file limit (${formatBytes(max.maxPerFileBytes)}).`
    );
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    throw new SkillZipError(
      "invalid-zip",
      "Couldn't decode the .md file as UTF-8 text — is it actually a Markdown file?"
    );
  }

  let parsed;
  try {
    parsed = parseSkillFile(text);
  } catch (e) {
    throw new SkillZipError(
      "parse-failed",
      `SKILL.md frontmatter is invalid: ${(e as Error).message}`
    );
  }
  const { frontmatter, body } = parsed;

  if (!isValidSkillName(frontmatter.name)) {
    throw new SkillZipError(
      "invalid-name",
      `Skill name "${frontmatter.name}" is invalid. Use lowercase letters, digits, dashes, and underscores only (e.g., "underwriting-checklist").`
    );
  }
  if (reserved.has(frontmatter.name)) {
    throw new SkillZipError(
      "name-collision",
      `A built-in skill is already named "${frontmatter.name}". Rename your skill in its frontmatter and try again.`
    );
  }

  const existing = await store.get(frontmatter.name);
  const record: StoredSkill = {
    name: frontmatter.name,
    frontmatter,
    body,
    resources: {}, // standalone .md uploads carry no resources
    installedAt: Date.now(),
  };
  await store.put(record);

  return { name: frontmatter.name, replaced: existing !== null };
}

/* ------------------------------ zip-like path ----------------------------- */

async function installFromZipBuffer(
  buf: ArrayBuffer,
  store: SkillStore,
  opts: InstallOptions
): Promise<InstallResult> {
  const max = { ...DEFAULTS, ...opts };
  const reserved = opts.reservedNames ?? new Set<string>();

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch (e) {
    throw new SkillZipError(
      "invalid-zip",
      `That file doesn't look like a valid .zip or .skill archive (${(e as Error).message}). ` +
        `If you meant to upload a standalone SKILL.md, save it with a .md extension and try again.`
    );
  }

  // Collect all non-directory entries with their paths.
  const entries: { path: string; file: JSZip.JSZipObject }[] = [];
  zip.forEach((path, file) => {
    if (file.dir) return;
    entries.push({ path, file });
  });

  if (entries.length === 0) {
    throw new SkillZipError("no-skill-md", "The zip is empty.");
  }
  if (entries.length > max.maxFileCount) {
    throw new SkillZipError(
      "size-limit",
      `Zip has ${entries.length} files, which exceeds the ${max.maxFileCount}-file limit.`
    );
  }

  // Find SKILL.md (or skill.md). Allow either at the zip root or inside a
  // single top-level folder.
  const skillEntry = findSkillEntry(entries);
  if (!skillEntry) {
    throw new SkillZipError(
      "no-skill-md",
      "Zip must contain a SKILL.md at the root or inside a single top-level folder."
    );
  }

  const rootPrefix = skillEntry.path.slice(0, skillEntry.path.length - skillEntry.relPath.length);

  // Read SKILL.md content and parse the frontmatter.
  let skillText: string;
  try {
    skillText = await skillEntry.file.async("string");
  } catch (e) {
    throw new SkillZipError("invalid-zip", `Failed to read SKILL.md: ${(e as Error).message}`);
  }
  if (byteLength(skillText) > max.maxPerFileBytes) {
    throw new SkillZipError(
      "size-limit",
      `SKILL.md is larger than the per-file limit (${formatBytes(max.maxPerFileBytes)}).`
    );
  }

  let parsed;
  try {
    parsed = parseSkillFile(skillText);
  } catch (e) {
    throw new SkillZipError(
      "parse-failed",
      `SKILL.md frontmatter is invalid: ${(e as Error).message}`
    );
  }
  const { frontmatter, body } = parsed;

  if (!isValidSkillName(frontmatter.name)) {
    throw new SkillZipError(
      "invalid-name",
      `Skill name "${frontmatter.name}" is invalid. Use lowercase letters, digits, and dashes only (e.g., "underwriting-checklist").`
    );
  }
  if (reserved.has(frontmatter.name)) {
    throw new SkillZipError(
      "name-collision",
      `A built-in skill is already named "${frontmatter.name}". Rename your skill in its frontmatter and try again.`
    );
  }

  // Read every other entry that looks like a resource and is below the same
  // root prefix. Track total bytes against the size cap.
  let totalBytes = byteLength(skillText);
  const resources: Record<string, string> = {};

  for (const entry of entries) {
    if (entry === skillEntry) continue;
    if (rootPrefix && !entry.path.startsWith(rootPrefix)) continue;
    const relPath = entry.path.slice(rootPrefix.length);

    // Skip the alternate-case SKILL.md sibling, if present.
    if (relPath.toLowerCase() === "skill.md") continue;

    const ext = extOf(relPath);
    if (!RESOURCE_EXTENSIONS.has(ext)) continue;

    let content: string;
    try {
      content = await entry.file.async("string");
    } catch {
      // Binary content that JSZip can't decode as text — skip rather than fail.
      continue;
    }
    const size = byteLength(content);
    if (size > max.maxPerFileBytes) {
      throw new SkillZipError(
        "size-limit",
        `"${relPath}" is larger than the per-file limit (${formatBytes(max.maxPerFileBytes)}).`
      );
    }
    totalBytes += size;
    if (totalBytes > max.maxTotalBytes) {
      throw new SkillZipError(
        "size-limit",
        `Skill exceeds the ${formatBytes(max.maxTotalBytes)} total-size limit.`
      );
    }
    resources[relPath] = content;
  }

  const existing = await store.get(frontmatter.name);
  const record: StoredSkill = {
    name: frontmatter.name,
    frontmatter,
    body,
    resources,
    installedAt: Date.now(),
  };
  await store.put(record);

  return { name: frontmatter.name, replaced: existing !== null };
}

/* ----------------------------- helpers ------------------------------------ */

interface SkillEntry {
  /** Full path inside the zip (e.g., "my-skill/SKILL.md"). */
  path: string;
  /** Path relative to the skill root (always "SKILL.md" or "skill.md"). */
  relPath: string;
  file: JSZip.JSZipObject;
}

/**
 * Locate SKILL.md (uppercase wins over lowercase). Accept it at the zip
 * root OR inside a single top-level folder. Returns null if not present
 * or if multiple candidates exist at the same level.
 */
function findSkillEntry(entries: { path: string; file: JSZip.JSZipObject }[]): SkillEntry | null {
  // Look at the root first.
  const rootCandidates = entries.filter((e) => /^(SKILL|skill)\.md$/.test(e.path));
  if (rootCandidates.length > 0) {
    const pick = rootCandidates.find((c) => c.path === "SKILL.md") ?? rootCandidates[0];
    return { path: pick.path, relPath: pick.path, file: pick.file };
  }

  // Otherwise: every entry must share a single top-level folder.
  const topLevels = new Set<string>();
  for (const e of entries) {
    const slash = e.path.indexOf("/");
    if (slash === -1) return null; // file at root that isn't SKILL.md → invalid layout
    topLevels.add(e.path.slice(0, slash));
  }
  if (topLevels.size !== 1) return null;
  const folder = topLevels.values().next().value as string;
  const folderCandidates = entries.filter((e) =>
    new RegExp(`^${escapeRegex(folder)}/(SKILL|skill)\\.md$`).test(e.path)
  );
  if (folderCandidates.length === 0) return null;
  const pick = folderCandidates.find((c) => c.path === `${folder}/SKILL.md`) ?? folderCandidates[0];
  const relPath = pick.path.slice(folder.length + 1);
  return { path: pick.path, relPath, file: pick.file };
}

function isValidSkillName(name: string): boolean {
  return /^[a-z0-9][a-z0-9-_]{0,62}$/.test(name);
}

function extOf(p: string): string {
  const dot = p.lastIndexOf(".");
  if (dot === -1) return "";
  return p.slice(dot).toLowerCase();
}

function byteLength(s: string): number {
  // Approximate UTF-8 byte length. Avoids pulling in TextEncoder polyfills in
  // older runtimes; close enough for size-cap enforcement.
  return new Blob([s]).size;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Check the first four bytes against the ZIP local-file-header magic
 * (`PK\x03\x04`). Lets us trust the content even when the filename lies
 * (e.g., a `.md` upload that's secretly a zip, or a `.skill` from a tool
 * that doesn't preserve extensions).
 */
function looksLikeZip(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 4) return false;
  const view = new Uint8Array(buf, 0, 4);
  return view[0] === 0x50 && view[1] === 0x4b && view[2] === 0x03 && view[3] === 0x04;
}
