#!/usr/bin/env node
/**
 * Emits dist/documentation/**, the Excelente documentation site.
 *
 * WHY THIS EXISTS. Excelente ships plan/work modes, approval gates, skills,
 * connectors, a model explorer and eight slash commands, and until now the
 * only reference material was a getting-started list buried in /support.
 * This builds a real docs section for the two audiences who need it: people
 * on the hosted build from Microsoft Marketplace, and people who fork
 * `excelente-add-in` and run their own.
 *
 * HOW IT WORKS. One markdown file per page in `docs/`, with YAML frontmatter
 * naming its title, description, sidebar group and order. This script renders
 * each to `dist/documentation/<slug>/index.html`. nginx declares
 * `index taskpane.html index.html` at server level, so those resolve at
 * `/documentation/<slug>` with no server config change, exactly as `/privacy`
 * does today.
 *
 * COPY PAGE. Each page embeds its own source markdown (frontmatter stripped)
 * in a `<script type="text/markdown">` block. The Copy page button reads that
 * and writes it to the clipboard, so a reader can paste a page straight into
 * a coding agent. No second endpoint, no fetch, works from a file:// preview.
 *
 * DESIGN. Excelente design standards: the palette and type from
 * `src/ui/design/tokens.css`, plus three `--web-*` additions for the web layer.
 * Every token used is defined in this file. A `var()` naming a token nothing
 * defines makes the whole declaration invalid at computed-value time, so a
 * border silently resolves to none rather than erroring; keeping the
 * definitions local is what stops that.
 *
 * ACCESSIBILITY. `--gold` (2.11:1) and `--gold-dark` (2.30:1) are decoration
 * only and never a text colour. Words use `--gold-text` or `--gold-muted`,
 * both of which clear 4.5:1. Focus rings are gold, never blue.
 */
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { Marked, Renderer } from "marked";
import { editionDir, resolveEdition } from "./lib/edition.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DIST = resolve(ROOT, "dist");
const DOCS_SRC = resolve(ROOT, "docs");
const OUT_DIR = resolve(DIST, "documentation");

/**
 * Edition-specific passages. The pages under docs/ are shared by every
 * edition and describe what every edition has. Where an edition has more to
 * say (a hosted model tier, say), the shared page carries a block
 *
 *   <!-- edition:include some/name -->
 *   what every other edition shows here, possibly nothing
 *   <!-- /edition:include -->
 *
 * and the edition provides `src/edition/<name>/docs/some/name.md`. When that
 * file exists its contents replace the block; otherwise the block's own body
 * stands. The markers sit on their own lines, and a block whose replacement
 * is empty vanishes without leaving a blank line, so a table row or a list
 * item can be edition-specific too.
 */
const EDITION = resolveEdition();
const EDITION_DOCS = resolve(editionDir(EDITION), "docs");
const INCLUDE_RE =
  /^[ \t]*<!-- edition:include ([\w./-]+) -->[ \t]*\n([\s\S]*?)^[ \t]*<!-- \/edition:include -->[ \t]*\n?/gm;

function resolveEditionIncludes(md, file) {
  return md.replace(INCLUDE_RE, (_whole, name, fallback) => {
    if (name.includes("..")) throw new Error(`${file}: bad include name ${name}`);
    const path = resolve(EDITION_DOCS, `${name}.md`);
    if (!existsSync(path)) return fallback;
    const text = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
    return text.endsWith("\n") || text === "" ? text : `${text}\n`;
  });
}

if (!existsSync(DIST)) {
  console.error("dist/ does not exist. Run `npm run build` first.");
  process.exit(1);
}
if (!existsSync(DOCS_SRC)) {
  console.error(`No docs source at ${DOCS_SRC}.`);
  process.exit(1);
}

/**
 * Sidebar group order. A page whose `group` is not in this list is a mistake
 * in its frontmatter, and the build says so rather than silently dropping it.
 */
const GROUPS = [
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

const SITE_TITLE = "Excelente Docs";
const BASE = "/documentation";
const REPO_URL = "https://github.com/adventuresincre/excelente-add-in";

/**
 * Absolute origin for canonical URLs, Open Graph and JSON-LD. Those three have
 * to be absolute to work at all, and a fork serving this from its own domain
 * would otherwise advertise ours as canonical and hand us its search traffic.
 * Override with EXCELENTE_SITE_ORIGIN when you deploy your own build.
 */
const ORIGIN = (process.env.EXCELENTE_SITE_ORIGIN ?? "https://excelente.aiedge.ac").replace(
  /\/+$/,
  ""
);
const OG_IMAGE = "/assets/hero-excel.png";
const PUBLISHER = "CRE Edge, LLC";

/**
 * Structured data. Search engines use it for rich results; answer engines use
 * it to decide what a page is actually about, which is most of why it is here.
 * TechArticle rather than Article because these are software docs, and a
 * BreadcrumbList so the group shows in a result rather than a bare URL.
 */
function jsonLd(page) {
  const graph = [
    {
      "@type": "TechArticle",
      "@id": `${ORIGIN}${page.url}#article`,
      headline: page.title,
      description: page.description,
      url: `${ORIGIN}${page.url}`,
      inLanguage: "en",
      isPartOf: { "@type": "WebSite", name: SITE_TITLE, url: `${ORIGIN}${BASE}/` },
      publisher: { "@type": "Organization", name: PUBLISHER, url: ORIGIN },
      about: { "@type": "SoftwareApplication", name: "Excelente" },
      articleSection: page.group,
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Documentation", item: `${ORIGIN}${BASE}/` },
        ...(page.slug
          ? [
              { "@type": "ListItem", position: 2, name: page.group },
              { "@type": "ListItem", position: 3, name: page.title, item: `${ORIGIN}${page.url}` },
            ]
          : []),
      ],
    },
  ];
  // Escaped so a "</script>" inside any string cannot close the block early.
  return JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(
    /<\/(script)/gi,
    "<\\/$1"
  );
}

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

