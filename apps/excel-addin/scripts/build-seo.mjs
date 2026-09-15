#!/usr/bin/env node
/**
 * Emits the site-wide discovery files into dist/, after the page generators
 * have run:
 *
 *   dist/robots.txt        crawl policy + sitemap pointer
 *   dist/sitemap.xml       every indexable page
 *   dist/llms.txt          an index of the site written for language models
 *   dist/llms-full.txt     the whole documentation set as one plain-text file
 *
 * WHY THE LAST TWO. Search engines crawl HTML; answer engines increasingly
 * look for `llms.txt`, a markdown index that states plainly what a site is and
 * where its documentation lives, and `llms-full.txt`, the full text in one
 * request. Excelente is the kind of product people ask an assistant about
 * rather than search for ("is there an AI add-in for Excel"), so being legible
 * to that path matters at least as much as ranking.
 *
 * Run AFTER the page generators, build-docs.mjs included: this script reads
 * the pages they emit rather than re-deriving them, so it cannot drift from
 * what actually shipped. Anything it does not find, it leaves out.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DIST = resolve(ROOT, "dist");
const DOCS_SRC = resolve(ROOT, "docs");

if (!existsSync(DIST)) {
  console.error("build-seo: dist/ not found — run `npm run build` first.");
  process.exit(1);
}

const ORIGIN = (process.env.EXCELENTE_SITE_ORIGIN ?? "https://excelente.aiedge.ac").replace(
  /\/+$/,
  ""
);

const BUILD_DAY = new Date().toISOString().slice(0, 10);

/** Last commit date for a file, so lastmod tracks content rather than checkout. */
function lastModified(absPath) {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cI", "--", absPath], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out ? out.slice(0, 10) : BUILD_DAY;
  } catch {
    return BUILD_DAY;
  }
}

// ---------------------------------------------------------------------------
// What exists
// ---------------------------------------------------------------------------

/** Minimal frontmatter read; build-docs.mjs has already validated these. */
function frontmatter(raw) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) return null;
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const at = line.indexOf(":");
    if (at === -1) continue;
    let v = line.slice(at + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    data[line.slice(0, at).trim()] = v;
  }
  return { data, body: m[2].trimStart() };
}

const GROUP_ORDER = [
  "First steps",
  "Core concepts",
  "Working in Excel",
  "Skills",
  "Connectors",
  "Models",
  "Tool reference",
  "Run it yourself",
  "Resources",
];

const docs = existsSync(DOCS_SRC)
  ? readdirSync(DOCS_SRC)
      .filter((f) => f.endsWith(".md"))
      .map((file) => {
        const abs = resolve(DOCS_SRC, file);
        const fm = frontmatter(readFileSync(abs, "utf8"));
        if (!fm) return null;
        const slug = file.replace(/\.md$/, "");
        return {
          file,
          abs,
          url: slug === "index" ? "/documentation/" : `/documentation/${slug}/`,
          title: fm.data.title,
          description: fm.data.description,
          group: fm.data.group,
          order: Number(fm.data.order ?? 0),
          body: fm.body,
          lastmod: lastModified(abs),
          isIndex: slug === "index",
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        const g = GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group);
        return g !== 0 ? g : a.order - b.order;
      })
  : [];

/** Top-level pages, included only when the generator that owns them ran. */
const topLevel = [
  { path: "/", src: "index.html", priority: "1.0", changefreq: "weekly" },
  { path: "/support/", src: "support/index.html", priority: "0.7", changefreq: "monthly" },
  { path: "/privacy/", src: "privacy/index.html", priority: "0.3", changefreq: "yearly" },
  { path: "/terms/", src: "terms/index.html", priority: "0.3", changefreq: "yearly" },
].filter((p) => existsSync(join(DIST, p.src)));

// ---------------------------------------------------------------------------
// robots.txt
// ---------------------------------------------------------------------------

/**
 * The add-in's own entry points are disallowed. They refuse to mount outside
 * Excel and render a notice, so an indexed result for them is a dead end for
 * whoever clicks it.
 *
 * AI crawlers are named and allowed explicitly. A bare "User-agent: *" already
 * permits them, but several of these check for their own token first, and an
 * explicit allow is the difference between being cited and being skipped.
 */
const AI_AGENTS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  "Amazonbot",
  "cohere-ai",
  "DuckAssistBot",
  "MistralAI-User",
  "meta-externalagent",
];

