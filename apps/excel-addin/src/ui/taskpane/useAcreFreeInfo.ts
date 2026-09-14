import { useEffect, useState } from "react";
import { ACRE_FREE_ENDPOINT, prettyModelName } from "../../core/config";

export interface AcreFreeInfo {
  /**
   * Readable name of the model A.CRE Free is pinned to right now — "GLM 5.3
   * Flash". Null until `/health` answers, and forever if it never does; every
   * caller must render the bare tier name in that case rather than a guess.
   */
  modelLabel: string | null;
  /** OpenRouter cost per network address per calendar month, as enforced. */
  monthlyUsdCap: number | null;
}

const UNKNOWN: AcreFreeInfo = { modelLabel: null, monthlyUsdCap: null };

/**
 * One in-flight/settled promise shared by every consumer. Several pickers,
 * the chat empty state, and Settings all want this label, and they mount
 * independently — without the cache each mount would be its own request.
 */
let cached: Promise<AcreFreeInfo> | null = null;

/**
 * Ask the A.CRE Free proxy what it is currently serving.
 *
 * The pane deliberately knows nothing about the model at build time: A.CRE
 * changes it by editing `ACRE_FREE_MODEL` in `free.env` and restarting, with
 * no rebuild, no redeploy, and no Partner Center resubmission. Labels in the
 * UI therefore have to come from the server or not exist.
 *
 * `ACRE_FREE_MODEL_LABEL` wins when set — that is the escape hatch for ids
 * `prettyModelName` renders badly. Otherwise the id is prettified here.
 */
export function fetchAcreFreeInfo(): Promise<AcreFreeInfo> {
  if (cached) return cached;
  cached = (async () => {
    const res = await fetch(`${ACRE_FREE_ENDPOINT}/health`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`health ${res.status}`);
    const body = (await res.json()) as {
      model?: unknown;
      modelLabel?: unknown;
      ipMonthlyUsdCap?: unknown;
    };
    const label =
      typeof body.modelLabel === "string" && body.modelLabel.trim()
        ? body.modelLabel.trim()
        : typeof body.model === "string" && body.model.trim()
          ? prettyModelName(body.model.trim())
          : null;
    return {
      modelLabel: label,
      monthlyUsdCap:
        typeof body.ipMonthlyUsdCap === "number" && Number.isFinite(body.ipMonthlyUsdCap)
          ? body.ipMonthlyUsdCap
          : null,
    };
  })().catch(() => {
    // Offline, proxy down, nginx not yet configured on this instance. Drop
    // the cache so a later mount retries instead of showing the bare name
    // for the rest of the session.
    cached = null;
    return UNKNOWN;
  });
  return cached;
}

/**
 * Live A.CRE Free descriptor for UI copy. Starts as UNKNOWN and fills in,
 * so callers must read correctly with a null label — that is the state a
 * first paint always sees.
 */
export function useAcreFreeInfo(): AcreFreeInfo {
  const [info, setInfo] = useState<AcreFreeInfo>(UNKNOWN);
  useEffect(() => {
    let live = true;
    void fetchAcreFreeInfo().then((next) => {
      if (live) setInfo(next);
    });
    return () => {
      live = false;
    };
  }, []);
  return info;
}

/** Test seam — resets the module-level cache between cases. */
export function __resetAcreFreeInfoCache(): void {
  cached = null;
}
