import { parseSkillFile } from "./frontmatter";
import type { Skill, SkillSource, SkillSummary } from "./types";
import type { AcreSkillEntry } from "../config";

export const ACRE_SOURCE_ID = "registry:acre";

export interface AcreSkillSourceOptions {
  /** Skill entries from `member.skills` (a config snapshot). */
  skills: AcreSkillEntry[];
  /** Whether the member has Accelerator entitlement (gates acceleratorOnly). */
  accelerator: boolean;
  /** Current member bearer token; read lazily so refreshes are picked up. */
  getToken: () => string;
  fetch?: typeof fetch;
}

/**
 * `SkillSource` for the A.CRE remote registry. `list()` is cheap — it maps the
 * config-provided summaries and filters out Accelerator-only skills for
 * non-Accelerator members, so gated skills never surface. `load()` fetches the
 * `SKILL.md` body (and any manifest resources) with the member token, on
 * demand.
 *
 * The skill set is a config snapshot; recreate the source when `member`
 * config changes (config version bump invalidates derived state).
 */
export function acreSkillSource(opts: AcreSkillSourceOptions): SkillSource {
  const fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const accessible = opts.skills.filter((s) => opts.accelerator || !s.acceleratorOnly);
  const byName = new Map(accessible.map((s) => [s.name, s] as const));

  return {
    id: ACRE_SOURCE_ID,
    async list() {
      return accessible.map<SkillSummary>((s) => ({
        name: s.name,
        description: s.description,
        whenToUse: s.whenToUse,
        version: s.version,
        sourceId: ACRE_SOURCE_ID,
      }));
    },
    async load(name) {
      const entry = byName.get(name);
      if (!entry) throw new Error(`A.CRE skill not available: ${name}`);

      const token = opts.getToken();
      const body = await fetchText(fetchImpl, entry.bodyUrl, token);
      const parsed = parseSkillFile(body);

      const manifest = entry.resourceManifest ?? [];
      const loaded = await Promise.all(
        manifest.map(async (r) => [r.path, await fetchText(fetchImpl, r.url, token)] as const)
      );
      const resources = new Map<string, string>(loaded);

      return {
        summary: { ...parsed.frontmatter, sourceId: ACRE_SOURCE_ID },
        body: parsed.body,
        resources,
      } satisfies Skill;
    },
  };
}

async function fetchText(fetchImpl: typeof fetch, url: string, token: string): Promise<string> {
  const res = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`A.CRE skill fetch failed (${res.status}) for ${url}`);
  }
  return res.text();
}