const robots = `# https://www.robotstxt.org/robotstxt.html
# Excelente: an open source AI agent for Microsoft Excel.
# Documentation: ${ORIGIN}/documentation/
# For language models: ${ORIGIN}/llms.txt

User-agent: *
Allow: /
Disallow: /taskpane.html
Disallow: /commands.html
Disallow: /auth-callback.html

${AI_AGENTS.map((a) => `User-agent: ${a}\nAllow: /`).join("\n\n")}

Sitemap: ${ORIGIN}/sitemap.xml
`;

writeFileSync(resolve(DIST, "robots.txt"), robots);
console.log("  dist/robots.txt");

// ---------------------------------------------------------------------------
// sitemap.xml
// ---------------------------------------------------------------------------

const esc = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const urls = [
  ...topLevel.map((p) => ({
    loc: `${ORIGIN}${p.path}`,
    lastmod: BUILD_DAY,
    changefreq: p.changefreq,
    priority: p.priority,
  })),
  ...docs.map((d) => ({
    loc: `${ORIGIN}${d.url}`,
    lastmod: d.lastmod,
    changefreq: "monthly",
    priority: d.isIndex ? "0.9" : "0.8",
  })),
];

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) =>
      `  <url>\n    <loc>${esc(u.loc)}</loc>\n    <lastmod>${u.lastmod}</lastmod>\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`
  )
  .join("\n")}
</urlset>
`;

writeFileSync(resolve(DIST, "sitemap.xml"), sitemap);
console.log(`  dist/sitemap.xml  (${urls.length} urls)`);

// ---------------------------------------------------------------------------
// llms.txt
// ---------------------------------------------------------------------------

const SUMMARY =
  "Excelente is a free, open source AI agent that runs inside Microsoft Excel as a task " +
  "pane add-in. It reads the whole workbook (every sheet, formula, named range and chart), " +
  "plans its approach, calls Excel tools, and writes back only after the user approves each " +
  "change. Every write is reversible from a one-click undo. Users bring their own model " +
  "through an OpenRouter API key, or start on A.CRE Free which needs no account. It was " +
  "built by commercial real estate practitioners for underwriting and financial modelling, " +
  "and the underlying tools work on any Excel workbook. Licensed Apache 2.0 by CRE Edge, LLC.";

const byGroup = GROUP_ORDER.map((group) => ({
  group,
  items: docs.filter((d) => d.group === group && !d.isIndex),
})).filter((g) => g.items.length > 0);

const llms = `# Excelente

> ${SUMMARY}

Key facts:

- Platform: Microsoft 365 Excel on Windows, Mac and the web. Requires the ExcelApi 1.9 requirement set, so Excel 2016 and 2019 are not supported.
- Price: Excelente is free with no in-app purchases. Model usage is billed by OpenRouter directly, or covered by A.CRE on the free tier.
- Install: ${ORIGIN}/documentation/install/
- Source: https://github.com/adventuresincre/excelente-add-in
- Licence: Apache 2.0 (the bundled CRE Agents skills are licensed separately and are not redistributable)
- Full documentation as one file: ${ORIGIN}/llms-full.txt

## Documentation

${byGroup
  .map(
    ({ group, items }) =>
      `### ${group}\n\n${items
        .map((d) => `- [${d.title}](${ORIGIN}${d.url}): ${d.description}`)
        .join("\n")}`
  )
  .join("\n\n")}

## Other pages

${topLevel
  .filter((p) => p.path !== "/")
  .map((p) => `- [${p.path}](${ORIGIN}${p.path})`)
  .join("\n")}
`;

writeFileSync(resolve(DIST, "llms.txt"), llms);
console.log("  dist/llms.txt");

// ---------------------------------------------------------------------------
// llms-full.txt
// ---------------------------------------------------------------------------

const full = `# Excelente: complete documentation

> ${SUMMARY}

Source: ${ORIGIN}/documentation/
Generated: ${BUILD_DAY}

${docs
  .filter((d) => !d.isIndex)
  .map(
    (d) =>
      `\n\n---\n\n# ${d.title}\n\n_${d.group} · ${ORIGIN}${d.url}_\n\n${d.description}\n\n${d.body}`
  )
  .join("")}
`;

writeFileSync(resolve(DIST, "llms-full.txt"), full);
console.log(
  `  dist/llms-full.txt  (${(full.length / 1024).toFixed(0)} KB, ${docs.length - 1} pages)`
);
