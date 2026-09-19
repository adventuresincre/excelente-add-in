/**
 * Turns a ToolItem into the words a reader sees on a tool row.
 *
 * Pure, React-free and unit-tested: the transcript's legibility is the point
 * of the redesign, so the wording is worth asserting on rather than eyeballing.
 *
 * Three fields drive the collapsed row, and the third is the one that was
 * missing before this module existed:
 *
 *   verb     what happened, in plain language ("Searched skills")
 *   object   what it acted on, muted ("for \"chart of accounts\"")
 *   outcome  WHAT CAME BACK, right-aligned ("3 found")
 *
 * A row that only names the call tells a reader a thing happened. The outcome
 * is what tells them whether it worked. 2026-09-16: a run mapped 110 T-12
 * lines by hand because two connectors were absent, and the only trace was a
 * collapsed thinking block.
 *
 * The raw tool name never disappears; it moves into the expanded panel. Plain
 * language on top only works when the machine name is one click away, because
 * that string is what someone pastes into a bug report.
 */

import type { ToolItem } from "./useAgentStream";

export interface ToolSummary {
  verb: string;
  object: string | null;
  /** null when the tool has no result worth a word (or hasn't finished). */
  outcome: string | null;
  /** Drives the outcome's colour. Neutral unless something needs a human. */
  tone: "neutral" | "warn" | "bad";
}

export interface ToolDetail {
  label: string;
  value: string;
}

/* --------------------------------- helpers -------------------------------- */

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/** "mcp_acme__classify" → { server: "acme", tool: "classify" } */
export function parseMcpName(toolName: string): { server: string; tool: string } | null {
  if (!toolName.startsWith("mcp_")) return null;
  const rest = toolName.slice(4);
  const split = rest.indexOf("__");
  if (split <= 0) return null;
  return { server: rest.slice(0, split), tool: rest.slice(split + 2) };
}

/**
 * Server names are user-typed ("acre-hub", "my-data-api"), so they get cased
 * for display rather than looked up. A known-brand table would silently fall
 * back to the raw string for every server we have not heard of, which is most.
 *
 * Only the A.CRE connectors that already ship publicly in `mcp/presets.ts`
 * belong in this table. A private or trial connector gets the title-cased
 * fallback, which reads fine and keeps its name out of the public bundle.
 */
