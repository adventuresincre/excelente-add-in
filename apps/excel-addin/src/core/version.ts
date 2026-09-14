/**
 * Build identity for the running bundle.
 *
 * Values are substituted at build time by `define` in vite.config.ts. See the
 * comment there for why the app semver, the git SHA, and the manifest version
 * are three separate numbers.
 */

/** Product semver from package.json, e.g. "0.2.0". */
export const APP_VERSION: string = __APP_VERSION__;

/** Git short SHA this bundle was built from; may carry a "-dirty" suffix. */
export const BUILD_SHA: string = __BUILD_SHA__;

/**
 * ISO timestamp of the COMMIT this bundle was built from — not the moment
 * the build ran. Keeping it deterministic is what makes two builds of one
 * sha byte-identical (see vite.config.ts).
 */
export const BUILD_TIME: string = __BUILD_TIME__;

/**
 * The single string that identifies a deployment. Compare two of these to
 * answer "am I running the latest?" — nothing else in the pane can.
 */
export const BUILD_ID = `${APP_VERSION}+${BUILD_SHA}`;

/** Build date as `YYYY-MM-DD`, for display next to the version. */
export function buildDate(): string {
  return BUILD_TIME.slice(0, 10);
}

export interface DeployedVersion {
  version: string;
  sha: string;
  buildTime: string;
  buildId: string;
  /**
   * Which instance served this file: "dev" or "prod".
   *
   * Deliberately NOT compiled into the bundle. If the environment were a
   * build-time constant, the dev and production bundles would differ, and
   * "promote exactly what you tested" would stop being verifiable — the
   * whole point of having a dev instance. Keeping it in version.json means
   * one artifact serves both, and the pane asks at runtime which one it is.
   *
   * Absent on artifacts built before this field existed; treat as "prod"
   * only for display, never for a safety decision.
   */
  env?: "dev" | "prod";
}

/**
 * Fetch the version currently deployed to this origin and report whether the
 * running pane is behind it.
 *
 * Office caches the taskpane bundle aggressively, and a stale pane is
 * indistinguishable from a fresh one by eye — which has already cost a test
 * round on this project ("re-test after hard-reload of the current bundle").
 * `version.json` is emitted next to the bundle at build time, so a mismatch
 * means the browser is holding old code.
 *
 * Returns null when the check cannot be made (dev server, offline, no file).
 * A failed check must never look like an available update.
 */
export async function checkForUpdate(
  signal?: AbortSignal
): Promise<{ deployed: DeployedVersion; stale: boolean } | null> {
  try {
    // Cache-bust: asking the cache whether the cache is stale is useless.
    const res = await fetch(`/version.json?t=${Date.now()}`, {
      cache: "no-store",
      signal,
    });
    if (!res.ok) return null;
    const deployed = (await res.json()) as DeployedVersion;
    if (typeof deployed?.buildId !== "string") return null;
    return { deployed, stale: deployed.buildId !== BUILD_ID };
  } catch {
    return null;
  }
}