/**
 * Minimal YAML frontmatter reader. Deliberately matches the shape the skill
 * loader accepts (`src/core/skills/frontmatter.ts`): flat `key: value` pairs,
 * optional quoting, no nesting and no block scalars. Anything more is a sign
 * the page is carrying structure that belongs in its body.
 */
function parseFrontmatter(raw, file) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) {
    throw new Error(`${file}: must begin with a YAML frontmatter block (--- … ---)`);
  }
  const [, block, body] = match;
  const data = {};
  for (const line of block.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const at = line.indexOf(":");
    if (at === -1) throw new Error(`${file}: cannot parse frontmatter line: ${line}`);
    const key = line.slice(0, at).trim();
    let value = line.slice(at + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    data[key] = value;
  }
  for (const required of ["title", "description", "group", "order"]) {
    if (!data[required])
      throw new Error(`${file}: frontmatter missing required field: ${required}`);
  }
  if (!GROUPS.includes(data.group)) {
    throw new Error(
      `${file}: unknown group "${data.group}". Expected one of: ${GROUPS.join(", ")}`
    );
  }
  return { data, body: body.trimStart() };
}

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

const escapeHtml = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/**
 * Markdown destined for a `<script type="text/markdown">` block. Only the
 * closing-tag sequence can break out of a non-executable script element, and
 * the HTML parser matches it case-insensitively, so neutralise every spelling
 * of it. The copy handler reverses this before writing to the clipboard.
 */
const escapeForScript = (s) => String(s).replace(/<\/(script)/gi, "<\\/$1");

const slugify = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * Words too common to be worth indexing. Short enough to stay readable; the
 * point is to keep the index small, not to build a real stemmer.
 */
const STOPWORDS = new Set(
  (
    "a an the and or but if then than that this these those is are was were be been being do does did " +
    "have has had of in on at to from by for with without into out up down over under again once " +
    "you your yours it its they them their there here what which who when where why how all any both " +
    "each few more most other some such no nor not only own same so too very can will just as i we " +
    "one two three see also use used using get got make makes made way ways thing things"
  ).split(" ")
);

/**
 * Distils a page body into a deduped bag of searchable words. Hyphens and
 * underscores become spaces so a search for "rent roll" reaches
 * `rent-roll-standardizer`, and `write_range` is findable as "write range".
 * Deduping is what keeps this affordable: a 5 KB page yields a few hundred
 * distinct words, not a few thousand.
 */
/**
 * The inline-code spans on a page, normalized and kept as phrases. In
 * technical docs these are the highest-signal tokens (`write_range`, `/init`,
 * `_excelente`), and unlike the deduped word bag they preserve adjacency, so a
 * search for "write range" can match `write_range` as a phrase rather than as
 * two words that happen to appear on the same page. Spans are separated by a
 * pipe so adjacency never bleeds from one span into the next.
 */
function codePhrases(md) {
  const spans = new Set();
  for (const m of md.matchAll(/`([^`\n]{1,60})`/g)) {
    const s = m[1]
      .toLowerCase()
      .replace(/[-_/]+/g, " ")
      .replace(/[^a-z0-9. ]+/g, " ")
      .trim();
    if (s.length >= 2) spans.add(s.replace(/\s+/g, " "));
  }
  return [...spans].join(" | ");
}

function bodyTerms(md) {
  const text = md
    .replace(/```[\s\S]*?```/g, " ") // fenced code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images, including alt text
    .replace(/\]\([^)]*\)/g, "] ") // link targets, keeping link text
    .replace(/[|>#*_~`[\]]/g, " ")
    .toLowerCase()
    .replace(/[-_/]+/g, " ");

  const seen = new Set();
  for (const word of text.split(/[^a-z0-9.]+/)) {
    const w = word.replace(/^\.+|\.+$/g, "");
    if (w.length < 3 || w.length > 24) continue;
    if (STOPWORDS.has(w)) continue;
    if (/^\d+$/.test(w)) continue;
    seen.add(w);
  }
  return [...seen].join(" ");
}

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

/**
 * Renders one page's markdown and collects its h2/h3 headings for the "On this
 * page" rail. Headings get stable ids so the rail and any inbound deep link
 * agree. Tables are wrapped so a wide one scrolls inside its own box instead
 * of widening the page, which is the only way a reference table survives a
 * phone viewport.
 */