export function serverLabel(server: string): string {
  const known: Record<string, string> = {
    vic: "Vic",
    "cre-agents": "CRE Agents",
    hub: "Intelligence Hub",
  };
  if (known[server]) return known[server];
  return server
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Built-in tools are a fixed set, so a verb table is safe here. */
const VERBS: Record<string, string> = {
  inspect_workbook: "Read",
  find_cells: "Searched cells",
  screenshot: "Captured a screenshot",
  trace_dependencies: "Traced dependencies",
  write_range: "Wrote",
  format_range: "Formatted",
  create_sheet: "Created sheet",
  run_excel_script: "Ran a script",
  undo_last_write: "Undid the last write",
  find_skill: "Searched skills",
  load_skill: "Loaded skill",
  read_skill_resource: "Read reference",
  install_skill: "Installed skill",
  propose_skill: "Proposed a skill",
  update_todos: "Updated tasks",
  submit_plan: "Submitted a plan",
  ask_user: "Asked you",
  run_subagent: "Delegated",
  read_workbook_memory: "Read workbook memory",
  write_workbook_memory: "Saved to workbook memory",
  read_workbook_settings: "Read workbook settings",
  write_workbook_settings: "Saved workbook settings",
};

/* -------------------------------- collapsed ------------------------------- */

export function summarizeTool(item: ToolItem): ToolSummary {
  const input = asRecord(item.input) ?? {};
  const mcp = parseMcpName(item.toolName);

  if (mcp) return summarizeMcp(item, mcp, input);

  const verb = VERBS[item.toolName] ?? humanizeName(item.toolName);
  const object = describeObject(item.toolName, input) ?? item.summary ?? null;
  const { outcome, tone } = describeOutcome(item);
  return { verb, object, outcome, tone };
}

/**
 * MCP rows lead with the SERVER, not the tool. Provenance is the thing a
 * reader needs from a bridged call ("this came from Acme, which I chose
 * to connect"), and leading with the server generalizes to any connector
 * instead of needing a verb per third-party tool.
 */
function summarizeMcp(
  item: ToolItem,
  mcp: { server: string; tool: string },
  input: Record<string, unknown>
): ToolSummary {
  const parts = [mcp.tool];
  const items = input.items;
  if (Array.isArray(items)) parts.push(plural(items.length, "row"));
  const { outcome, tone } = describeOutcome(item);
  return {
    verb: serverLabel(mcp.server),
    object: item.summary ?? parts.join(" · "),
    outcome,
    tone,
  };
}

function humanizeName(toolName: string): string {
  const words = toolName.split(/[_-]/).filter(Boolean);
  if (words.length === 0) return toolName;
  return words.join(" ").replace(/^./, (c) => c.toUpperCase());
}

function describeObject(toolName: string, input: Record<string, unknown>): string | null {
  const sheet = str(input.sheetName);
  const address = str(input.address);
  if (sheet && address) return `${sheet} · ${address.toUpperCase()}`;
  if (sheet) return sheet;

  const query = str(input.query);
  if (query) return `for “${query}”`;
  const name = str(input.name) ?? str(input.skill_name) ?? str(input.skillName);
  if (name) return name;
  const path = str(input.path) ?? str(input.resource);
  if (path) return path;
  const role = str(input.role);
  if (role) return `to a ${role} sub-agent`;
  if (toolName === "inspect_workbook") {
    const scope = str(input.scope);
    if (scope) return `${scope} outline`;
  }
  return null;
}

/* --------------------------------- outcome -------------------------------- */

function describeOutcome(item: ToolItem): { outcome: string | null; tone: ToolSummary["tone"] } {
  if (item.status === "error") return { outcome: "failed", tone: "bad" };
  if (item.status === "rejected") return { outcome: "declined", tone: "warn" };
  if (item.status === "pending") return { outcome: "needs approval", tone: "warn" };
  if (item.status !== "result") return { outcome: null, tone: "neutral" };

  const result = item.result;

  // MCP text results arrive as a JSON string from the bridge. Our connectors
  // put a `summary` object at the top; read it when it is there.
  if (typeof result === "string") {
    const parsed = tryParse(result);
    if (parsed) {
      const fromSummary = mcpOutcome(parsed);
      if (fromSummary) return fromSummary;
    }
    return { outcome: null, tone: "neutral" };
  }

  const rec = asRecord(result);
  if (!rec) return { outcome: null, tone: "neutral" };

  const fromSummary = mcpOutcome(rec);
  if (fromSummary) return fromSummary;

  // find_skill
  if (Array.isArray(rec.matches)) {
    const n = rec.matches.length;
    return n === 0
      ? { outcome: "none found", tone: "warn" }
      : { outcome: `${n} found`, tone: "neutral" };
  }

  // load_skill
  if (str(rec.body) && Array.isArray(rec.resources)) {
    const n = rec.resources.length;
    return { outcome: n ? `+ ${plural(n, "reference")}` : "loaded", tone: "neutral" };
  }

  // inspect_workbook (range read)
  if (Array.isArray(rec.values)) {
    const rows = rec.values.length;
    const note = str(rec.note);
    return {
      outcome: note ? `${plural(rows, "row")} · clipped` : plural(rows, "row"),
      tone: note ? "warn" : "neutral",
    };
  }

  // write_range
  const rowCount = num(rec.rowCount);
  const columnCount = num(rec.columnCount);
  if (rowCount !== null && columnCount !== null) {
    return { outcome: `${rowCount}×${columnCount} cells`, tone: "neutral" };
  }

  // run_excel_script
  if (typeof rec.ok === "boolean") {
    return rec.ok ? { outcome: "ok", tone: "neutral" } : { outcome: "script failed", tone: "bad" };
  }

  if (str(rec.formatted)) return { outcome: "styled", tone: "neutral" };
  if (str(rec.restored)) return { outcome: "restored", tone: "neutral" };

  return { outcome: null, tone: "neutral" };
}

/**
 * Our MCP connectors return `{ summary: {...}, results: [...] }`. The counts
 * a reader cares about are the ones that mean work is left: rows needing
 * review, rows that failed, rows skipped against the batch deadline.
 */
function mcpOutcome(
  parsed: Record<string, unknown>
): { outcome: string; tone: ToolSummary["tone"] } | null {
  const summary = asRecord(parsed.summary);
  if (!summary) return null;

  const failed = num(summary.failed) ?? 0;
  const skipped = num(summary.skipped) ?? 0;
  const review = num(summary.needs_review);
  const items = num(summary.items);

  if (failed > 0 && items !== null && failed === items) {
    return { outcome: "all rows failed", tone: "bad" };
  }
  if (failed > 0) return { outcome: `${failed} failed`, tone: "bad" };
  if (skipped > 0) return { outcome: `${skipped} skipped`, tone: "warn" };
  if (review !== null && review > 0) return { outcome: `${review} to review`, tone: "warn" };
  if (review === 0 && items !== null) return { outcome: "all confident", tone: "neutral" };
  if (items !== null) return { outcome: plural(items, "row"), tone: "neutral" };
  return null;
}

function tryParse(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    return asRecord(JSON.parse(trimmed));
  } catch {
    return null;
  }
}

