import {
  familyOf,
  isFreeTierModel,
  type ModelFamily,
  type ModelInfo,
} from "../../../core/openrouter";
import {
  ACRE_FREE_SENTINEL_ID,
  acreFreeLabel,
  DEFAULT_PUBLIC_CONFIG,
  isAcreFreeModel,
} from "../../../core/config";
import {
  compareByCapability,
  formatPricePair,
  formatRank,
  rankModels,
  topByCapability,
  topByValue,
  type RankTable,
} from "./model-metrics";

/**
 * One `<optgroup>` per lab, in the order they appear in the picker.
 *
 * Insertion order IS display order, and it is alphabetical by **lab** — the
 * company — not by model brand. Those disagree (Alibaba ships Qwen, Z.AI
 * ships GLM), so the lab name is written first in the label too; sorting by
 * one key while showing another reads as random order.
 */
const FAMILY_DISPLAY: Array<{ family: ModelFamily; lab: string; brand: string }> = [
  { family: "qwen", lab: "Alibaba", brand: "Qwen" },
  { family: "claude", lab: "Anthropic", brand: "Claude" },
  { family: "deepseek", lab: "DeepSeek", brand: "DeepSeek" },
  { family: "gemini", lab: "Google", brand: "Gemini" },
  { family: "meta", lab: "Meta", brand: "Meta" },
  { family: "kimi", lab: "Moonshot AI", brand: "Kimi" },
  { family: "gpt", lab: "OpenAI", brand: "GPT" },
  { family: "grok", lab: "xAI", brand: "Grok" },
  { family: "glm", lab: "Z.AI", brand: "GLM" },
];

/** "Anthropic (Claude)", but just "Meta" when lab and brand are the same. */
function labFamilyLabel(entry: { lab: string; brand: string }): string {
  return entry.lab === entry.brand ? entry.lab : `${entry.lab} (${entry.brand})`;
}

/**
 * Lab names for models outside the nine families — the free tier's vendors
 * — keyed by OpenRouter vendor prefix.
 */
const VENDOR_LABELS: Record<string, string> = {
  nvidia: "NVIDIA",
  google: "Google",
  openrouter: "OpenRouter",
  meta: "Meta",
  "meta-llama": "Meta",
  qwen: "Alibaba",
  anthropic: "Anthropic",
  openai: "OpenAI",
  deepseek: "DeepSeek",
  moonshotai: "Moonshot AI",
  "x-ai": "xAI",
  "z-ai": "Z.AI",
};

/** The company behind a model, for cards and rows. */
export function labForModel(m: ModelInfo): string {
  if (isAcreFreeModel(m.id)) return "A.CRE";
  if (m.family) {
    const entry = FAMILY_DISPLAY.find((f) => f.family === m.family);
    if (entry) return entry.lab;
  }
  const vendor = m.id.split("/")[0] ?? "";
  if (VENDOR_LABELS[vendor]) return VENDOR_LABELS[vendor];
  return vendor ? vendor.charAt(0).toUpperCase() + vendor.slice(1) : "";
}

/**
 * OpenRouter display names are "Vendor: Model". Inside a lab's own optgroup
 * the vendor is noise, so the picker and cards show the model part only.
 */
export function displayName(m: ModelInfo): string {
  if (isAcreFreeModel(m.id)) return m.name;
  const i = m.name.indexOf(": ");
  return i === -1 ? m.name : m.name.slice(i + 2);
}

/** Models registered with OpenRouter longer ago than this are not listed at all. */
export const MODEL_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
/**
 * "Latest" means released within the last twelve months. The lab's release
 * date from the catalog is used when known; OpenRouter's registration date
 * otherwise. Everything else still inside the listing window is "Legacy".
 */
export const LATEST_WINDOW_SECONDS = 365 * 24 * 60 * 60;

export function releasedAtOf(m: ModelInfo): number {
  return m.releasedAt ?? m.created;
}

/** Picker order: most capable first, unscored after every scored, newest within a tie. */
export function sortForPicker(models: readonly ModelInfo[]): ModelInfo[] {
  return [...models].sort(compareByCapability);
}