function renderMarkdown(md) {
  const toc = [];
  const seen = new Map();

  const renderer = {
    heading({ tokens, depth }) {
      const text = this.parser.parseInline(tokens);
      const plain = this.parser.parseInline(tokens, this.parser.textRenderer);
      let id = slugify(plain);
      if (!id) id = `section-${toc.length + 1}`;
      // Two headings with the same words still need distinct anchors.
      const count = seen.get(id) ?? 0;
      seen.set(id, count + 1);
      if (count > 0) id = `${id}-${count + 1}`;
      if (depth === 2 || depth === 3) toc.push({ id, text: plain, depth });
      return `<h${depth} id="${id}">${text}<a class="anchor" href="#${id}" aria-label="Link to this section">#</a></h${depth}>\n`;
    },
    table(token) {
      // Call the base implementation, then wrap it.
      const html = Renderer.prototype.table.call(this, token);
      return `<div class="table-scroll">${html}</div>`;
    },
  };

  const instance = new Marked({ gfm: true, breaks: false });
  instance.use({ renderer });
  const html = instance.parse(md);
  return { html, toc };
}

// ---------------------------------------------------------------------------
// Load pages
// ---------------------------------------------------------------------------

const files = readdirSync(DOCS_SRC)
  .filter((f) => f.endsWith(".md"))
  .sort();

if (files.length === 0) {
  console.error(`No .md files found in ${DOCS_SRC}.`);
  process.exit(1);
}

const pages = files.map((file) => {
  const raw = readFileSync(resolve(DOCS_SRC, file), "utf8");
  const parsed = parseFrontmatter(raw, file);
  const data = parsed.data;
  // Resolved before anything reads the body, so the rendered page, the
  // copy-page markdown and the search index all describe this edition.
  const body = resolveEditionIncludes(parsed.body, file);
  if (/<!--\s*\/?edition:include/.test(body)) {
    throw new Error(
      `${file}: an edition:include block is malformed (markers must sit on their own lines)`
    );
  }
  const name = basename(file, ".md");
  const slug = name === "index" ? "" : name;
  const { html, toc } = renderMarkdown(body);
  return {
    file,
    slug,
    // Trailing slash on purpose. nginx 301s a directory URL without one, so
    // linking bare would cost a redirect round trip on every nav click, and
    // this site is nothing but cross-links.
    url: slug ? `${BASE}/${slug}/` : `${BASE}/`,
    title: data.title,
    description: data.description,
    group: data.group,
    order: Number(data.order),
    markdown: body,
    terms: bodyTerms(body),
    code: codePhrases(body),
    html,
    toc,
  };
});

// Reading order: group order, then `order` within a group. The index sits
// outside the sequence because it is the door, not a step.
const ordered = pages
  .filter((p) => p.slug)
  .sort((a, b) => {
    const g = GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group);
    return g !== 0 ? g : a.order - b.order;
  });

const index = pages.find((p) => !p.slug);
if (!index) {
  console.error("docs/index.md is required (it becomes /documentation).");
  process.exit(1);
}

