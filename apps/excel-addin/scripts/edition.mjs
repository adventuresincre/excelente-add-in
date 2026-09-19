#!/usr/bin/env node
/**
 * Edition-aware gates.
 *
 *   node scripts/edition.mjs current            which edition a build here targets
 *   node scripts/edition.mjs list               every edition folder present
 *   node scripts/edition.mjs typecheck          tsc --noEmit, once per edition present
 *   node scripts/edition.mjs test [args...]     vitest run, once per edition present
 *   node scripts/edition.mjs build <edition>    vite build for one edition (into dist/)
 *   node scripts/edition.mjs dev <edition>      vite dev server for one edition
 *
 * `typecheck` and `test` loop over EVERY edition folder in this checkout, so
 * a change to the shared tree is checked against each edition it has to
 * serve. A clone of the public repository has one folder and runs once; the
 * hosted distribution's checkout has more and runs each. The alias
 * `@edition` is what differs between runs: `tsc` gets it through a generated
 * tsconfig (`paths`), vitest and vite through `EXCELENTE_EDITION`, which
 * `vite.config.ts` reads.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ADDIN_ROOT, editionDir, listEditions, resolveEdition } from "./lib/edition.mjs";

const [, , command, ...rest] = process.argv;

function run(args, env = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: ADDIN_ROOT,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function bin(pkgPath) {
  const abs = resolve(ADDIN_ROOT, "node_modules", pkgPath);
  if (!existsSync(abs)) {
    console.error(`edition: ${pkgPath} not found; run npm install in apps/excel-addin first`);
    process.exit(1);
  }
  return abs;
}

/**
 * A tsconfig that extends the project's and points `@edition` at one folder.
 * Generated under node_modules/.cache so the repository carries one tsconfig
 * per checkout, not one per edition. `include` in the base file is resolved
 * relative to the base file, so the generated one only has to set `paths`.
 */
function tsconfigFor(edition) {
  const dir = resolve(ADDIN_ROOT, "node_modules", ".cache", "excelente");
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, `tsconfig.${edition}.json`);
  writeFileSync(
    file,
    JSON.stringify(
      {
        extends: resolve(ADDIN_ROOT, "tsconfig.json"),
        compilerOptions: {
          baseUrl: ADDIN_ROOT,
          paths: { "@edition": [editionDir(edition)] },
        },
      },
      null,
      2
    )
  );
  return file;
}

switch (command) {
  case "current":
    console.log(resolveEdition());
    break;

  case "list":
    for (const e of listEditions()) console.log(e);
    break;

  case "typecheck": {
    const tsc = bin("typescript/bin/tsc");
    for (const edition of listEditions()) {
      console.log(`\n== typecheck · ${edition} edition ==`);
      run([tsc, "--noEmit", "-p", tsconfigFor(edition)]);
    }
    break;
  }

  case "test": {
    const vitest = bin("vitest/vitest.mjs");
    for (const edition of listEditions()) {
      console.log(`\n== test · ${edition} edition ==`);
      run([vitest, "run", ...rest], { EXCELENTE_EDITION: edition });
    }
    break;
  }

  case "dev": {
    // The Vite dev server for one edition, for a browser preview or a sideload.
    const edition = rest[0] ? resolveEdition({ ...process.env, EXCELENTE_EDITION: rest[0] }) : resolveEdition();
    console.log(`\n== dev · ${edition} edition ==`);
    run([bin("vite/bin/vite.js"), ...rest.slice(1)], { EXCELENTE_EDITION: edition });
    break;
  }

  case "build": {
    const edition = rest[0] ? resolveEdition({ ...process.env, EXCELENTE_EDITION: rest[0] }) : resolveEdition();
    console.log(`\n== build · ${edition} edition ==`);
    run([bin("vite/bin/vite.js"), "build", ...rest.slice(1)], { EXCELENTE_EDITION: edition });
    break;
  }

  default:
    console.error("usage: node scripts/edition.mjs <current|list|typecheck|test|build|dev> [args]");
    process.exit(2);
}
