import { columnLetterToIndex, formatA1, formatRange, parseA1, parseRange } from "./address";
import type { CellRef, RangeRef } from "./address";
import type { ExcelDataSource } from "./datasource";
import { matchRefAt, normalizeFormula } from "./formula-norm";
import { readRange } from "./range-read";
import type { NamedRangeInfo, SheetSummary } from "./types";

/**
 * Formula dependency tracing — Phase 2.4.
 *
 * Answers the two questions Excel's own Trace Precedents / Trace Dependents
 * answer, but workbook-wide and in a form an agent can act on:
 *
 *   precedents — what does this cell's formula READ? (its inputs)
 *   dependents — which formulas READ this cell? (its blast radius)
 *
 * The core insight that keeps this cheap: an A1 reference inside a formula
 * is an absolute coordinate regardless of `$` markers ($ only affects
 * fill/copy behavior). So extraction AND resolution are pure functions of
 * the formula *text* (plus the host sheet for unqualified refs), and a
 * workbook-wide dependents scan caches both per unique formula string —
 * a filled-down column of 500 formulas costs 500 cache hits, not 500 parses.
 *
 * Known limitations (surfaced in the result rather than silently wrong):
 *   - INDIRECT / OFFSET build references at calc time — untraceable from text.
 *   - Table structured references (Table1[Col]) are not resolved.
 *   - External-workbook links ([Book.xlsx]Sheet1!A1) are not resolved.
 *   - 3-D references (Sheet1:Sheet3!A1) resolve only their last sheet.
 */

/* --------------------------------- Limits --------------------------------- */

/** Excel's grid bounds (XFD1048576), zero-indexed. */
const EXCEL_MAX_ROW = 1_048_575;
const EXCEL_MAX_COL = 16_383;

/** Hard cap on transitive depth — beyond 3 the output stops being readable. */
export const MAX_TRACE_DEPTH = 3;
/** Cap on reported entries across all depths. */
const MAX_ENTRIES = 60;
/** Cap on unique unresolved-reference examples retained. */
const MAX_UNRESOLVED = 10;
/** Don't recurse precedents into a referenced area larger than this. */
const MAX_PRECEDENT_RECURSE_CELLS = 5_000;
/** Cap on the transitive target set for dependents depth ≥ 2. */
const MAX_TRANSITIVE_TARGET_CELLS = 2_000;

/* --------------------------------- Types ---------------------------------- */

export type TraceDirection = "precedents" | "dependents";

export interface TraceTarget {
  sheetName: string;
  /** A1 cell or rectangular range, e.g. "B5" or "B5:D10". */
  address: string;
}

export interface TraceOptions {
  /** 1 = direct only (default). Clamped to MAX_TRACE_DEPTH. */
  depth?: number;
  /** Dependents only: restrict the formula scan to these sheets. */
  scopeSheets?: string[];
}

export interface DependencyEntry {
  /** Sheet-qualified location, e.g. "Model!D5:D40". */
  location: string;
  /** Number of cells this entry covers (dependent cells / referenced cells). */
  cellCount: number;
  /** 1 = direct, 2+ = transitive. */
  depth: number;
  /** The reference text that links this entry to the target, e.g. "Inputs!$B$5". */
  via?: string;
  /** Named range the link went through, when applicable. */
  viaName?: string;
  /** Dependents: example formula from one cell in the group. */
  exampleFormula?: string;
  exampleAddress?: string;
  /** Precedents: how many formula cells in the traced area referenced this. */
  referencedBy?: number;
}

export interface UnresolvedRef {
  text: string;
  reason: "structured" | "external" | "unknown-sheet" | "name-not-range" | "invalid";
}

export interface DependencyTraceResult {
  /** Sheet-qualified target, e.g. "Model!B5". */
  target: string;
  direction: TraceDirection;
  /** Effective (clamped) depth. */
  depth: number;
  entries: DependencyEntry[];
  unresolved: UnresolvedRef[];
  warnings: string[];
  truncated: boolean;
  scannedSheets: string[];
  scannedFormulaCells: number;
}

/* ------------------------- Reference extraction ---------------------------- */

interface RawRefToken {
  /** Sheet qualifier with quotes stripped; undefined = host sheet. */
  sheetName?: string;
  /** Verbatim matched text, e.g. "'My Sheet'!$B$5:D10" or "B:B". */
  text: string;
  kind: "cell" | "col" | "row";
  left: string;
  right?: string;
  /** Token immediately followed a [...] segment — external-workbook form. */
  external: boolean;
}