const byGroup = GROUPS.map((group) => ({
  group,
  items: ordered.filter((p) => p.group === group),
})).filter((g) => g.items.length > 0);

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const CSS = `
:root {
  color-scheme: light;

  /* Palette, from src/ui/design/tokens.css */
  --cream: #f5f0e8;
  --cream-dark: #ede8dc;
  --warm-white: #faf8f5;
  --white: #ffffff;
  --charcoal: #1a1a1a;
  --gold: #c9a96e;
  --gold-dark: #b8963d;
  --gold-muted: #78634a;
  --gold-text: #7d662a;
  --gold-badge-bg: rgba(201, 169, 110, 0.15);
  --gold-badge-border: rgba(201, 169, 110, 0.4);
  --text-body: #4a4035;
  --text-muted: #6e6557;
  --border-light: #e0d9cc;
  --border-divider: #d4cdc0;
  --border-card: #e0dbd3;

  /* Web layer additions, not part of the task pane's token set */
  --web-rule: #e5e2da;
  --web-link: #8a6a25;
  --web-footer-text: #6b6b66;

  --font-sans: "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  --font-serif: "DM Serif Display", Georgia, "Times New Roman", serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;

  --r-md: 4px;
  --r-base: 6px;
  --r-lg: 8px;
  --r-xl: 12px;
  --r-full: 9999px;

  --sidebar-w: 264px;
  --rail-w: 208px;
  --measure: 760px;
  --header-h: 60px;
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; scroll-padding-top: calc(var(--header-h) + 16px); }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }

body {
  margin: 0;
  background: var(--cream);
  color: var(--text-body);
  font-family: var(--font-sans);
  font-size: 1rem;
  line-height: 1.65;
  -webkit-font-smoothing: antialiased;
}

a { color: var(--web-link); text-underline-offset: 2px; }
a:hover { color: var(--gold-dark); }
:focus-visible { outline: 2px solid var(--gold-text); outline-offset: 2px; border-radius: var(--r-md); }

/* ---------- Header ---------- */
.top {
  position: sticky; top: 0; z-index: 40;
  height: var(--header-h);
  display: flex; align-items: center; gap: 16px;
  padding: 0 20px;
  background: var(--warm-white);
  border-bottom: 1px solid var(--web-rule);
}
.brand { display: flex; align-items: center; gap: 10px; text-decoration: none; color: var(--charcoal); }
.brand img { width: 28px; height: 28px; display: block; }
.brand__name { font-size: 1.125rem; font-weight: 600; letter-spacing: 0.2px; }
.brand__name span { color: var(--gold-text); }
.brand__docs { font-family: var(--font-serif); font-size: 1.0625rem; color: var(--text-muted); }
.top__spacer { flex: 1 1 auto; }
.top__links { display: flex; align-items: center; gap: 18px; font-size: 0.875rem; }
.top__links a { color: var(--text-body); text-decoration: none; }
.top__links a:hover { color: var(--gold-dark); }
.menu-btn {
  display: none;
  align-items: center; gap: 8px;
  background: transparent; border: 1px solid var(--web-rule);
  border-radius: var(--r-base); padding: 6px 10px;
  font: inherit; font-size: 0.8125rem; color: var(--text-body); cursor: pointer;
}

/* ---------- Layout ---------- */
.layout {
  display: grid;
  grid-template-columns: var(--sidebar-w) minmax(0, 1fr) var(--rail-w);
  gap: 0;
  max-width: 1360px;
  margin: 0 auto;
  align-items: start;
}

/* ---------- Sidebar ---------- */
.sidebar {
  position: sticky; top: var(--header-h);
  max-height: calc(100vh - var(--header-h));
  overflow-y: auto;
  padding: 24px 16px 48px;
  border-right: 1px solid var(--web-rule);
}
.search-wrap { position: relative; margin-bottom: 20px; }
.search {
  width: 100%; padding: 8px 10px 8px 30px;
  font: inherit; font-size: 0.875rem; color: var(--text-body);
  background: var(--warm-white);
  border: 1px solid var(--border-light); border-radius: var(--r-base);
}
.search::placeholder { color: var(--text-muted); }
.search-wrap::before {
  content: "⌕"; position: absolute; left: 10px; top: 50%; transform: translateY(-52%);
  color: var(--text-muted); font-size: 0.95rem; pointer-events: none;
}
.search-results {
  list-style: none; margin: 8px 0 0; padding: 0;
  border: 1px solid var(--border-light); border-radius: var(--r-base);
  background: var(--warm-white); overflow: hidden;
}
.search-results:empty { display: none; border: 0; }
.search-results a { display: block; padding: 8px 10px; text-decoration: none; color: var(--text-body); font-size: 0.8125rem; }
.search-results a:hover, .search-results a:focus-visible { background: var(--gold-badge-bg); }
.search-results .r-group { display: block; font-size: 0.6875rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); }
.search-empty { padding: 8px 10px; font-size: 0.8125rem; color: var(--text-muted); }

.nav-group { margin-bottom: 22px; }
.nav-group__label {
  margin: 0 0 6px; padding: 0 10px;
  font-size: 0.6875rem; font-weight: 700; letter-spacing: 0.12em;
  text-transform: uppercase; color: var(--gold-muted);
}
.nav-list { list-style: none; margin: 0; padding: 0; }
.nav-list a {
  display: block; padding: 5px 10px;
  font-size: 0.875rem; text-decoration: none; color: var(--text-body);
  border-radius: var(--r-base);
}
.nav-list a:hover { background: var(--cream-dark); color: var(--charcoal); }
.nav-list a[aria-current="page"] {
  background: var(--gold-badge-bg);
  color: var(--charcoal); font-weight: 600;
  box-shadow: inset 2px 0 0 var(--gold-dark);
}

/* ---------- Content ---------- */
.content { min-width: 0; padding: 32px 40px 72px; }
.content__inner { max-width: var(--measure); }

.breadcrumb { font-size: 0.8125rem; color: var(--text-muted); margin-bottom: 10px; }
.breadcrumb a { color: var(--text-muted); text-decoration: none; }
.breadcrumb a:hover { color: var(--gold-dark); }
.breadcrumb span { margin: 0 6px; opacity: 0.6; }

.title-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
.title-row h1 { flex: 1 1 auto; }
h1 {
  margin: 0 0 8px;
  font-family: var(--font-serif); font-weight: 400;
  font-size: clamp(2rem, 4vw, 2.5rem); line-height: 1.15;
  letter-spacing: -0.01em; color: var(--charcoal);
  text-wrap: balance;
}
.lead { margin: 0 0 8px; font-size: 1.125rem; line-height: 1.6; color: var(--text-muted); max-width: 62ch; }

.copy-btn {
  flex: 0 0 auto; margin-top: 6px;
  display: inline-flex; align-items: center; gap: 7px;
  padding: 7px 13px;
  font: inherit; font-size: 0.8125rem; font-weight: 600;
  color: var(--text-body); background: var(--warm-white);
  border: 1px solid var(--border-light); border-radius: var(--r-full);
  cursor: pointer; white-space: nowrap;
  transition: border-color 120ms ease, color 120ms ease;
}
.copy-btn:hover { border-color: var(--gold-dark); color: var(--charcoal); }
.copy-btn[data-state="done"] { border-color: var(--gold-dark); color: var(--gold-text); }
.copy-btn[data-state="fail"] { border-color: var(--border-divider); color: var(--text-muted); }
@media (prefers-reduced-motion: reduce) { .copy-btn { transition: none; } }

.prose { margin-top: 28px; }
.prose > :first-child { margin-top: 0; }
.prose h2 {
  font-family: var(--font-serif); font-weight: 400; color: var(--charcoal);
  font-size: 1.625rem; line-height: 1.25;
  margin: 44px 0 12px; padding-top: 12px;
  border-top: 1px solid var(--web-rule);
}
.prose h3 {
  font-family: var(--font-serif); font-weight: 400; color: var(--charcoal);
  font-size: 1.25rem; line-height: 1.3; margin: 30px 0 8px;
}
.prose h4 {
  font-family: var(--font-sans); font-weight: 600; color: var(--charcoal);
  font-size: 1rem; margin: 24px 0 6px;
}
.prose p { margin: 0 0 16px; }
.prose ul, .prose ol { margin: 0 0 16px; padding-left: 22px; }
.prose li { margin-bottom: 6px; }
.prose li > ul, .prose li > ol { margin-top: 6px; }
.prose strong { color: var(--charcoal); font-weight: 600; }
.prose hr { border: 0; border-top: 1px solid var(--web-rule); margin: 36px 0; }

.anchor {
  margin-left: 8px; font-size: 0.7em; color: var(--border-divider);
  text-decoration: none; opacity: 0; transition: opacity 120ms ease;
}
h2:hover .anchor, h3:hover .anchor, .anchor:focus-visible { opacity: 1; }

.prose code {
  font-family: var(--font-mono); font-size: 0.875em;
  background: var(--cream-dark); color: var(--charcoal);
  padding: 1px 5px; border-radius: var(--r-md);
}
.prose pre {
  margin: 0 0 18px; padding: 14px 16px;
  background: var(--charcoal); color: #f2ede4;
  border-radius: var(--r-lg); overflow-x: auto;
  font-size: 0.8125rem; line-height: 1.6;
}
.prose pre code { background: transparent; color: inherit; padding: 0; font-size: 1em; }

.table-scroll { overflow-x: auto; margin: 0 0 20px; }
.prose table { border-collapse: collapse; width: 100%; font-size: 0.9375rem; }
.prose th, .prose td {
  border: 1px solid var(--border-card); padding: 8px 11px;
  text-align: left; vertical-align: top;
}
.prose th { background: var(--warm-white); color: var(--charcoal); font-weight: 600; }
.prose td code, .prose th code { white-space: nowrap; }

.prose blockquote {
  margin: 0 0 18px; padding: 12px 16px;
  background: var(--warm-white);
  border-left: 3px solid var(--gold); border-radius: 0 var(--r-base) var(--r-base) 0;
  color: var(--text-body);
}
.prose blockquote > :last-child { margin-bottom: 0; }

.prose img { max-width: 100%; height: auto; border-radius: var(--r-lg); border: 1px solid var(--border-card); display: block; }

/* Card grid on the index */
.cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin: 0 0 32px; }
.card {
  display: block; padding: 16px 18px;
  background: var(--warm-white);
  border: 1px solid var(--border-card); border-radius: var(--r-xl);
  text-decoration: none; color: inherit;
  transition: border-color 120ms ease, transform 120ms ease;
}
.card:hover { border-color: var(--gold-dark); transform: translateY(-1px); }
.card__title { display: block; font-family: var(--font-serif); font-size: 1.125rem; color: var(--charcoal); margin-bottom: 4px; }
.card__desc { display: block; font-size: 0.875rem; color: var(--text-muted); line-height: 1.55; }
@media (prefers-reduced-motion: reduce) { .card { transition: none; } .card:hover { transform: none; } }

/* Prev / next */
.pager { display: flex; gap: 12px; margin-top: 48px; padding-top: 20px; border-top: 1px solid var(--web-rule); }
.pager a {
  flex: 1 1 0; min-width: 0; padding: 12px 16px;
  border: 1px solid var(--border-card); border-radius: var(--r-lg);
  background: var(--warm-white); text-decoration: none; color: inherit;
}
.pager a:hover { border-color: var(--gold-dark); }
.pager .dir { display: block; font-size: 0.6875rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-muted); margin-bottom: 2px; }
.pager .label { display: block; font-weight: 600; color: var(--charcoal); font-size: 0.9375rem; }
.pager .next { text-align: right; }

/* ---------- Right rail ---------- */
.rail {
  position: sticky; top: var(--header-h);
  max-height: calc(100vh - var(--header-h));
  overflow-y: auto;
  padding: 36px 20px 48px 8px;
  font-size: 0.8125rem;
}
.rail__label { margin: 0 0 8px; font-size: 0.6875rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--gold-muted); }
.rail ul { list-style: none; margin: 0; padding: 0; }
.rail a { display: block; padding: 4px 8px; color: var(--text-muted); text-decoration: none; border-left: 2px solid transparent; }
.rail a:hover { color: var(--charcoal); }
.rail a.is-active { color: var(--charcoal); border-left-color: var(--gold-dark); font-weight: 600; }
.rail .d3 { padding-left: 20px; }

/* ---------- Footer ---------- */
.foot { border-top: 1px solid var(--web-rule); background: var(--warm-white); padding: 24px 20px; }
.foot__inner {
  max-width: 1360px; margin: 0 auto;
  display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline;
  gap: 8px 24px; font-size: 0.84375rem; color: var(--web-footer-text);
}
.foot a { color: inherit; }
.foot a:hover { color: var(--gold-dark); }

.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}

/* ---------- Responsive ---------- */
@media (max-width: 1280px) {
  .layout { grid-template-columns: var(--sidebar-w) minmax(0, 1fr); }
  .rail { display: none; }
}
@media (max-width: 960px) {
  .layout { grid-template-columns: minmax(0, 1fr); }
  .menu-btn { display: inline-flex; }
  .sidebar {
    display: none;
    position: fixed; inset: var(--header-h) 0 0 0;
    max-height: none; height: auto;
    background: var(--cream); border-right: 0;
    z-index: 30; padding: 20px 20px 48px;
  }
  body.nav-open .sidebar { display: block; }
  body.nav-open { overflow: hidden; }
  .content { padding: 24px 20px 64px; }
  .cards { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 560px) {
  .top { padding: 0 16px; gap: 10px; }
  .top__links { display: none; }
  .brand__docs { display: none; }
  .content { padding: 20px 16px 56px; }
  .title-row { flex-direction: column; gap: 12px; }
  .copy-btn { margin-top: 0; align-self: flex-start; }
  .pager { flex-direction: column; }
  .pager .next { text-align: left; }
  .foot { padding: 20px 16px; }
}
`;