/* -------------------------------- expanded -------------------------------- */

const MAX_DETAIL_CHARS = 400;

/**
 * Rows for the expanded panel. Always ends with the machine facts (real tool
 * name, permission level), because those are what a reader needs when the
 * plain-language version is not enough.
 */
export function detailsFor(item: ToolItem): ToolDetail[] {
  const out: ToolDetail[] = [];
  const result = item.result;
  const rec = typeof result === "string" ? tryParse(result) : asRecord(result);

  if (rec) {
    if (Array.isArray(rec.matches)) {
      const names = rec.matches
        .map((m) => (asRecord(m) ? str(asRecord(m)!.name) : null))
        .filter((n): n is string => Boolean(n));
      out.push({
        label: "Matched, best first",
        value: names.length ? names.join(" · ") : "nothing matched the query",
      });
    }

    if (str(rec.body) && Array.isArray(rec.resources)) {
      const resources = rec.resources.filter((r): r is string => typeof r === "string");
      out.push({ label: "Skill", value: str(rec.name) ?? item.toolName });
      out.push({
        label: "References available",
        value: resources.length ? resources.join(" · ") : "none",
      });
    }

    const summary = asRecord(rec.summary);
    if (summary) {
      const bits: string[] = [];
      const items = num(summary.items);
      if (items !== null) bits.push(plural(items, "row"));
      const ok = num(summary.ok);
      if (ok !== null) bits.push(`${ok} answered`);
      const review = num(summary.needs_review);
      if (review !== null) bits.push(`${review} flagged`);
      if (bits.length) out.push({ label: "Batch", value: bits.join(" · ") });

      const cost = num(summary.est_cost_usd);
      const elapsed = num(summary.elapsed_ms);
      const meta: string[] = [];
      if (cost !== null) meta.push(`$${cost.toFixed(5)}`);
      if (elapsed !== null) meta.push(`${(elapsed / 1000).toFixed(1)}s`);
      const model = str(summary.model);
      if (model) meta.push(model);
      if (meta.length) out.push({ label: "Cost", value: meta.join(" · ") });

      const note = str(summary.note);
      if (note) out.push({ label: "Note", value: note });
    }

    const note = str(rec.note);
    if (note) out.push({ label: "Note", value: note });
    const written = str(rec.written) ?? str(rec.formatted) ?? str(rec.restored);
    if (written) out.push({ label: "Range", value: written });
  }

  if (typeof result === "string" && !rec) {
    out.push({ label: "Returned", value: clip(result) });
  }

  if (item.error) out.push({ label: "Error", value: clip(item.error) });

  const machine = [item.toolName, item.requiredPermission];
  if (item.auto) machine.push("run automatically");
  if (item.reverted) machine.push("reverted");
  out.push({ label: "Tool", value: machine.join(" · ") });

  return out;
}

function clip(text: string): string {
  const t = text.trim();
  return t.length > MAX_DETAIL_CHARS ? `${t.slice(0, MAX_DETAIL_CHARS)}…` : t;
}

/** Full result for the "Show raw" toggle. Capped so a 40 KB blob cannot hang the pane. */
const MAX_RAW_CHARS = 20_000;

export function rawResult(item: ToolItem): string | null {
  if (item.result === undefined && !item.input) return null;
  const payload = {
    input: item.input ?? null,
    ...(item.result !== undefined && { result: item.result }),
    ...(item.error && { error: item.error }),
  };
  let text: string;
  try {
    text = JSON.stringify(payload, null, 2);
  } catch {
    return "(result could not be serialized)";
  }
  return text.length > MAX_RAW_CHARS
    ? `${text.slice(0, MAX_RAW_CHARS)}\n… truncated, ${text.length.toLocaleString()} characters total`
    : text;
}
