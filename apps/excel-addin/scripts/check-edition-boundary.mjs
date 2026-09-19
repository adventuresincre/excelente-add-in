#!/usr/bin/env node
/**
 * The edition boundary, enforced.
 *
 * Excelente's shared tree (everything under `src/` outside `src/edition/`)
 * is the same in every edition and must never know which one it is in. Each
 * edition lives in `src/edition/<name>/` and is reached only through the
 * `@edition` alias. This script fails the build when that is not true:
 *
 *   1. Nothing outside an edition folder imports a path inside one, and no
 *      edition imports another. The only door is `@edition`.
 *   2. `@edition` is imported only from `src/ui/**` and `src/taskpane/**`.
 *      `src/core/**` stays edition-free; whatever it needs is passed in.
 *   3. An edition may declare tokens in `src/edition/<name>/boundary.json`
 *      that must not appear anywhere in `src/` outside that folder. This is
 *      how a hosted distribution proves its own names, endpoints and
 *      identifiers have not leaked into the shared tree, which is what ships
 *      in every other edition. A public checkout has no such file and rule 3
 *      is a no-op.
 *
 * Runs from any checkout: `node scripts/check-edition-boundary.mjs`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { ADDIN_ROOT, EDITIONS_DIR, editionDir, listEditions } from "./lib/edition.mjs";

const SRC = resolve(ADDIN_ROOT, "src");
const SCANNED = new Set([".ts", ".tsx", ".mts", ".js", ".mjs", ".css", ".md", ".json", ".html"]);
const ALLOWED_TO_IMPORT_EDITION = ["ui", "taskpane"].map((d) => resolve(SRC, d));

const editions = listEditions();
const failures = [];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walk(full, out);
    } else if (SCANNED.has(full.slice(full.lastIndexOf(".")))) {
      out.push(full);
    }
  }
  return out;
}

function editionOf(file) {
  for (const e of editions) {
    const dir = editionDir(e);
    if (file === dir || file.startsWith(dir + sep)) return e;
  }
  return null;
}

function isUnder(file, dir) {
  return file === dir || file.startsWith(dir + sep);
}

function rel(file) {
  return relative(ADDIN_ROOT, file).split(sep).join("/");
}

const tokensByEdition = new Map();
for (const e of editions) {
  const f = resolve(editionDir(e), "boundary.json");
  if (!existsSync(f)) continue;
  const parsed = JSON.parse(readFileSync(f, "utf8"));
  const tokens = Array.isArray(parsed.tokens) ? parsed.tokens.filter((t) => typeof t === "string" && t) : [];
  tokensByEdition.set(e, tokens);
}

const IMPORT_RE = /(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/g;

for (const file of walk(SRC)) {
  const text = readFileSync(file, "utf8");
  const here = editionOf(file);
  const isCode = /\.(m?[jt]sx?)$/.test(file);

  if (isCode) {
    for (const m of text.matchAll(IMPORT_RE)) {
      const spec = m[1];
      if (spec === "@edition" || spec.startsWith("@edition/")) {
        const ok = ALLOWED_TO_IMPORT_EDITION.some((d) => isUnder(file, d));
        if (!ok) {
          failures.push(
            `${rel(file)}: imports "${spec}". Only src/ui/** and src/taskpane/** may import @edition; core stays edition-free.`
          );
        }
        continue;
      }
      if (!spec.startsWith(".")) continue;
      const target = resolve(dirname(file), spec);
      const targetEdition = editionOf(target);
      if (targetEdition && targetEdition !== here) {
        failures.push(
          `${rel(file)}: imports "${spec}", which is inside the ${targetEdition} edition. Reach editions only through @edition.`
        );
      }
    }
  }

  for (const [e, tokens] of tokensByEdition) {
    if (here === e) continue;
    for (const token of tokens) {
      if (text.includes(token)) {
        const line = text.slice(0, text.indexOf(token)).split("\n").length;
        failures.push(
          `${rel(file)}:${line}: contains "${token}", which only the ${e} edition may say (src/edition/${e}/boundary.json).`
        );
      }
    }
  }
}

// The alias must resolve for every edition, or a build of it is a mystery.
for (const e of editions) {
  const dir = editionDir(e);
  if (!statSync(dir).isDirectory()) failures.push(`src/edition/${e} is not a directory`);
}
if (!editions.includes("community")) {
  failures.push("src/edition/community is missing; it is the edition every checkout must be able to build.");
}

if (failures.length > 0) {
  console.error(`edition boundary: ${failures.length} problem(s)\n`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(
  `edition boundary OK (${editions.join(", ")}; ${[...tokensByEdition.values()].reduce((n, t) => n + t.length, 0)} guarded token(s))`
);