/**
 * Section labels, in display order.
 *
 * A.CRE Free is called out as the students/learners option rather than just
 * "free": it costs A.CRE real money on A.CRE's own OpenRouter key, so
 * anyone who has brought their own key should be reaching for an OpenRouter
 * free model instead — which is only possible now that free models are
 * admitted past the family allowlist.
 *
 * No finer split than this is honest. Prompt retention is a PROVIDER
 * property, not a model property, and OpenRouter publishes it nowhere a
 * client can read — verified 2026-09-10 against `/api/v1/models`,
 * `/api/v1/models/{slug}/endpoints` and `/api/v1/providers`, which carry
 * policy URLs and no flags. A "does not retain" group would therefore be an
 * unverifiable privacy claim in a label, so the free group carries the
 * warning for all of them. The enforceable version, if it is ever wanted,
 * is `provider: { data_collection: "deny" }` on the wire.
 */
export const ACRE_FREE_GROUP_LABEL = "A.CRE Free Model (For Students / Learners)";
export const FREE_GROUP_LABEL = "Free Models (may train on your data)";

export interface FamilyGroup {
  family: ModelFamily;
  label: string;
  models: ModelInfo[];
}

/** One `<optgroup>` in the model picker. */
export interface PickerGroup {
  key: string;
  label: string;
  models: ModelInfo[];
  /**
   * The models here also appear in their lab's group. A native `<select>`
   * needs distinct option values, so options in a duplicating group are
   * encoded with `pickerOptionValue` and decoded with `pickerOptionModelId`.
   */
  duplicates?: boolean;
  /** Which rank the option text leads with. Defaults to capability. */
  labelStyle?: "capability" | "value";
}

/** The picker's groups plus the rank table every label in them is drawn from. */
export interface PickerModel {
  groups: PickerGroup[];
  ranks: RankTable;
}

export const TOP_CAPABILITY_GROUP_LABEL = "Top 10 · Capability (tools, reasoning, vision)";
export const TOP_VALUE_GROUP_LABEL = "Top 10 · Value (tools, reasoning, vision)";

/** Option value for `m` inside `group` — distinct for the duplicating Top 10 groups. */
export function pickerOptionValue(group: PickerGroup, m: ModelInfo): string {
  return group.duplicates ? `${group.key}::${m.id}` : m.id;
}

/** The model id behind an option value, whichever group it came from. */
export function pickerOptionModelId(value: string): string {
  const sep = value.indexOf("::");
  return sep >= 0 ? value.slice(sep + 2) : value;
}

/**
 * Resolve the "Auto" vision default against the live (vision-capable,
 * tool-capable) model list: the configured `byokDefaults.visionModelId`
 * when present, else the newest vision-capable model in the SAME FAMILY as
 * that configured id, else null — callers treat null as "no dedicated
 * vision model". Shared by App (stream wiring) and ModelsSection (the Auto
 * hint) so the hint always names exactly what the stream will use.
 *
 * The fallback derives its family from the configured id rather than naming
 * one: it used to hardcode Claude, which meant retiring the configured id
 * silently moved every BYOK user to a different vendor than the one the
 * config names. Deriving it keeps the fallback pointed at the same lineup
 * the owner chose (2026-09-04: all roles on x-ai/grok-4.6).
 */
export function pickAutoVisionModel(visionCapable: ModelInfo[]): ModelInfo | null {
  const configuredId = DEFAULT_PUBLIC_CONFIG.byokDefaults.visionModelId;
  if (!configuredId) return null;
  const exact = visionCapable.find((m) => m.id === configuredId);
  if (exact) return exact;
  // Configured id is retired or absent from the live list — stay in its
  // family rather than jumping vendors. `familyOf` is the same resolver
  // `client.listModels` tags models with, so this cannot drift from the
  // picker's grouping.
  const family = familyOf(configuredId);
  return family ? (visionCapable.find((m) => m.family === family) ?? null) : null;
}

/**
 * Does the primary model read images itself? `undefined` means "not
 * knowable yet" — the list hasn't loaded, or carries no such id — and is
 * kept distinct from `false` so no UI calls a model blind on the strength
 * of a list that hasn't arrived.
 */
export function primarySupportsVision(
  models: ModelInfo[],
  primaryId: string | null | undefined
): boolean | undefined {
  if (!primaryId) return undefined;
  // The A.CRE Free sentinel is never in the OpenRouter list; its pinned
  // model is vision-capable and the proxy re-pins it on every call anyway.
  if (isAcreFreeModel(primaryId)) return true;
  return models.find((m) => m.id === primaryId)?.supportsVision;
}

/**
 * Which model receives images from the screenshot tools. `null` means "no
 * dedicated vision model" — images go straight to the primary's own stream.
 *
 * Order: the user's explicit override, then the primary itself when it can
 * see, then the configured fallback.
 *
 * Sending images to a vision-capable primary inline is strictly better than
 * a separate describer: one call instead of two, one model billed instead of
 * two, and the image arrives with the conversation context the primary
 * already holds. The dedicated model exists for primaries that would
 * otherwise be blind to a screenshot — which matters because the agent
 * screenshots the sheet to verify its own writes — not as a preference.
 *
 * An unknown primary falls through to the dedicated model deliberately:
 * routing an image to a model that cannot read it fails silently, while an
 * unnecessary describer call is merely wasteful.
 */
