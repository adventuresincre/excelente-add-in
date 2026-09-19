#!/usr/bin/env node
/**
 * Render the static pages that ship beside the pane.
 *
 * Two generators are shared and always run: the documentation site
 * (`build-docs.mjs`) and the SEO/AIEO files (`build-seo.mjs`). A hosted
 * distribution adds generators for its own landing and legal pages; those
 * are not part of the public repository, so this runner looks for each by
 * name and skips the ones this checkout does not carry. A fork gets docs and
 * SEO from `npm run build:pages` with nothing to edit.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const GENERATORS = [
  "build-legal-pages.mjs",
  "build-landing-page.mjs",
  "build-docs.mjs",
  "build-seo.mjs",
];

for (const name of GENERATORS) {
  const file = resolve(here, name);
  if (!existsSync(file)) {
    console.log(`build-pages: ${name} not in this checkout, skipped`);
    continue;
  }
  const result = spawnSync(process.execPath, [file], { stdio: "inherit", cwd: resolve(here, "..") });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
