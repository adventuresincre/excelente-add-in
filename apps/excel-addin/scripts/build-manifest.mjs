#!/usr/bin/env node
/**
 * Generate an Office Add-in manifest from manifest.template.xml by
 * substituting environment-specific values. The template is the source of
 * truth; manifest.xml (the dev artifact office-addin-debugging sideloads)
 * is generated from it.
 *
 * Why this exists: a store / member submission can't point at localhost.
 * And Excelente ships on TWO distribution paths — a public BYOK build and
 * an A.CRE-member build — which want distinct add-in IDs, display names,
 * and hosting URLs. Driving those from env vars lets one template emit
 * every target.
 *
 * Usage:
 *   node scripts/build-manifest.mjs                 # dev → manifest.xml (localhost)
 *   node scripts/build-manifest.mjs --out dist/manifest.xml   # custom output
 *   EXCELENTE_BASE_URL=https://intelligence.adventuresincre.com/excelente \
 *   EXCELENTE_ADDIN_ID=<guid> EXCELENTE_DISPLAY_NAME="Excelente" \
 *     node scripts/build-manifest.mjs --out dist/manifest.byok.xml
 *
 * Tokens in the template: {{ADDIN_ID}}, {{BASE_URL}}, {{DISPLAY_NAME}}.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const TEMPLATE = resolve(ROOT, "manifest.template.xml");

// Dev defaults preserve the current localhost workflow + the committed
// values (including the math-italic DisplayName) so `manifest:dev`
// regenerates byte-for-byte what's checked in.
const vars = {
  BASE_URL: (process.env.EXCELENTE_BASE_URL ?? "https://localhost:3000").replace(/\/+$/, ""),
  ADDIN_ID: process.env.EXCELENTE_ADDIN_ID ?? "9d7f49b0-4867-428b-9a28-f1c6b02d4ab3",
  DISPLAY_NAME: process.env.EXCELENTE_DISPLAY_NAME ?? "\u{1D452}\u{1D465}\u{1D450}\u{1D452}\u{1D459}\u{1D452}\u{1D45B}\u{1D461}\u{1D452}",
};

// A non-localhost BASE_URL means a production/store manifest. The dev
// defaults must never reach one: the math-italic DisplayName fails
// AppSource name-match validation, and the dev GUID would collide with
// every sideloaded dev install (or hijack the listing identity).
// `office-addin-manifest validate` catches neither, so fail here.
if (!vars.BASE_URL.includes("localhost")) {
  const missing = [];
  if (!process.env.EXCELENTE_ADDIN_ID) missing.push("EXCELENTE_ADDIN_ID");
  if (!process.env.EXCELENTE_DISPLAY_NAME) missing.push("EXCELENTE_DISPLAY_NAME");
  if (missing.length > 0) {
    console.error(
      `build-manifest: BASE_URL is non-localhost (${vars.BASE_URL}) but ${missing.join(" and ")} ` +
        `${missing.length === 1 ? "is" : "are"} unset — refusing to emit a production manifest ` +
        "with dev-default identity. See manifest.env.example for the per-target values."
    );
    process.exit(1);
  }
}

const outIdx = process.argv.indexOf("--out");
const out = outIdx !== -1 ? resolve(process.cwd(), process.argv[outIdx + 1]) : resolve(ROOT, "manifest.xml");

let xml = readFileSync(TEMPLATE, "utf8");
for (const [key, val] of Object.entries(vars)) {
  xml = xml.split(`{{${key}}}`).join(val);
}

const leftover = xml.match(/\{\{[A-Z_]+\}\}/g);
if (leftover) {
  console.error(`build-manifest: unfilled tokens: ${[...new Set(leftover)].join(", ")}`);
  process.exit(1);
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, xml);
console.log(`build-manifest: wrote ${out}\n  BASE_URL=${vars.BASE_URL}\n  ADDIN_ID=${vars.ADDIN_ID}\n  DISPLAY_NAME=${vars.DISPLAY_NAME}`);