export function resolveDefaultVisionModelId(
  models: ModelInfo[],
  pref: { modelId?: string | null; visionModelId?: string | null } | null | undefined
): string | null {
  if (pref?.visionModelId) return pref.visionModelId;
  const primaryId = pref?.modelId;
  if (!primaryId) return null;
  if (primarySupportsVision(models, primaryId)) return null;
  const visionCapable = models.filter((m) => m.supportsTools && m.supportsVision);
  return pickAutoVisionModel(visionCapable)?.id ?? null;
}

/**
 * Group models by family for the picker UI. Preserves the caller's order
 * within each family — `groupModelsForPicker` sorts first. Families come
 * back in the FAMILY_DISPLAY order. Empty families are dropped so the
 * picker doesn't render labels with zero models under them.
 */
export function groupByFamily(models: ModelInfo[]): FamilyGroup[] {
  const buckets = new Map<ModelFamily, ModelInfo[]>();
  for (const m of models) {
    if (m.family === null) continue;
    const existing = buckets.get(m.family);
    if (existing) existing.push(m);
    else buckets.set(m.family, [m]);
  }
  const groups: FamilyGroup[] = [];
  for (const entry of FAMILY_DISPLAY) {
    const list = buckets.get(entry.family);
    if (list && list.length > 0) {
      groups.push({ family: entry.family, label: labFamilyLabel(entry), models: list });
    }
  }
  return groups;
}

export function isOpenRouterFreeModel(m: ModelInfo): boolean {
  if (isAcreFreeModel(m.id)) return false;
  return isFreeTierModel(m);
}

function isBatchVariant(m: ModelInfo): boolean {
  return m.id.includes(":batch");
}

/**
 * Synthetic row so A.CRE Free is always first in every picker. `modelLabel`
 * is the live model name from the proxy's /health (see `useAcreFreeInfo`);
 * omit it and the row reads as the bare tier name, which is what the first
 * paint shows before that fetch lands. Carries no capability score on
 * purpose: it is a tier A.CRE re-pins at will, not a model the user chose.
 */
export function acreFreePickerModel(modelLabel?: string | null): ModelInfo {
  return {
    id: ACRE_FREE_SENTINEL_ID,
    name: acreFreeLabel(modelLabel),
    contextLength: 1_310_000,
    pricing: { prompt: 0, completion: 0 },
    supportsTools: true,
    supportsReasoning: false,
    supportsVision: true,
    created: Number.MAX_SAFE_INTEGER,
    family: "glm",
  };
}

/**
 * Picker sections, in display order:
 *  1. A.CRE Free Model (For Students / Learners)
 *  2. Free Models (may train on your data) — OpenRouter's free tier
 *  3. Paid Models (Latest) · per lab — released within the last 12 months
 *  4. Paid Models (Legacy) · per lab — older, but registered within 12 months
 *
 * Within every section models are ordered most capable first (the nightly
 * catalog's score), unscored ones after, newest within a tie. Labs stay
 * alphabetical, so the picker reads "by company, then by capability" — the
 * two things someone weighing value actually compares.
 *
 * Free models are the one section allowed in from outside the nine-family
 * allowlist — none of OpenRouter's free models are in those families, so
 * filtering by family alone left this whole tier empty.
 *
 * Native `<select>` cannot nest optgroups, so Latest/Legacy are prefixes
 * on each lab group. Batch routing variants (`:batch`) are omitted. Models
 * registered more than 365 days ago are omitted from every section.
 */
export function groupModelsForPicker(
  models: ModelInfo[],
  nowSeconds: number = Math.floor(Date.now() / 1000),
  options: { includeAcreFree?: boolean; acreFreeModelLabel?: string | null } = {}
): PickerGroup[] {
  return buildPicker(models, nowSeconds, options).groups;
}

/**
 * Every model the picker can list — the population every rank is relative
 * to, so the details card and the explorer count the same "of N" the
 * dropdown does. Same filters as the groups: a recognised family (or free),
 * registered within the window, not a batch variant, not A.CRE Free.
 */