export interface ExtractedRefs {
  refs: RawRefToken[];
  /** Bare identifiers outside strings — candidate named ranges. */
  idents: string[];
  /** Structured table references, verbatim (e.g. "Table1[Total]"). */
  structured: string[];
  /** Dynamic-reference functions present (INDIRECT, OFFSET). */
  dynamic: string[];
}

const SHEET_PREFIX_RE = /^(?:'([^']+)'|([A-Za-z_][\w.]*))!/;
const COL_RANGE_RE = /^\$?([A-Z]+):\$?([A-Z]+)(?![A-Za-z0-9_(!])/;
const ROW_RANGE_RE = /^\$?(\d+):\$?(\d+)(?!\d)/;
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_.]*/;
const DYNAMIC_FUNCTIONS = new Set(["INDIRECT", "OFFSET"]);

function prevCharBlocks(formula: string, i: number): boolean {
  if (i === 0) return false;
  return /[A-Za-z0-9_.]/.test(formula[i - 1]);
}

/**
 * Tokenize a formula into references, identifiers, structured refs, and
 * dynamic-function markers. Purely textual — results are cacheable per
 * formula string. String literals are skipped (refs inside INDIRECT("…")
 * are data, not references).
 */
export function extractFormulaRefs(formula: string): ExtractedRefs {
  const refs: RawRefToken[] = [];
  const idents: string[] = [];
  const structured: string[] = [];
  const dynamic: string[] = [];

  let i = 0;
  const n = formula.length;
  // True right after a [...] segment closes — the unquoted external-workbook
  // form is `[Book.xlsx]Sheet1!A1`, so a ref starting there is external.
  let externalPending = false;

  while (i < n) {
    const ch = formula[i];

    // Skip string literals (with "" escapes).
    if (ch === '"') {
      i++;
      while (i < n) {
        if (formula[i] === '"') {
          if (formula[i + 1] === '"') {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      externalPending = false;
      continue;
    }

    // Standalone bracket segment — external workbook index/name.
    if (ch === "[") {
      const close = formula.indexOf("]", i);
      i = close === -1 ? n : close + 1;
      externalPending = true;
      continue;
    }

    // Cell / cell-range reference (optionally sheet-qualified).
    const refMatch = matchRefAt(formula, i);
    if (refMatch) {
      refs.push({
        sheetName: stripSheetPrefix(refMatch.sheetPrefix),
        text: formula.slice(i, i + refMatch.length),
        kind: "cell",
        left: refMatch.left,
        right: refMatch.right,
        external: externalPending,
      });
      externalPending = false;
      i += refMatch.length;
      continue;
    }

    // Whole-column (B:B) / whole-row (5:5) references, optionally
    // sheet-qualified — matchRefAt requires digits after letters so these
    // need their own matchers.
    if (!prevCharBlocks(formula, i)) {
      const remainder = formula.slice(i);
      let cursor = 0;
      let sheetName: string | undefined;
      const sheetMatch = SHEET_PREFIX_RE.exec(remainder);
      if (sheetMatch) {
        sheetName = sheetMatch[1] ?? sheetMatch[2];
        cursor = sheetMatch[0].length;
      }
      const colMatch = COL_RANGE_RE.exec(remainder.slice(cursor));
      if (colMatch) {
        refs.push({
          sheetName,
          text: remainder.slice(0, cursor + colMatch[0].length),
          kind: "col",
          left: colMatch[1],
          right: colMatch[2],
          external: externalPending,
        });
        externalPending = false;
        i += cursor + colMatch[0].length;
        continue;
      }
      const rowMatch = ROW_RANGE_RE.exec(remainder.slice(cursor));
      if (rowMatch) {
        refs.push({
          sheetName,
          text: remainder.slice(0, cursor + rowMatch[0].length),
          kind: "row",
          left: rowMatch[1],
          right: rowMatch[2],
          external: externalPending,
        });
        externalPending = false;
        i += cursor + rowMatch[0].length;
        continue;
      }
    }

    // Identifier: function name, structured table ref, or named range.
    if (/[A-Za-z_]/.test(ch) && !prevCharBlocks(formula, i)) {
      const m = IDENT_RE.exec(formula.slice(i));
      if (m) {
        const word = m[0];
        const after = formula[i + word.length];
        if (after === "(") {
          if (DYNAMIC_FUNCTIONS.has(word.toUpperCase())) dynamic.push(word.toUpperCase());
          i += word.length;
          externalPending = false;
          continue;
        }
        if (after === "[") {
          const close = formula.indexOf("]", i + word.length);
          const end = close === -1 ? n : close + 1;
          structured.push(formula.slice(i, end));
          i = end;
          externalPending = false;
          continue;
        }
        if (after === "!") {
          // Sheet-qualified token the ref matchers rejected (e.g. the prefix
          // of `Sheet1!#REF!`). Consume the prefix so the sheet name isn't
          // misread as a named range.
          i += word.length + 1;
          externalPending = false;
          continue;
        }
        idents.push(word);
        i += word.length;
        externalPending = false;
        continue;
      }
    }

    externalPending = false;
    i++;
  }

  return { refs, idents, structured, dynamic };
}

function stripSheetPrefix(prefix: string): string | undefined {
  if (!prefix) return undefined;
  let s = prefix.endsWith("!") ? prefix.slice(0, -1) : prefix;
  if (s.startsWith("'") && s.endsWith("'")) s = s.slice(1, -1);
  return s;
}

/* --------------------------- Reference resolution -------------------------- */

interface ResolvedRef {
  /** Canonical sheet name (as listed by the workbook). */
  sheetName: string;
  range: RangeRef;
  kind: "cell" | "col" | "row" | "name";
  /** Verbatim reference text from the formula (or the name itself). */
  text: string;
  viaName?: string;
}

type NameAreas = { areas: { sheetName: string; range: RangeRef }[] } | "non-range";

interface ResolveContext {
  hostSheet: string;
  /** lowercased name → canonical sheet name. */
  sheetNames: Map<string, string>;
  /** lowercased name → resolved areas (or "non-range" for constant/formula names). */
  nameIndex: Map<string, NameAreas>;
}

interface ResolveOutcome {
  resolved: ResolvedRef[];
  unresolved: UnresolvedRef[];
}

function resolveExtracted(ext: ExtractedRefs, ctx: ResolveContext): ResolveOutcome {
  const resolved: ResolvedRef[] = [];
  const unresolved: UnresolvedRef[] = [];

  const resolveIdent = (word: string, verbatim: string) => {
    const entry = ctx.nameIndex.get(word.toLowerCase());
    if (!entry) return; // function-less token, TRUE/FALSE, etc. — not a name
    if (entry === "non-range") {
      unresolved.push({ text: verbatim, reason: "name-not-range" });
      return;
    }
    for (const area of entry.areas) {
      resolved.push({
        sheetName: area.sheetName,
        range: area.range,
        kind: "name",
        text: verbatim,
        viaName: word,
      });
    }
  };

  for (const token of ext.refs) {
    if (token.external) {
      unresolved.push({ text: token.text, reason: "external" });
      continue;
    }
    let sheetName = ctx.hostSheet;
    if (token.sheetName !== undefined) {
      const canonical = ctx.sheetNames.get(token.sheetName.toLowerCase());
      if (!canonical) {
        unresolved.push({ text: token.text, reason: "unknown-sheet" });
        continue;
      }
      sheetName = canonical;
    }

    if (token.kind === "cell") {
      let left: CellRef;
      let right: CellRef;
      try {
        left = parseA1(token.left);
        right = token.right ? parseA1(token.right) : left;
      } catch {
        unresolved.push({ text: token.text, reason: "invalid" });
        continue;
      }
      const outOfGrid =
        left.col > EXCEL_MAX_COL ||
        right.col > EXCEL_MAX_COL ||
        left.row > EXCEL_MAX_ROW ||
        right.row > EXCEL_MAX_ROW;
      if (outOfGrid) {
        // "ZZZZ9" parses like an address but lies beyond XFD1048576 — Excel
        // only permits such tokens as defined names, so treat it as one.
        if (token.sheetName === undefined && token.right === undefined) {
          resolveIdent(token.text.replace(/\$/g, ""), token.text);
        } else {
          unresolved.push({ text: token.text, reason: "invalid" });
        }
        continue;
      }
      resolved.push({
        sheetName,
        range: normalizeRect(left, right),
        kind: "cell",
        text: token.text,
      });
      continue;
    }

    if (token.kind === "col") {
      const c1 = columnLetterToIndex(token.left);
      const c2 = columnLetterToIndex(token.right ?? token.left);
      if (c1 > EXCEL_MAX_COL || c2 > EXCEL_MAX_COL) {
        unresolved.push({ text: token.text, reason: "invalid" });
        continue;
      }
      resolved.push({
        sheetName,
        range: {
          topLeft: { col: Math.min(c1, c2), row: 0 },
          bottomRight: { col: Math.max(c1, c2), row: EXCEL_MAX_ROW },
        },
        kind: "col",
        text: token.text,
      });
      continue;
    }

    // kind === "row"
    const r1 = parseInt(token.left, 10) - 1;
    const r2 = parseInt(token.right ?? token.left, 10) - 1;
    if (r1 < 0 || r2 < 0 || r1 > EXCEL_MAX_ROW || r2 > EXCEL_MAX_ROW) {
      unresolved.push({ text: token.text, reason: "invalid" });
      continue;
    }
    resolved.push({
      sheetName,
      range: {
        topLeft: { col: 0, row: Math.min(r1, r2) },
        bottomRight: { col: EXCEL_MAX_COL, row: Math.max(r1, r2) },
      },
      kind: "row",
      text: token.text,
    });
  }

  for (const word of ext.idents) resolveIdent(word, word);
  for (const s of ext.structured) unresolved.push({ text: s, reason: "structured" });

  return { resolved, unresolved };
}

function normalizeRect(a: CellRef, b: CellRef): RangeRef {
  return {
    topLeft: { col: Math.min(a.col, b.col), row: Math.min(a.row, b.row) },
    bottomRight: { col: Math.max(a.col, b.col), row: Math.max(a.row, b.row) },
  };
}

/**
 * Resolve named ranges from their refersTo formulas. Names referring to
 * constants or computed formulas (rather than ranges) map to "non-range".
 * Multi-area names ("=Sheet1!$A$1,Sheet1!$C$1") resolve every area.
 */
function buildNameIndex(
  named: NamedRangeInfo[],
  sheetNames: Map<string, string>
): Map<string, NameAreas> {
  const index = new Map<string, NameAreas>();
  for (const nr of named) {
    let body = nr.refersTo.startsWith("=") ? nr.refersTo.slice(1) : nr.refersTo;
    body = body.trim();
    const areas: { sheetName: string; range: RangeRef }[] = [];
    let ok = body.length > 0;
    for (const part of splitTopLevel(body)) {
      const area = resolveAreaText(part.trim(), sheetNames);
      if (!area) {
        ok = false;
        break;
      }
      areas.push(area);
    }
    index.set(nr.name.toLowerCase(), ok && areas.length > 0 ? { areas } : "non-range");
  }
  return index;
}

/** Split on commas outside single-quoted segments (multi-area refersTo). */
function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let inQuotes = false;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "'") inQuotes = !inQuotes;
    else if (ch === "," && !inQuotes) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts;
}

/** Resolve a single "Sheet1!$A$1:$B$10" / "'My Sheet'!$A:$B" area string. */
function resolveAreaText(
  text: string,
  sheetNames: Map<string, string>
): { sheetName: string; range: RangeRef } | null {
  const ext = extractFormulaRefs(text);
  if (ext.refs.length !== 1) return null;
  const token = ext.refs[0];
  if (token.external || token.sheetName === undefined) return null;
  const canonical = sheetNames.get(token.sheetName.toLowerCase());
  if (!canonical) return null;
  const outcome = resolveExtracted(
    { refs: [token], idents: [], structured: [], dynamic: [] },
    { hostSheet: canonical, sheetNames, nameIndex: new Map() }
  );
  if (outcome.resolved.length !== 1) return null;
  return { sheetName: outcome.resolved[0].sheetName, range: outcome.resolved[0].range };
}

/* ------------------------------ Shared helpers ----------------------------- */

function rectsIntersect(a: RangeRef, b: RangeRef): boolean {
  return (
    a.topLeft.row <= b.bottomRight.row &&
    b.topLeft.row <= a.bottomRight.row &&
    a.topLeft.col <= b.bottomRight.col &&
    b.topLeft.col <= a.bottomRight.col
  );
}

function rectCellCount(r: RangeRef): number {
  return (r.bottomRight.row - r.topLeft.row + 1) * (r.bottomRight.col - r.topLeft.col + 1);
}

/** Intersect a rect with a sheet's used range; null when nothing overlaps. */
function clampToUsed(rect: RangeRef, dims: { rows: number; cols: number }): RangeRef | null {
  if (dims.rows === 0 || dims.cols === 0) return null;
  const used: RangeRef = {
    topLeft: { col: 0, row: 0 },
    bottomRight: { col: dims.cols - 1, row: dims.rows - 1 },
  };
  if (!rectsIntersect(rect, used)) return null;
  return {
    topLeft: {
      col: Math.max(rect.topLeft.col, 0),
      row: Math.max(rect.topLeft.row, 0),
    },
    bottomRight: {
      col: Math.min(rect.bottomRight.col, used.bottomRight.col),
      row: Math.min(rect.bottomRight.row, used.bottomRight.row),
    },
  };
}

interface WorkbookIndex {
  sheets: SheetSummary[];
  sheetNames: Map<string, string>;
  dims: Map<string, { rows: number; cols: number }>;
  nameIndex: Map<string, NameAreas>;
}

async function buildWorkbookIndex(ds: ExcelDataSource): Promise<WorkbookIndex> {
  const sheets = await ds.listSheets();
  const sheetNames = new Map<string, string>();
  const dims = new Map<string, { rows: number; cols: number }>();
  for (const s of sheets) {
    sheetNames.set(s.name.toLowerCase(), s.name);
    // `dims` is the extent FROM A1 that clampToUsed intersects against, so a
    // used range of B2:I8 must clamp to row 8 / column I, not row 7 / column H.
    const origin = s.usedRange ? parseRange(s.usedRange).topLeft : { col: 0, row: 0 };
    dims.set(s.name, {
      rows: s.rowCount === 0 ? 0 : origin.row + s.rowCount,
      cols: s.columnCount === 0 ? 0 : origin.col + s.columnCount,
    });
  }
  const named = await ds.getNamedRanges();
  return { sheets, sheetNames, dims, nameIndex: buildNameIndex(named, sheetNames) };
}

function canonicalSheet(index: WorkbookIndex, sheetName: string): string {
  const canonical = index.sheetNames.get(sheetName.toLowerCase());
  if (!canonical) throw new Error(`Sheet not found: ${sheetName}`);
  return canonical;
}

function clampDepth(depth: number | undefined): number {
  if (depth === undefined || !Number.isFinite(depth)) return 1;
  return Math.max(1, Math.min(MAX_TRACE_DEPTH, Math.floor(depth)));
}

function addUnresolved(into: Map<string, UnresolvedRef>, items: UnresolvedRef[]): void {
  for (const u of items) {
    if (into.size >= MAX_UNRESOLVED && !into.has(u.text)) continue;
    if (!into.has(u.text)) into.set(u.text, u);
  }
}

/* -------------------------------- Precedents ------------------------------- */

/**
 * What do the formulas in `target` read? Direct precedents come from parsing
 * the target's own formulas; depth ≥ 2 reads each referenced area and parses
 * its formulas in turn.
 */
export async function tracePrecedents(
  ds: ExcelDataSource,
  target: TraceTarget,
  opts: TraceOptions = {}
): Promise<DependencyTraceResult> {
  const depth = clampDepth(opts.depth);
  const index = await buildWorkbookIndex(ds);
  const targetSheet = canonicalSheet(index, target.sheetName);
  const targetRect = parseRange(target.address);

  const entries: DependencyEntry[] = [];
  const unresolved = new Map<string, UnresolvedRef>();
  const scannedSheets = new Set<string>();
  let scannedFormulaCells = 0;
  let dynamicCount = 0;
  let truncated = false;
  let skippedLargeAreas = 0;

  const extractCache = new Map<string, ExtractedRefs>();
  const visited = new Set<string>();

  let frontier: { sheetName: string; rect: RangeRef }[] = [
    { sheetName: targetSheet, rect: targetRect },
  ];

  for (let d = 1; d <= depth && frontier.length > 0 && !truncated; d++) {
    // location|viaName → accumulated link
    const found = new Map<string, { ref: ResolvedRef; referencedBy: number }>();

    for (const area of frontier) {
      const dims = index.dims.get(area.sheetName) ?? { rows: 0, cols: 0 };
      const clamped = clampToUsed(area.rect, dims);
      if (!clamped) continue;
      const areaKey = `${area.sheetName}|${formatRange(clamped)}`;
      if (visited.has(areaKey)) continue;
      visited.add(areaKey);
      if (rectCellCount(clamped) > MAX_PRECEDENT_RECURSE_CELLS) {
        skippedLargeAreas++;
        continue;
      }

      scannedSheets.add(area.sheetName);
      const data = await readRange(ds, area.sheetName, formatRange(clamped));
      for (let r = 0; r < data.rowCount; r++) {
        for (let c = 0; c < data.columnCount; c++) {
          const formula = data.formulas[r]?.[c] ?? "";
          if (!formula) continue;
          scannedFormulaCells++;
          let ext = extractCache.get(formula);
          if (!ext) {
            ext = extractFormulaRefs(formula);
            extractCache.set(formula, ext);
          }
          if (ext.dynamic.length > 0) dynamicCount++;
          const outcome = resolveExtracted(ext, {
            hostSheet: area.sheetName,
            sheetNames: index.sheetNames,
            nameIndex: index.nameIndex,
          });
          addUnresolved(unresolved, outcome.unresolved);
          for (const ref of outcome.resolved) {
            const key = `${ref.sheetName}|${formatRange(ref.range)}|${ref.viaName ?? ""}`;
            const existing = found.get(key);
            if (existing) existing.referencedBy++;
            else found.set(key, { ref, referencedBy: 1 });
          }
        }
      }
    }

    const nextFrontier: { sheetName: string; rect: RangeRef }[] = [];
    for (const { ref, referencedBy } of found.values()) {
      if (entries.length >= MAX_ENTRIES) {
        truncated = true;
        break;
      }
      entries.push({
        location: displayLocation(ref, index),
        cellCount: displayCellCount(ref, index),
        depth: d,
        via: ref.text,
        viaName: ref.viaName,
        referencedBy,
      });
      nextFrontier.push({ sheetName: ref.sheetName, rect: ref.range });
    }
    frontier = nextFrontier;
  }

  const warnings: string[] = [];
  if (dynamicCount > 0) {
    warnings.push(
      `${dynamicCount} formula(s) use INDIRECT/OFFSET — dynamic references cannot be traced from text.`
    );
  }
  if (skippedLargeAreas > 0) {
    warnings.push(
      `${skippedLargeAreas} referenced area(s) exceeded ${MAX_PRECEDENT_RECURSE_CELLS} cells and were not expanded.`
    );
  }

  return {
    target: `${targetSheet}!${formatRange(targetRect)}`,
    direction: "precedents",
    depth,
    entries,
    unresolved: [...unresolved.values()],
    warnings,
    truncated,
    scannedSheets: [...scannedSheets],
    scannedFormulaCells,
  };
}

/** Whole-column/row refs display clamped to the used range ("Data!B1:B204", not a million rows). */
function displayLocation(ref: ResolvedRef, index: WorkbookIndex): string {
  if (ref.kind === "col" || ref.kind === "row") {
    const dims = index.dims.get(ref.sheetName) ?? { rows: 0, cols: 0 };
    const clamped = clampToUsed(ref.range, dims);
    if (clamped) return `${ref.sheetName}!${formatRange(clamped)}`;
    return `${ref.sheetName}!${ref.text}`;
  }
  return `${ref.sheetName}!${formatRange(ref.range)}`;
}

function displayCellCount(ref: ResolvedRef, index: WorkbookIndex): number {
  if (ref.kind === "col" || ref.kind === "row") {
    const dims = index.dims.get(ref.sheetName) ?? { rows: 0, cols: 0 };
    const clamped = clampToUsed(ref.range, dims);
    return clamped ? rectCellCount(clamped) : 0;
  }
  return rectCellCount(ref.range);
}

/* -------------------------------- Dependents ------------------------------- */

interface ScannedFormulaCell {
  row: number;
  col: number;
  formula: string;
}

/**
 * Which formulas read `target`? Scans every formula in scope once, resolves
 * references with per-unique-formula caching, and reports cells whose
 * references (direct, containing range, or named range) intersect the
 * target. Depth ≥ 2 re-matches against the already-built scan — no re-reads.
 */
export async function traceDependents(
  ds: ExcelDataSource,
  target: TraceTarget,
  opts: TraceOptions = {}
): Promise<DependencyTraceResult> {
  const depth = clampDepth(opts.depth);
  const index = await buildWorkbookIndex(ds);
  const targetSheet = canonicalSheet(index, target.sheetName);
  const targetRect = parseRange(target.address);

  let scanSheets = index.sheets.filter((s) => s.rowCount > 0 && s.columnCount > 0);
  if (opts.scopeSheets && opts.scopeSheets.length > 0) {
    const wanted = new Set(opts.scopeSheets.map((s) => s.toLowerCase()));
    scanSheets = scanSheets.filter((s) => wanted.has(s.name.toLowerCase()));
  }

  const unresolved = new Map<string, UnresolvedRef>();
  const extractCache = new Map<string, ExtractedRefs>();
  // hostSheet ⇒ formula text ⇒ resolved refs (resolution depends on the host
  // sheet only through unqualified refs).
  const resolveCache = new Map<string, Map<string, ResolvedRef[]>>();
  const formulasBySheet = new Map<string, ScannedFormulaCell[]>();
  let scannedFormulaCells = 0;
  let unresolvedFormulaCount = 0;
  let dynamicCount = 0;

  for (const sheet of scanSheets) {
    // Scan the used range where it is; the A1-anchored rectangle this used to
    // build skipped the last column and row of any table not starting at A1.
    const usedRangeAddress =
      sheet.usedRange ??
      formatRange({
        topLeft: { col: 0, row: 0 },
        bottomRight: { col: sheet.columnCount - 1, row: sheet.rowCount - 1 },
      });
    const origin = parseRange(usedRangeAddress).topLeft;
    const data = await readRange(ds, sheet.name, usedRangeAddress);
    const cells: ScannedFormulaCell[] = [];
    const sheetResolveCache = new Map<string, ResolvedRef[]>();
    resolveCache.set(sheet.name, sheetResolveCache);

    for (let r = 0; r < data.rowCount; r++) {
      for (let c = 0; c < data.columnCount; c++) {
        const formula = data.formulas[r]?.[c] ?? "";
        if (!formula) continue;
        scannedFormulaCells++;
        cells.push({ row: origin.row + r, col: origin.col + c, formula });
        if (!sheetResolveCache.has(formula)) {
          let ext = extractCache.get(formula);
          if (!ext) {
            ext = extractFormulaRefs(formula);
            extractCache.set(formula, ext);
          }
          if (ext.dynamic.length > 0) dynamicCount++;
          if (ext.structured.length > 0 || ext.refs.some((t) => t.external)) {
            unresolvedFormulaCount++;
          }
          const outcome = resolveExtracted(ext, {
            hostSheet: sheet.name,
            sheetNames: index.sheetNames,
            nameIndex: index.nameIndex,
          });
          addUnresolved(unresolved, outcome.unresolved);
          sheetResolveCache.set(formula, outcome.resolved);
        }
      }
    }
    formulasBySheet.set(sheet.name, cells);
  }

  const entries: DependencyEntry[] = [];
  let truncated = false;
  // Cells already reported at a shallower depth — never re-reported.
  const reported = new Set<string>();
  const cellKey = (sheet: string, row: number, col: number) => `${sheet}|${row}|${col}`;

  // Depth 1 matches against the target rect; depth d ≥ 2 against the exact
  // set of cells matched at depth d-1.
  let matchRef: (ref: ResolvedRef) => boolean = (ref) =>
    ref.sheetName === targetSheet && rectsIntersect(ref.range, targetRect);

  for (let d = 1; d <= depth && !truncated; d++) {
    const matchedBySheet = new Map<string, { cell: ScannedFormulaCell; via: ResolvedRef }[]>();
    let matchedCount = 0;

    for (const [sheetName, cells] of formulasBySheet) {
      const sheetResolveCache = resolveCache.get(sheetName);
      if (!sheetResolveCache) continue;
      for (const cell of cells) {
        if (reported.has(cellKey(sheetName, cell.row, cell.col))) continue;
        const refs = sheetResolveCache.get(cell.formula) ?? [];
        const via = refs.find(matchRef);
        if (!via) continue;
        let list = matchedBySheet.get(sheetName);
        if (!list) {
          list = [];
          matchedBySheet.set(sheetName, list);
        }
        list.push({ cell, via });
        matchedCount++;
      }
    }

    if (matchedCount === 0) break;

    // Group matched cells into normalized-formula clusters (same compression
    // the sheet outline uses) so a filled-down dependent column reads as one
    // entry, not hundreds.
    for (const [sheetName, matches] of matchedBySheet) {
      const clusters = new Map<
        string,
        {
          minRow: number;
          maxRow: number;
          minCol: number;
          maxCol: number;
          count: number;
          example: ScannedFormulaCell;
          via: ResolvedRef;
        }
      >();
      for (const { cell, via } of matches) {
        reported.add(cellKey(sheetName, cell.row, cell.col));
        const pattern = normalizeFormula(cell.formula, { col: cell.col, row: cell.row });
        const cluster = clusters.get(pattern);
        if (!cluster) {
          clusters.set(pattern, {
            minRow: cell.row,
            maxRow: cell.row,
            minCol: cell.col,
            maxCol: cell.col,
            count: 1,
            example: cell,
            via,
          });
        } else {
          cluster.minRow = Math.min(cluster.minRow, cell.row);
          cluster.maxRow = Math.max(cluster.maxRow, cell.row);
          cluster.minCol = Math.min(cluster.minCol, cell.col);
          cluster.maxCol = Math.max(cluster.maxCol, cell.col);
          cluster.count++;
        }
      }
      for (const cluster of clusters.values()) {
        if (entries.length >= MAX_ENTRIES) {
          truncated = true;
          break;
        }
        const rect: RangeRef = {
          topLeft: { col: cluster.minCol, row: cluster.minRow },
          bottomRight: { col: cluster.maxCol, row: cluster.maxRow },
        };
        entries.push({
          location: `${sheetName}!${formatRange(rect)}`,
          cellCount: cluster.count,
          depth: d,
          via: cluster.via.text,
          viaName: cluster.via.viaName,
          exampleFormula: cluster.example.formula,
          exampleAddress: `${sheetName}!${formatA1({
            col: cluster.example.col,
            row: cluster.example.row,
          })}`,
        });
      }
    }

    if (d === depth) break;

    // Build the next-depth target: the exact cells matched at this depth.
    if (matchedCount > MAX_TRANSITIVE_TARGET_CELLS) {
      truncated = true;
      break;
    }
    const nextTargets = new Map<string, { cells: Set<number>; bbox: RangeRef }>();
    for (const [sheetName, matches] of matchedBySheet) {
      const cells = new Set<number>();
      let bbox: RangeRef | null = null;
      for (const { cell } of matches) {
        cells.add(cell.row * (EXCEL_MAX_COL + 1) + cell.col);
        if (!bbox) {
          bbox = {
            topLeft: { col: cell.col, row: cell.row },
            bottomRight: { col: cell.col, row: cell.row },
          };
        } else {
          bbox.topLeft.col = Math.min(bbox.topLeft.col, cell.col);
          bbox.topLeft.row = Math.min(bbox.topLeft.row, cell.row);
          bbox.bottomRight.col = Math.max(bbox.bottomRight.col, cell.col);
          bbox.bottomRight.row = Math.max(bbox.bottomRight.row, cell.row);
        }
      }
      if (bbox) nextTargets.set(sheetName, { cells, bbox });
    }
    matchRef = (ref) => {
      const t = nextTargets.get(ref.sheetName);
      if (!t || !rectsIntersect(ref.range, t.bbox)) return false;
      for (const packed of t.cells) {
        const row = Math.floor(packed / (EXCEL_MAX_COL + 1));
        const col = packed % (EXCEL_MAX_COL + 1);
        if (
          row >= ref.range.topLeft.row &&
          row <= ref.range.bottomRight.row &&
          col >= ref.range.topLeft.col &&
          col <= ref.range.bottomRight.col
        ) {
          return true;
        }
      }
      return false;
    };
  }

  const warnings: string[] = [];
  if (dynamicCount > 0) {
    warnings.push(
      `${dynamicCount} formula(s) use INDIRECT/OFFSET — dependents through dynamic references are not detected.`
    );
  }
  if (unresolvedFormulaCount > 0) {
    warnings.push(
      `${unresolvedFormulaCount} formula(s) contain structured or external references that could not be resolved — dependents through them are not detected.`
    );
  }

  return {
    target: `${targetSheet}!${formatRange(targetRect)}`,
    direction: "dependents",
    depth,
    entries,
    unresolved: [...unresolved.values()],
    warnings,
    truncated,
    scannedSheets: scanSheets.map((s) => s.name),
    scannedFormulaCells,
  };
}

/* --------------------------------- Render ---------------------------------- */

/**
 * Render a trace result as compact text for the model (same philosophy as
 * renderSheetOutline — structured enough to act on, cheap enough to keep).
 */
export function renderDependencyTrace(result: DependencyTraceResult): string {
  const lines: string[] = [];
  const gloss =
    result.direction === "precedents"
      ? `what ${result.target} reads`
      : `what reads ${result.target}`;
  lines.push(`# ${capitalize(result.direction)} of ${result.target} (${gloss})`);

  if (result.entries.length === 0) {
    lines.push(
      result.direction === "precedents"
        ? "No precedents — the target contains no formulas (or only references that could not be resolved)."
        : "No dependents found — no formula in the scanned sheets reads the target."
    );
  }

  let currentDepth = 0;
  for (const e of result.entries) {
    if (e.depth !== currentDepth) {
      currentDepth = e.depth;
      lines.push("");
      lines.push(currentDepth === 1 ? "Direct (depth 1):" : `Depth ${currentDepth}:`);
    }
    const parts: string[] = [`- ${e.location}`];
    if (e.cellCount > 1) parts.push(`(${e.cellCount} cells)`);
    if (e.exampleFormula && e.exampleAddress) {
      parts.push(`example ${e.exampleAddress}: \`${e.exampleFormula}\``);
    }
    if (e.viaName) parts.push(`— via name "${e.viaName}"`);
    else if (e.via && e.via !== e.location) parts.push(`— via ${e.via}`);
    if (e.referencedBy && e.referencedBy > 1) {
      parts.push(`(referenced by ${e.referencedBy} cells in the traced area)`);
    }
    lines.push(parts.join(" "));
  }

  lines.push("");
  lines.push(
    `Scanned ${result.scannedSheets.length} sheet(s), ${result.scannedFormulaCells} formula cell(s).`
  );
  if (result.truncated) {
    lines.push(`Output truncated — showing the first ${result.entries.length} entries.`);
  }
  for (const w of result.warnings) lines.push(`Warning: ${w}`);
  if (result.unresolved.length > 0) {
    const shown = result.unresolved
      .map((u) => `${u.text} (${u.reason.replace("-", " ")})`)
      .join(", ");
    lines.push(`Unresolved references: ${shown}`);
  }

  return lines.join("\n");
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