// ---------------------------------------------------------------------------
// Client script
// ---------------------------------------------------------------------------

// NOTE: this is a template literal, so every backslash here has to be doubled
// to survive into the emitted script. A regex literal written `/\s+/` arrives
// in the browser as `/s+/` and silently matches the letter s. Where a pattern
// needs an escape, build it with `new RegExp("…")` from a plain string instead,
// which has no backslash to lose.
const JS = `
(function () {
  var NORMALIZE = new RegExp("[-_/]+", "g");
  var SPLIT = new RegExp("[^a-z0-9.]+");
  // Copy page. The markdown lives in a non-executable script block so there is
  // no second request to make and no endpoint to keep in sync.
  var btn = document.getElementById("copy-page");
  var src = document.getElementById("page-md");
  if (btn && src) {
    btn.addEventListener("click", function () {
      var md = src.textContent.replace(/<\\\\\\/(script)/gi, "</$1");
      var done = function (state, label) {
        btn.dataset.state = state;
        btn.querySelector(".copy-label").textContent = label;
        setTimeout(function () {
          btn.dataset.state = "";
          btn.querySelector(".copy-label").textContent = "Copy page";
        }, 2000);
      };
      var finish = function (ok) {
        if (ok) done("done", "Copied");
        else done("fail", "Press Ctrl+C");
      };
      // The async clipboard API needs a secure context and permission, and is
      // blocked outright in some embedded web views. execCommand still works
      // in most of those, so treat it as a real success rather than reporting
      // failure on a copy that actually happened.
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(md).then(
          function () { done("done", "Copied"); },
          function () { finish(selectFallback(md)); }
        );
      } else {
        finish(selectFallback(md));
      }
    });
  }
  /** Returns true when execCommand copied it. Leaves the text selected if not. */
  function selectFallback(md) {
    var ta = document.createElement("textarea");
    ta.value = md;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, md.length);
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    // On success it can go immediately. On failure it stays selected long
    // enough for the reader to press Ctrl+C themselves.
    setTimeout(function () { ta.remove(); }, ok ? 0 : 8000);
    return ok;
  }

  // Mobile nav
  var menu = document.getElementById("menu-btn");
  if (menu) {
    menu.addEventListener("click", function () {
      var open = document.body.classList.toggle("nav-open");
      menu.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && document.body.classList.contains("nav-open")) {
      document.body.classList.remove("nav-open");
      if (menu) menu.setAttribute("aria-expanded", "false");
    }
  });

  // Search. The index is small enough to match over directly; ranking is
  // title hit, then description, then heading.
  var box = document.getElementById("docsearch");
  var out = document.getElementById("search-results");
  var INDEX = window.__DOCS_INDEX__ || [];

  // Fields in descending order of how much a hit in them means. The first
  // four preserve word order, so the whole query can be matched as a phrase
  // against them. The terms bag is deduped and only supports single words.
  function norm(s) { return s.toLowerCase().replace(NORMALIZE, " "); }
  function fields(page) {
    // Normalized the same way the query is, so the page titled run_excel_script
    // is reachable by typing it with underscores, hyphens, or spaces.
    return [
      norm(page.title),
      norm(page.description),
      norm(page.headings.join(" ")),
      page.code,
      norm(page.group)
    ];
  }
  // Two tiers. A page containing the query as a PHRASE scores 0-4 by which
  // field carried it, and always beats a page that merely contains all the
  // words scattered around (10+). Without that split, searching write_range
  // ranks every page with the word "write" in its title above the tool
  // reference that actually documents it.
  function score(page, words) {
    var f = fields(page);
    var phrase = words.join(" ");
    for (var i = 0; i < f.length; i++) {
      var at = f[i].indexOf(phrase);
      // A title that STARTS with the query wins outright. -0.5 sorts ahead of
      // every real rank and stays clear of the -1 no-match sentinel.
      if (at === 0 && i === 0) return -0.5;
      if (at !== -1) return i;
    }
    // Scattered: every word has to appear somewhere, including the word bag.
    var sum = 0;
    for (var w = 0; w < words.length; w++) {
      var found = -1;
      for (var j = 0; j < f.length; j++) {
        if (f[j].indexOf(words[w]) !== -1) { found = j; break; }
      }
      if (found === -1 && page.terms.indexOf(words[w]) !== -1) found = f.length;
      if (found === -1) return -1;
      sum += found;
    }
    return 10 + sum / words.length;
  }
  function render(q) {
    out.innerHTML = "";
    if (!q) return;
    // Normalize the query the same way the index was built, so a reader can
    // type write_range or rent-roll and reach a page whose body says
    // "write range" or "rent roll standardizer".
    var words = q.replace(NORMALIZE, " ").split(SPLIT).filter(Boolean);
    if (!words.length) return;
    var hits = [];
    for (var i = 0; i < INDEX.length; i++) {
      var s = score(INDEX[i], words);
      if (s !== -1) hits.push({ s: s, p: INDEX[i] });
    }
    hits.sort(function (a, b) { return a.s - b.s; });
    if (hits.length === 0) {
      var li = document.createElement("li");
      li.className = "search-empty";
      li.textContent = 'No page matches "' + q + '".';
      out.appendChild(li);
      return;
    }
    hits.slice(0, 8).forEach(function (hit) {
      var li = document.createElement("li");
      var a = document.createElement("a");
      a.href = hit.p.url;
      var g = document.createElement("span");
      g.className = "r-group";
      g.textContent = hit.p.group;
      a.appendChild(g);
      a.appendChild(document.createTextNode(hit.p.title));
      li.appendChild(a);
      out.appendChild(li);
    });
  }
  if (box && out) {
    box.addEventListener("input", function () { render(box.value.trim().toLowerCase()); });
    box.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { box.value = ""; render(""); box.blur(); }
      if (e.key === "ArrowDown") {
        var first = out.querySelector("a");
        if (first) { e.preventDefault(); first.focus(); }
      }
      if (e.key === "Enter") {
        var hit = out.querySelector("a");
        if (hit) { e.preventDefault(); window.location.href = hit.href; }
      }
    });
    document.addEventListener("keydown", function (e) {
      var tag = (e.target.tagName || "").toLowerCase();
      var typing = tag === "input" || tag === "textarea" || e.target.isContentEditable;
      if (((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing))) {
        e.preventDefault();
        if (document.body.classList.contains("nav-open") === false && window.innerWidth <= 960) {
          document.body.classList.add("nav-open");
          if (menu) menu.setAttribute("aria-expanded", "true");
        }
        box.focus();
        box.select();
      }
    });
  }

  // "On this page" highlighting
  var rail = document.getElementById("rail");
  if (rail && "IntersectionObserver" in window) {
    var links = {};
    Array.prototype.forEach.call(rail.querySelectorAll("a"), function (a) {
      links[a.getAttribute("href").slice(1)] = a;
    });
    var visible = [];
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var id = entry.target.id;
        var at = visible.indexOf(id);
        if (entry.isIntersecting && at === -1) visible.push(id);
        if (!entry.isIntersecting && at !== -1) visible.splice(at, 1);
      });
      var order = Object.keys(links);
      visible.sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });
      Object.keys(links).forEach(function (id) { links[id].classList.remove("is-active"); });
      if (visible.length) links[visible[0]].classList.add("is-active");
    }, { rootMargin: "-80px 0px -70% 0px" });
    Object.keys(links).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) obs.observe(el);
    });
  }
})();
`;

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

