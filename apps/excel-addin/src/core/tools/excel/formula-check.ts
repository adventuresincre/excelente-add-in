import { formatA1, type CellRef } from "../../context";

/**
 * Client-side checks on a grid before it reaches Excel.
 *
 * Excel's own answer to a bad formula is one sentence for the whole batch —
 * "The argument is invalid or missing or has an incorrect format." — with no
 * cell, no formula and no hint. A model handed that line retries the same
 * call, patches neighbouring cells, or gives up on write_range for
 * run_excel_script; on 2026-09-10 a flash-tier model spent ~40 single-cell
 * writes chasing two malformed totals. Everything here exists to name the cell and
 * the reason before Excel is even asked.
 */

export interface CellProblem {
  /** Sheet-local A1 address of the offending cell. */
  address: string;
  /** The cell content exactly as sent. */
  content: string;
  /** Short reason, ready to be read by the model. */
  problem: string;
}

/**
 * Placeholders that privacy filters sitting between the pane and the model
 * substitute for text they classify as personal data. The known source is
 * OpenRouter's Sensitive Info guardrail (Person Name / Address presets,
 * NLP-based): it rewrites the *request*, which includes the model's own
 * earlier tool calls and every tool result, so a SUM over a column range
 * reaches the model as `=[PERSON_NAME]:C7)` and a square-footage figure as
 * `121,800 [ADDRESS]`. A model that copies from its context then writes the
 * placeholder into the workbook, and Excel rejects the batch.
 *
 * Verified 2026-09-10: identical rewriting across 20 providers and 3 model
 * families, prompt side only — fresh generations are clean. The guard below
 * is defence in depth for when the filter is on; the real fix is turning the
 * two NLP presets off in the OpenRouter workspace.
 *
 * The leading group keeps structured references (`Table1[NAME]`) and external
 * references (`[Book.xlsx]Sheet1!A1`) out of the match: a placeholder stands
 * alone, never glued to an identifier.
 */
const REDACTION_PLACEHOLDER =
  /(^|[^A-Za-z0-9_\].])\[(PERSON_NAME|NAME|ADDRESS|EMAIL|PHONE|SSN|CREDIT_CARD|IP_ADDRESS|REDACTED|SECRET:[^\]]+)(_\d+)?\]/;

/** What the model needs to know when a placeholder shows up in its own output. */
export const PLACEHOLDER_EXPLANATION =
  "that token was not written by you: a privacy filter between Excelente and the model " +
  "rewrites the request, so formulas, labels and figures from earlier in this conversation " +
  "can reach you with pieces replaced by placeholders such as [PERSON_NAME] or [ADDRESS]. " +
  "Never copy cell text from earlier in the conversation — rebuild it from the sheet's " +
  "structure (read the block with inspect_workbook if unsure).";

/** The first redaction placeholder in `text`, or null. */
export function redactionPlaceholderIn(text: string): string | null {
  const m = REDACTION_PLACEHOLDER.exec(text);
  return m ? `[${m[2]}${m[3] ?? ""}]` : null;
}

/**
 * Unbalanced delimiters outside string literals — the commonest way a
 * formula is malformed, and the one Excel reports least helpfully.
 */
export function unbalancedDelimiter(formula: string): string | null {
  let parens = 0;
  let brackets = 0;
  let inString = false;
  for (let i = 0; i < formula.length; i++) {
    const ch = formula[i];
    if (ch === '"') {
      if (inString && formula[i + 1] === '"') {
        i++; // "" inside a string is an escaped quote
        continue;
      }
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "(") parens++;
    else if (ch === ")") {
      if (--parens < 0) return "a ')' with no matching '('";
    } else if (ch === "[") brackets++;
    else if (ch === "]") {
      if (--brackets < 0) return "a ']' with no matching '['";
    }
  }
  if (inString) return "an unclosed string literal (odd number of double quotes)";
  if (parens > 0) return `${parens} unclosed '('`;
  if (brackets > 0) return `${brackets} unclosed '['`;
  return null;
}

/**
 * Formulas that Excel is certain to reject, found before the write. Only
 * formulas are judged: a literal is whatever the user wants it to be, but a
 * formula carrying a redaction placeholder or an unclosed parenthesis is
 * never what anyone meant, and Excel would refuse the whole batch over it.
 */
export function findFormulaProblems(grid: string[][], topLeft: CellRef): CellProblem[] {
  const problems: CellProblem[] = [];
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      const cell = grid[r][c];
      if (typeof cell !== "string" || !cell.startsWith("=")) continue;
      const address = formatA1({ col: topLeft.col + c, row: topLeft.row + r });
      const placeholder = redactionPlaceholderIn(cell);
      if (placeholder) {
        problems.push({ address, content: cell, problem: `contains ${placeholder}` });
        continue;
      }
      const unbalanced = unbalancedDelimiter(cell);
      if (unbalanced) problems.push({ address, content: cell, problem: `has ${unbalanced}` });
    }
  }
  return problems;
}

/**
 * Literal (non-formula) cells carrying a redaction placeholder. These are
 * written — "[ADDRESS]" could be a template slot the user asked for — but
 * the write result notes them, because "Total [ADDRESS]" as a column header
 * is almost always "Total SF" that the model saw through the filter.
 */
export function findPlaceholderLiterals(grid: string[][], topLeft: CellRef): string[] {
  const hits: string[] = [];
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      const cell = grid[r][c];
      if (typeof cell !== "string" || cell.startsWith("=")) continue;
      if (redactionPlaceholderIn(cell)) {
        hits.push(formatA1({ col: topLeft.col + c, row: topLeft.row + r }));
      }
    }
  }
  return hits;
}