export function pickerEligibleModels(
  models: readonly ModelInfo[],
  nowSeconds: number = Math.floor(Date.now() / 1000)
): ModelInfo[] {
  const oldestListed = nowSeconds - MODEL_MAX_AGE_SECONDS;
  return sortForPicker(
    models.filter(
      (m) =>
        // A free model with no family still belongs — see the doc comment.
        (m.family !== null || isOpenRouterFreeModel(m)) &&
        m.created >= oldestListed &&
        !isBatchVariant(m) &&
        !isAcreFreeModel(m.id)
    )
  );
}

/**
 * `groupModelsForPicker` plus the rank table its labels use. Two Top 10
 * groups sit between Free and the first lab: the ten most capable and the
 * ten best-value models that can use tools, reason AND see screenshots —
 * the cross-lab shortlist the per-lab groups cannot give. Their models
 * repeat inside their lab's group, flagged `duplicates` for the `<select>`.
 */
export function buildPicker(
  models: readonly ModelInfo[],
  nowSeconds: number = Math.floor(Date.now() / 1000),
  options: { includeAcreFree?: boolean; acreFreeModelLabel?: string | null } = {}
): PickerModel {
  const includeAcreFree = options.includeAcreFree ?? true;
  const oldestLatest = nowSeconds - LATEST_WINDOW_SECONDS;
  const usable = pickerEligibleModels(models, nowSeconds);
  const ranks = rankModels(usable);
  const free = usable.filter(isOpenRouterFreeModel);
  // Paid needs a family: the allowlist's end-to-end guarantee still governs
  // anything the user pays for.
  const paid = usable.filter((m) => m.family !== null && !isOpenRouterFreeModel(m));
  const paidFamilies = groupByFamily(paid);
  const isLatest = (m: ModelInfo) => releasedAtOf(m) >= oldestLatest;

  const groups: PickerGroup[] = includeAcreFree
    ? [
        {
          key: "acre",
          label: ACRE_FREE_GROUP_LABEL,
          models: [acreFreePickerModel(options.acreFreeModelLabel)],
        },
      ]
    : [];

  if (free.length > 0) {
    groups.push({
      key: "free",
      label: FREE_GROUP_LABEL,
      models: free,
    });
  }

  const topCapability = topByCapability(usable, ranks);
  if (topCapability.length > 0) {
    groups.push({
      key: "top-capability",
      label: TOP_CAPABILITY_GROUP_LABEL,
      models: topCapability,
      duplicates: true,
      labelStyle: "capability",
    });
  }
  const topValue = topByValue(usable, ranks);
  if (topValue.length > 0) {
    groups.push({
      key: "top-value",
      label: TOP_VALUE_GROUP_LABEL,
      models: topValue,
      duplicates: true,
      labelStyle: "value",
    });
  }

  for (const g of paidFamilies) {
    const latest = g.models.filter(isLatest);
    if (latest.length === 0) continue;
    groups.push({
      key: `latest-${g.family}`,
      label: `Paid Models (Latest) · ${g.label}`,
      models: latest,
    });
  }

  for (const g of paidFamilies) {
    const legacy = g.models.filter((m) => !isLatest(m));
    if (legacy.length === 0) continue;
    groups.push({
      key: `legacy-${g.family}`,
      label: `Paid Models (Legacy) · ${g.label}`,
      models: legacy,
    });
  }

  return { groups, ranks };
}

/**
 * One option's text: `name · #rank · price`. A native `<select>` can show
 * nothing but text, so this is the whole comparison a user gets before the
 * details card. The rank is the model's place among the models listed —
 * "#2" reads at a glance where the raw benchmark score ("53") did not
 * (2026-09-12). In the Top 10 Value group the option leads with the value
 * rank instead (`value #3`). The rank is omitted, not dashed, for an
 * unscored model, and for every model when no rank table is supplied.
 */
export function labelForPickerModel(
  m: ModelInfo,
  ranks?: RankTable,
  style: "capability" | "value" = "capability"
): string {
  // The synthetic A.CRE Free row already carries its full label (tier plus
  // the live model name) in `name`; the decorations below are meaningless
  // for a subsidized, server-pinned model.
  if (isAcreFreeModel(m.id)) return m.name;
  const isFree = isOpenRouterFreeModel(m);
  const parts: string[] = [`${isFree ? "🆓 " : ""}${displayName(m)}`];
  const r = ranks?.byId.get(m.id);
  if (style === "value" && r?.value !== undefined) parts.push(`value ${formatRank(r.value)}`);
  else if (r?.capability !== undefined) parts.push(formatRank(r.capability));
  parts.push(isFree ? "free" : formatPricePair(m.pricing));
  return parts.join(" · ");
}