function navHtml(currentUrl) {
  return byGroup
    .map(({ group, items }) => {
      const links = items
        .map((p) => {
          const current = p.url === currentUrl ? ' aria-current="page"' : "";
          return `<li><a href="${p.url}"${current}>${escapeHtml(p.title)}</a></li>`;
        })
        .join("\n          ");
      return `<div class="nav-group">
        <p class="nav-group__label">${escapeHtml(group)}</p>
        <ul class="nav-list">
          ${links}
        </ul>
      </div>`;
    })
    .join("\n      ");
}

function railHtml(toc) {
  if (toc.length < 2) return "";
  const items = toc
    .map(
      (h) =>
        `<li><a class="${h.depth === 3 ? "d3" : "d2"}" href="#${h.id}">${escapeHtml(h.text)}</a></li>`
    )
    .join("\n        ");
  return `<nav class="rail" id="rail" aria-label="On this page">
      <p class="rail__label">On this page</p>
      <ul>
        ${items}
      </ul>
    </nav>`;
}

function pagerHtml(page) {
  const at = ordered.indexOf(page);
  if (at === -1) return "";
  const prev = ordered[at - 1];
  const next = ordered[at + 1];
  if (!prev && !next) return "";
  const prevHtml = prev
    ? `<a class="prev" href="${prev.url}"><span class="dir">Previous</span><span class="label">${escapeHtml(prev.title)}</span></a>`
    : `<span style="flex:1 1 0"></span>`;
  const nextHtml = next
    ? `<a class="next" href="${next.url}"><span class="dir">Next</span><span class="label">${escapeHtml(next.title)}</span></a>`
    : `<span style="flex:1 1 0"></span>`;
  return `<nav class="pager" aria-label="Page navigation">${prevHtml}${nextHtml}</nav>`;
}

