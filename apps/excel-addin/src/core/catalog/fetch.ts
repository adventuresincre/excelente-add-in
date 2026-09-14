import type { CatalogEntry, ModelCatalogFile } from "./types";

/**
 * Same-origin path nginx aliases to the nightly job's output. Same-origin on
 * purpose: no CORS, no CSP allowlist entry, no new host for the Office
 * runtime to trust, and the Vite dev server proxies it to the dev droplet the
 * way it already proxies `/api/free`.
 */
export const MODEL_CATALOG_ENDPOINT = "/data/model-catalog.json";

/**
 * One in-flight/settled promise per pane session. Settings, the picker and
 * the explorer all want the same file and mount independently; without the
 * cache each mount would be its own request.
 */
let cached: Promise<ModelCatalogFile | null> | null = null;

export interface FetchModelCatalogOptions {
  /** Drop the session cache and refetch (the Settings refresh button). */
  force?: boolean;
  /** Test seam. */
  fetchImpl?: typeof fetch;
}

/**
 * Load the capability catalog, or null when it is unavailable.
 *
 * Null is a normal state, not an error path: a fresh instance whose nginx
 * location is not configured yet, a job that has not run, an offline pane.
 * The picker must render correctly without scores. Failures are NOT cached,
 * so a later mount retries instead of showing an unranked list for the rest
 * of the session.
 */
export function fetchModelCatalog(
  opts: FetchModelCatalogOptions = {}
): Promise<ModelCatalogFile | null> {
  if (opts.force) cached = null;
  if (cached) return cached;
  const fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  cached = (async () => {
    const res = await fetchImpl(MODEL_CATALOG_ENDPOINT, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`catalog ${res.status}`);
    const parsed = parseModelCatalog(await res.json());
    if (!parsed) throw new Error("catalog: unrecognised shape");
    return parsed;
  })().catch(() => {
    cached = null;
    return null;
  });
  return cached;
}

/** Test seam — forget the session cache between cases. */
export function resetModelCatalogCache(): void {
  cached = null;
}

/**
 * Validate the file's shape defensively. The job and the pane deploy
 * independently, so an unknown schema or a malformed entry must degrade to
 * "no score" for that model, never to a crash in Settings.
 */
export function parseModelCatalog(raw: unknown): ModelCatalogFile | null {
  if (!isObject(raw)) return null;
  if (raw.schemaVersion !== 1) return null;
  if (!isObject(raw.models)) return null;
  const models: Record<string, CatalogEntry> = {};
  for (const [id, value] of Object.entries(raw.models)) {
    const entry = toEntry(value);
    if (entry) models[id] = entry;
  }
  const source = isObject(raw.source) ? raw.source : {};
  return {
    schemaVersion: 1,
    generatedAt: typeof raw.generatedAt === "string" ? raw.generatedAt : "",
    source: {
      name: typeof source.name === "string" ? source.name : "Artificial Analysis",
      url: typeof source.url === "string" ? source.url : undefined,
      indexVersion: typeof source.indexVersion === "string" ? source.indexVersion : undefined,
    },
    models,
  };
}

function toEntry(value: unknown): CatalogEntry | null {
  if (!isObject(value)) return null;
  if (!isFiniteNumber(value.capability)) return null;
  const entry: CatalogEntry = { capability: value.capability };
  if (isObject(value.capabilityByEffort)) {
    const byEffort: Record<string, number> = {};
    for (const [effort, score] of Object.entries(value.capabilityByEffort)) {
      if (isFiniteNumber(score)) byEffort[effort] = score;
    }
    if (Object.keys(byEffort).length > 0) entry.capabilityByEffort = byEffort;
  }
  if (typeof value.releaseDate === "string" && /^\d{4}-\d{2}-\d{2}/.test(value.releaseDate)) {
    entry.releaseDate = value.releaseDate.slice(0, 10);
  }
  if (isFiniteNumber(value.outputTokensPerSecond)) {
    entry.outputTokensPerSecond = value.outputTokensPerSecond;
  }
  if (typeof value.aaSlug === "string") entry.aaSlug = value.aaSlug;
  if (typeof value.aaName === "string") entry.aaName = value.aaName;
  if (typeof value.matchedBy === "string") entry.matchedBy = value.matchedBy;
  return entry;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
