import { columnLetterToIndex } from "./address";
import type { CellRef } from "./address";

/**
 * Normalize an Excel formula so that two formulas that "do the same thing"
 * but live in different cells produce the same string.
 *
 * Relative refs become offsets from the origin cell:
 *   B5 in B5  -> R+0C+0
 *   B2 in B5  -> R-3C+0
 *
 * Absolute refs ($A$1, A$1, $A1) keep their absolute parts:
 *   $A$1 anywhere -> $A$1
 *   A$5 in B7    -> C-1$5    (col is relative, row is absolute)
 *
 * String literals are passed through verbatim so refs inside INDIRECT("…")
 * or other quoted strings don't get rewritten.
 *
 * Sheet qualifiers (Sheet1!A1, 'My Sheet'!A1) are preserved as-is. The
 * address part of the qualified reference is still normalized.
 */
export function normalizeFormula(formula: string, origin: CellRef): string {
  let out = "";
  let i = 0;
  const n = formula.length;

  while (i < n) {
    const ch = formula[i];

    // String literals
    if (ch === '"') {
      out += ch;
      i++;
      while (i < n) {
        out += formula[i];
        if (formula[i] === '"' && formula[i + 1] === '"') {
          // Escaped double-quote inside a string
          i++;
          out += formula[i];
          i++;
          continue;
        }
        if (formula[i] === '"') {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    // Try to match a sheet-qualified ref or a bare ref starting here.
    const matched = matchRefAt(formula, i);
    if (matched) {
      out += matched.sheetPrefix + normalizeAddress(matched.left, origin);
      if (matched.right !== undefined) {
        out += ":" + normalizeAddress(matched.right, origin);
      }
      i += matched.length;
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

export interface RefMatch {
  sheetPrefix: string;
  left: string;
  right?: string;
  length: number;
}

// Sheet qualifier: optionally quoted ('My Sheet'!) followed by !
// Address: $?[A-Z]+$?\d+
// Optional ":" and second address for a range.
const SHEET_RE = /^(?:'([^']+)'|([A-Za-z_][\w.]*))!/;
const ADDR_RE = /^(\$?[A-Z]+\$?\d+)(?::(\$?[A-Z]+\$?\d+))?/;

/**
 * Match a cell or cell-range reference (optionally sheet-qualified) starting
 * at position `i`. Shared between `normalizeFormula` (which rewrites the
 * matched address) and `dependencies.ts` (which resolves it to coordinates).
 * Returns null when `i` doesn't start a reference — e.g. mid-identifier, or
 * a function name like `LOG10(`.
 */
export function matchRefAt(formula: string, i: number): RefMatch | null {
  // Don't start a reference match in the middle of an identifier
  // (e.g. "A1" inside "SUMA1B2" wouldn't make sense, but here we're more
  // worried about not matching "ABC123" when it's a function-like token).
  // The safest heuristic: a ref token must be preceded by a delimiter, not
  // by a letter/digit/underscore that would make it look like a continuation.
  if (i > 0) {
    const prev = formula[i - 1];
    if (/[A-Za-z0-9_.]/.test(prev)) return null;
  }

  const remainder = formula.slice(i);
  let sheetPrefix = "";
  let cursor = 0;

  const sheetMatch = SHEET_RE.exec(remainder);
  if (sheetMatch) {
    sheetPrefix = sheetMatch[0];
    cursor = sheetMatch[0].length;
  }

  const addrMatch = ADDR_RE.exec(remainder.slice(cursor));
  if (!addrMatch) return null;

  // The token after the address should not be a letter/digit/underscore;
  // otherwise we're inside something like "A1B" (not a real ref).
  const totalLen = cursor + addrMatch[0].length;
  const after = remainder[totalLen];
  if (after !== undefined && /[A-Za-z0-9_]/.test(after)) return null;
  // If the next char is '(' the token is a function name, not a reference
  // (e.g. SUMA1(B5) parses as the SUMA1 user-function, not the cell SUMA1).
  // Sheet-qualified refs are unambiguous so we keep them.
  if (after === "(" && sheetPrefix === "") return null;

  return {
    sheetPrefix,
    left: addrMatch[1],
    right: addrMatch[2],
    length: totalLen,
  };
}

function normalizeAddress(addr: string, origin: CellRef): string {
  const m = /^(\$?)([A-Z]+)(\$?)(\d+)$/.exec(addr);
  if (!m) return addr;
  const [, colAbs, colLetters, rowAbs, rowDigits] = m;

  const col = columnLetterToIndex(colLetters);
  const row = parseInt(rowDigits, 10) - 1;

  const colPart = colAbs === "$" ? `$${colLetters}` : `C${formatDelta(col - origin.col)}`;
  const rowPart = rowAbs === "$" ? `$${rowDigits}` : `R${formatDelta(row - origin.row)}`;

  return `${colPart}${rowPart}`;
}

function formatDelta(d: number): string {
  return d >= 0 ? `+${d}` : `${d}`;
}