function shell(page, bodyHtml) {
  const isIndex = !page.slug;
  const breadcrumb = isIndex
    ? `<a href="${BASE}/">Documentation</a>`
    : `<a href="${BASE}/">Documentation</a><span>&rsaquo;</span>${escapeHtml(page.group)}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(page.title)} · ${SITE_TITLE}</title>
<meta name="description" content="${escapeHtml(page.description)}">
<link rel="canonical" href="${ORIGIN}${page.url}">
<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">
<meta name="author" content="CRE Edge, LLC">
<meta name="theme-color" content="#f5f0e8">
<meta property="og:site_name" content="${SITE_TITLE}">
<meta property="og:title" content="${escapeHtml(page.title)} · ${SITE_TITLE}">
<meta property="og:description" content="${escapeHtml(page.description)}">
<meta property="og:type" content="article">
<meta property="og:url" content="${ORIGIN}${page.url}">
<meta property="og:image" content="${ORIGIN}${OG_IMAGE}">
<meta property="og:image:alt" content="The Excelente task pane open beside a rent roll in Microsoft Excel.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(page.title)} · ${SITE_TITLE}">
<meta name="twitter:description" content="${escapeHtml(page.description)}">
<meta name="twitter:image" content="${ORIGIN}${OG_IMAGE}">
<script type="application/ld+json">${jsonLd(page)}</script>
<link rel="icon" type="image/x-icon" href="/assets/favicon.ico">
<link rel="icon" type="image/png" sizes="32x32" href="/assets/icon-32.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=DM+Serif+Display:ital@0;1&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body>
<a class="sr-only" href="#main">Skip to content</a>

<header class="top">
  <a class="brand" href="/">
    <img src="/assets/logo-filled.png" alt="">
    <span class="brand__name"><span>e</span>xcelente</span>
  </a>
  <span class="brand__docs">Docs</span>
  <span class="top__spacer"></span>
  <button class="menu-btn" id="menu-btn" type="button" aria-expanded="false" aria-controls="sidebar">☰ Menu</button>
  <nav class="top__links" aria-label="Site">
    <a href="/">Home</a>
    <a href="/support">Support</a>
    <a href="${REPO_URL}" target="_blank" rel="noopener">GitHub</a>
  </nav>
</header>

<div class="layout">
  <nav class="sidebar" id="sidebar" aria-label="Documentation">
    <div class="search-wrap">
      <label class="sr-only" for="docsearch">Search documentation</label>
      <input class="search" id="docsearch" type="search" placeholder="Search docs&nbsp;&nbsp;/" autocomplete="off">
      <ul class="search-results" id="search-results"></ul>
    </div>
    ${navHtml(page.url)}
  </nav>

  <main class="content" id="main">
    <div class="content__inner">
      <p class="breadcrumb">${breadcrumb}</p>
      <div class="title-row">
        <h1>${escapeHtml(page.title)}</h1>
        <button class="copy-btn" id="copy-page" type="button" title="Copy this page as Markdown">
          <span aria-hidden="true">⧉</span><span class="copy-label">Copy page</span>
        </button>
      </div>
      <p class="lead">${escapeHtml(page.description)}</p>
      <div class="prose">
${bodyHtml}
      </div>
      ${pagerHtml(page)}
    </div>
  </main>

  ${railHtml(page.toc)}
</div>

<footer class="foot">
  <div class="foot__inner">
    <div>An open source project from the <a href="https://www.aiedge.ac">AI.Edge</a> team at <a href="https://www.adventuresincre.com">A.CRE</a>.</div>
    <div>&copy; 2026 CRE Edge, LLC &middot; <a href="/license.txt">Apache 2.0</a> &middot; <a href="/privacy">Privacy</a> &middot; <a href="/terms">Terms</a> &middot; <a href="/support">Support</a></div>
  </div>
</footer>

<script type="text/markdown" id="page-md">${escapeForScript(page.markdown)}</script>
<script src="${BASE}/search-index.js"></script>
<script>${JS}</script>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

/** The index's card grid is generated so it cannot drift from the sidebar. */
function indexCards() {
  return byGroup
    .map(({ group, items }) => {
      const cards = items
        .map(
          (p) =>
            `<a class="card" href="${p.url}"><span class="card__title">${escapeHtml(p.title)}</span><span class="card__desc">${escapeHtml(p.description)}</span></a>`
        )
        .join("\n  ");
      return `<h2 id="${slugify(group)}">${escapeHtml(group)}<a class="anchor" href="#${slugify(group)}" aria-label="Link to this section">#</a></h2>\n<div class="cards">\n  ${cards}\n</div>`;
    })
    .join("\n");
}

