/**
 * Which edition is being built, and where it lives.
 *
 * Excelente ships in editions (see `src/edition/types.ts`). Each is a folder
 * under `src/edition/<name>/` and the build aliases `@edition` to one of
 * them. This module is the single place that decides which:
 *
 *   1. `EXCELENTE_EDITION` in the environment, when set.
 *   2. `edition.json` beside `package.json`, when present (`{ "edition": "acre" }`).
 *      A hosted distribution commits this file so its developers and its
 *      deploy script build the same thing without remembering a flag.
 *   3. `community`, the default. A fresh clone of the public repository has
 *      no `edition.json` and builds the community edition.
 *
 * Shared by `vite.config.ts`, `scripts/edition.mjs` and
 * `scripts/check-edition-boundary.mjs`. Plain ESM with no dependencies so
 * both Vite's config bundler and Node can load it.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ADDIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const EDITIONS_DIR = resolve(ADDIN_ROOT, "src", "edition");
export const DEFAULT_EDITION = "community";
export const EDITION_FILE = resolve(ADDIN_ROOT, "edition.json");

/** Folder names under `src/edition/` that carry an `index.ts(x)`, sorted. */
export function listEditions() {
  if (!existsSync(EDITIONS_DIR)) return [];
  return readdirSync(EDITIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter(
      (name) =>
        existsSync(resolve(EDITIONS_DIR, name, "index.ts")) ||
        existsSync(resolve(EDITIONS_DIR, name, "index.tsx"))
    )
    .sort();
}

/** Contents of `edition.json`, or `{}` when absent. */
export function readEditionFile() {
  if (!existsSync(EDITION_FILE)) return {};
  return JSON.parse(readFileSync(EDITION_FILE, "utf8"));
}

/** The edition this build targets. Throws on a name with no folder. */
export function resolveEdition(env = process.env) {
  const fromEnv = (env.EXCELENTE_EDITION ?? "").trim();
  const name = fromEnv || readEditionFile().edition || DEFAULT_EDITION;
  const available = listEditions();
  if (!available.includes(name)) {
    throw new Error(
      `Unknown edition "${name}". Available under src/edition/: ${available.join(", ") || "(none)"}`
    );
  }
  return name;
}

/** Absolute path of an edition's folder (what `@edition` aliases to). */
export function editionDir(name) {
  return resolve(EDITIONS_DIR, name);
}

/**
 * Optional dev-only proxy target for the paths a deployed instance serves
 * through its own web server (`/api/*`, `/data`). Environment first, then
 * `edition.json`'s `devProxyTarget`, else empty (nothing proxied).
 */
export function devProxyTarget(env = process.env) {
  const raw = env.EXCELENTE_DEV_PROXY_TARGET ?? readEditionFile().devProxyTarget ?? "";
  return String(raw).replace(/\/+$/, "");
}
