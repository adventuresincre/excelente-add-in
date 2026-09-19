// One-off audit helper: measure every client-side prompt surface.
// Run: node scripts/measure-prompts.mjs   (token estimate = chars/4,
// matching core/agent/compaction.ts's heuristic)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const tok = (s) => Math.round(s.length / 4);

/** Extract a template-literal const from a TS file (handles \` escapes). */
function extractTemplate(source, constName) {
  const startMarker = source.indexOf(`${constName} = \``);
  if (startMarker === -1) throw new Error(`${constName} not found`);
  let i = startMarker + constName.length + 4;
  let out = "";
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\" && source[i + 1] === "`") {
      out += "`";
      i += 2;
      continue;
    }
    if (ch === "`") break;
    out += ch;
    i++;
  }
  return out;
}

function stripFrontmatter(md) {
  const m = /^---\n[\s\S]*?\n---\n/.exec(md);
  return m ? md.slice(m[0].length) : md;
}

function frontmatterField(md, field) {
  const re = new RegExp(`^${field}:\\s*(.+)$`, "m");
  const m = re.exec(md);
  return m ? m[1].trim() : "";
}

const rows = [];
const add = (name, text) => rows.push({ name, chars: text.length, tokens: tok(text) });

// 1. SYSTEM_PROMPT_BASE
const uas = read("src/ui/taskpane/chat/useAgentStream.ts");
const base = extractTemplate(uas, "SYSTEM_PROMPT_BASE");
add("SYSTEM_PROMPT_BASE", base);

// 2. Always-injected conventions body
const conv = stripFrontmatter(read("skills/cre-modeling-conventions/SKILL.md"));
add("cre-modeling-conventions body (always injected)", conv);

// 3. Mode prompts
add("work-mode.md", read("src/core/agent/mode-prompts/work-mode.md"));
add("plan-mode.md", read("src/core/agent/mode-prompts/plan-mode.md"));

// 4. Core-skill summary lines (office-js-patterns + verify-model-outputs)
let summaryLines = "";
for (const name of ["office-js-patterns", "verify-model-outputs"]) {
  const md = read(`skills/${name}/SKILL.md`);
  summaryLines += `- ${name}: ${frontmatterField(md, "description")} — when to use: ${frontmatterField(md, "whenToUse")}\n`;
}
add("core-skill summary lines", summaryLines);

// 5. Sub-agent role prompts
const st = read("src/core/agent/subagent-types.ts");
const matches = [...st.matchAll(/systemPrompt: `([^`]*)`/g)];
const roleNames = ["Explore", "Audit", "Builder", "Reviewer"];
matches.forEach((m, i) => add(`subagent prompt: ${roleNames[i] ?? i}`, m[1]));

// 6. Conversation summarizer prompt
const cs = read("src/core/agent/conversation-summary.ts");
add("conversation-summary SYSTEM_PROMPT", extractTemplate(cs, "SYSTEM_PROMPT"));

// 7. Per-turn system prompt total (typical: base + conventions + mode + summaries)
const work = read("src/core/agent/mode-prompts/work-mode.md");
const typical = base + "\n## A.CRE modeling conventions...\n" + conv + "\n" + work + "\n" + summaryLines;
add("≈ TYPICAL ASSEMBLED SYSTEM PROMPT (work mode, no memory)", typical);

// 8. All bundled skill bodies + frontmatter summaries (lazy cost reference)
import { existsSync, readdirSync } from "node:fs";
// The shared five under skills/, plus whatever each edition bundles on top
// (src/edition/<name>/skills/). Non-skill files (LICENSE.md and the like)
// sit at the top level of those folders and have no SKILL.md, so skip them.
const skillDirs = [join(root, "skills")];
const editionsDir = join(root, "src", "edition");
if (existsSync(editionsDir)) {
  for (const e of readdirSync(editionsDir)) {
    const d = join(editionsDir, e, "skills");
    if (existsSync(d)) skillDirs.push(d);
  }
}
for (const base of skillDirs) {
  for (const dir of readdirSync(base)) {
    const file = join(base, dir, "SKILL.md");
    if (!existsSync(file)) continue;
    const md = readFileSync(file, "utf8");
    rows.push({ name: `  [skill body, lazy] ${dir}`, chars: md.length, tokens: tok(md) });
  }
}

console.log("component".padEnd(58) + "chars".padStart(8) + "~tokens".padStart(9));
for (const r of rows) {
  console.log(r.name.padEnd(58) + String(r.chars).padStart(8) + String(r.tokens).padStart(9));
}