mkdirSync(OUT_DIR, { recursive: true });

// The search index is its own file rather than inline in all 30 pages: the
// browser fetches it once and caches it, which is what makes indexing body
// terms affordable at all.
const searchIndex = JSON.stringify(
  ordered.map((p) => ({
    title: p.title,
    description: p.description,
    group: p.group,
    url: p.url,
    headings: p.toc.map((h) => h.text),
    code: p.code,
    terms: p.terms,
  }))
);
writeFileSync(resolve(OUT_DIR, "search-index.js"), `window.__DOCS_INDEX__ = ${searchIndex};\n`);
console.log(`  dist/documentation/search-index.js  (${(searchIndex.length / 1024).toFixed(0)} KB)`);

// The index gets its hand-written body, then the generated card grid.
const indexToc = byGroup.map(({ group }) => ({ id: slugify(group), text: group, depth: 2 }));
const indexPage = { ...index, toc: [...index.toc, ...indexToc] };
writeFileSync(resolve(OUT_DIR, "index.html"), shell(indexPage, index.html + "\n" + indexCards()));
console.log("  dist/documentation/index.html");

for (const page of ordered) {
  const dir = resolve(OUT_DIR, page.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "index.html"), shell(page, page.html));
  console.log(`  dist/documentation/${page.slug}/index.html`);
}

console.log(`\nDocumentation: ${ordered.length} pages + index across ${byGroup.length} groups.`);
