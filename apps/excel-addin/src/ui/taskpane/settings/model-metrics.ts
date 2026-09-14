import { isFreeTierModel, resolveEffort, type ModelInfo } from "../../../core/openrouter";
import type { ReasoningLevel } from "../../../core/storage";
import { isAcreFreeModel } from "../../../core/config";

/**
 * Pure helpers behind the picker labels, the details card and the explorer.
 * Everything a component would otherwise compute inline lives here, because
 * this repo has no component harness and inline logic is untested logic.
 */

/** Whole number for display; the index is published to one decimal. */
export function formatCapability(score: number): string {
  return String(Math.round(score));
}

/** "$1.25/$10.00" — per million tokens, prompt then completion. */
export function formatPricePair(pricing: ModelInfo["pricing"]): string {
  return `$${(pricing.prompt * 1_000_000).toFixed(2)}/$${(pricing.completion * 1_000_000).toFixed(2)}`;
}

/** "$1.25 in · $10.00 out per 1M tokens", or "Free". */
export function formatPriceLong(m: ModelInfo): string {
  if (isFreeTierModel(m)) return "Free";
  const inPerM = m.pricing.prompt * 1_000_000;
  const outPerM = m.pricing.completion * 1_000_000;
  return `$${inPerM.toFixed(2)} in · $${outPerM.toFixed(2)} out per 1M tokens`;
}

export function formatContext(n: number): string {
  if (n >= 1_000_000) return `${Math.round(n / 1_000_000)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return `${n}`;
}

export function formatSpeed(tps: number | undefined): string | null {
  if (tps === undefined || !Number.isFinite(tps)) return null;
  return `${Math.round(tps)} tokens/s`;
}

/** "Jun 2026" from unix seconds; null when unknown or zero. */
export function formatReleased(unixSeconds: number | undefined): string | null {
  if (!unixSeconds) return null;
  const d = new Date(unixSeconds * 1000);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/**
 * Artificial Analysis's own 3:1 blend — three prompt tokens per completion
 * token — per million tokens. Zero for free models.
 */
export function blendedPricePerMillion(m: ModelInfo): number {
  return ((3 * m.pricing.prompt + m.pricing.completion) / 4) * 1_000_000;
}

/**
 * Dense rank among the scored models in a list: ties share a rank, the next
 * distinct score takes the next integer. Null for an unscored model.
 */
export function capabilityRank(
  models: readonly ModelInfo[],
  m: ModelInfo
): { rank: number; of: number } | null {
  if (m.capability === undefined) return null;
  const scores = Array.from(
    new Set(
      models
        .filter((x) => !isAcreFreeModel(x.id) && x.capability !== undefined)
        .map((x) => x.capability as number)
    )
  ).sort((a, b) => b - a);
  const rank = scores.indexOf(m.capability) + 1;
  if (rank === 0) return null;
  const of = models.filter((x) => !isAcreFreeModel(x.id) && x.capability !== undefined).length;
  return { rank, of };
}

/** This model's score as a fraction of the best score in the list, for a bar. */
export function relativeCapability(models: readonly ModelInfo[], m: ModelInfo): number | null {
  if (m.capability === undefined) return null;
  let max = 0;
  for (const x of models) if (x.capability !== undefined && x.capability > max) max = x.capability;
  if (max <= 0) return null;
  return Math.max(0, Math.min(1, m.capability / max));
}

/**
 * Capability per dollar of blended price. Infinity for a scored free model
 * — the best possible value — and null when unscored.
 */
export function valueScore(m: ModelInfo): number | null {
  if (m.capability === undefined) return null;
  const price = blendedPricePerMillion(m);
  if (price <= 0) return Number.POSITIVE_INFINITY;
  return m.capability / price;
}

/**
 * The published score for the configuration the user's reasoning setting
 * actually buys on this model, via the same ladder the request uses. Null
 * when the benchmark did not publish that variant.
 */
export function capabilityAtSetting(
  m: ModelInfo,
  level: ReasoningLevel
): { effort: string; score: number } | null {
  const byEffort = m.capabilityByEffort;
  if (!byEffort) return null;
  const policy = m.reasoningPolicy;
  const effort =
    level === "off"
      ? policy?.mandatory
        ? resolveEffort("low", policy)
        : "none"
      : resolveEffort(level, policy);
  const score = byEffort[effort] ?? (effort === "none" ? byEffort.default : undefined);
  return score === undefined ? null : { effort, score };
}

/**
 * Picker order within a lab and the explorer's default sort: most capable
 * first, unscored models after every scored one, newest first within a tie.
 */
export function compareByCapability(a: ModelInfo, b: ModelInfo): number {
  const ca = a.capability;
  const cb = b.capability;
  if (ca !== undefined && cb !== undefined && ca !== cb) return cb - ca;
  if (ca !== undefined && cb === undefined) return -1;
  if (ca === undefined && cb !== undefined) return 1;
  if (a.created !== b.created) return b.created - a.created;
  return a.id.localeCompare(b.id);
}

/* ---------------------------------- ranks ---------------------------------- */

/** A model's standing among the models the picker lists. */
export interface ModelRanks {
  /** Dense rank by capability among scored listed models; 1 is the most capable. */
  capability?: number;
  /** Dense rank by value (capability per blended dollar) among scored PAID listed models. */
  value?: number;
}

export interface RankTable {
  byId: ReadonlyMap<string, ModelRanks>;
  /** How many listed models carry a capability rank. */
  ofCapability: number;
  /** How many listed models carry a value rank. */
  ofValue: number;
}

export const EMPTY_RANKS: RankTable = { byId: new Map(), ofCapability: 0, ofValue: 0 };

/**
 * Rank every scored model in `population` — the picker's own list, so the
 * "#2" in an option means "the second most capable model you can pick
 * here", not a benchmark number nobody can place (2026-09-12: the raw score
 * read as noise in the dropdown). Capability rank is dense: ties share a
 * number, the next distinct score takes the next integer. Value ranks only
 * paid, scored models — a free model's capability per dollar is infinite,
 * which says nothing about it, and the free section already labels it free.
 */
export function rankModels(population: readonly ModelInfo[]): RankTable {
  const byId = new Map<string, ModelRanks>();
  const scored = population.filter((m) => !isAcreFreeModel(m.id) && m.capability !== undefined);
  const capScores = Array.from(new Set(scored.map((m) => m.capability as number))).sort(
    (a, b) => b - a
  );
  for (const m of scored) {
    byId.set(m.id, { capability: capScores.indexOf(m.capability as number) + 1 });
  }
  const priced = scored.filter((m) => Number.isFinite(valueScore(m)));
  const valueScores = Array.from(new Set(priced.map((m) => valueScore(m) as number))).sort(
    (a, b) => b - a
  );
  for (const m of priced) {
    byId.set(m.id, { ...byId.get(m.id), value: valueScores.indexOf(valueScore(m) as number) + 1 });
  }
  return { byId, ofCapability: scored.length, ofValue: priced.length };
}

/** "#2" */
export function formatRank(rank: number): string {
  return `#${rank}`;
}

export const TOP_LIST_SIZE = 10;

/**
 * The Top 10 lists admit only models that can do everything Excelente asks
 * of a primary: call tools, reason, and read their own screenshots. A model
 * missing any of those needs a helper model, and "top" should not need a
 * footnote.
 */
export function qualifiesForTopLists(m: ModelInfo): boolean {
  return !isAcreFreeModel(m.id) && m.supportsTools && m.supportsReasoning && m.supportsVision;
}

/** Qualifying models with a capability rank, best first, at most `size`. */
export function topByCapability(
  population: readonly ModelInfo[],
  ranks: RankTable,
  size: number = TOP_LIST_SIZE
): ModelInfo[] {
  const rankOf = (m: ModelInfo) => ranks.byId.get(m.id)?.capability;
  return population
    .filter((m) => qualifiesForTopLists(m) && rankOf(m) !== undefined)
    .sort((a, b) => (rankOf(a) as number) - (rankOf(b) as number) || compareByCapability(a, b))
    .slice(0, size);
}

/** Qualifying paid models with a value rank, best value first, at most `size`. */
export function topByValue(
  population: readonly ModelInfo[],
  ranks: RankTable,
  size: number = TOP_LIST_SIZE
): ModelInfo[] {
  const rankOf = (m: ModelInfo) => ranks.byId.get(m.id)?.value;
  return population
    .filter((m) => qualifiesForTopLists(m) && rankOf(m) !== undefined)
    .sort((a, b) => (rankOf(a) as number) - (rankOf(b) as number) || compareByCapability(a, b))
    .slice(0, size);
}

export type ExplorerSort = "capability" | "price" | "speed" | "value" | "newest";

export interface ExplorerFilters {
  freeOnly: boolean;
  vision: boolean;
  reasoningOffable: boolean;
}

export const EXPLORER_SORTS: Array<{ value: ExplorerSort; label: string }> = [
  { value: "capability", label: "Most capable" },
  { value: "value", label: "Best value" },
  { value: "price", label: "Cheapest" },
  { value: "speed", label: "Fastest" },
  { value: "newest", label: "Newest" },
];

function compareByPrice(a: ModelInfo, b: ModelInfo): number {
  const pa = blendedPricePerMillion(a);
  const pb = blendedPricePerMillion(b);
  if (pa !== pb) return pa - pb;
  return compareByCapability(a, b);
}

function compareBySpeed(a: ModelInfo, b: ModelInfo): number {
  const sa = a.outputTokensPerSecond;
  const sb = b.outputTokensPerSecond;
  if (sa !== undefined && sb !== undefined && sa !== sb) return sb - sa;
  if (sa !== undefined && sb === undefined) return -1;
  if (sa === undefined && sb !== undefined) return 1;
  return compareByCapability(a, b);
}

function compareByValue(a: ModelInfo, b: ModelInfo): number {
  const va = valueScore(a);
  const vb = valueScore(b);
  if (va !== null && vb !== null && va !== vb) return vb - va;
  if (va !== null && vb === null) return -1;
  if (va === null && vb !== null) return 1;
  return compareByCapability(a, b);
}

function compareByNewest(a: ModelInfo, b: ModelInfo): number {
  const ra = a.releasedAt ?? a.created;
  const rb = b.releasedAt ?? b.created;
  if (ra !== rb) return rb - ra;
  return compareByCapability(a, b);
}

const COMPARATORS: Record<ExplorerSort, (a: ModelInfo, b: ModelInfo) => number> = {
  capability: compareByCapability,
  price: compareByPrice,
  speed: compareBySpeed,
  value: compareByValue,
  newest: compareByNewest,
};

/**
 * The explorer's rows: a role's model list, filtered and sorted. A.CRE Free
 * never appears — it is a tier, not a model, and carries no score by design.
 */
export function explorerRows(
  models: readonly ModelInfo[],
  filters: ExplorerFilters,
  sort: ExplorerSort
): ModelInfo[] {
  let rows = models.filter((m) => !isAcreFreeModel(m.id));
  if (filters.freeOnly) rows = rows.filter((m) => isFreeTierModel(m));
  if (filters.vision) rows = rows.filter((m) => m.supportsVision);
  if (filters.reasoningOffable) rows = rows.filter((m) => m.reasoningPolicy?.mandatory !== true);
  return [...rows].sort(COMPARATORS[sort]);
}
