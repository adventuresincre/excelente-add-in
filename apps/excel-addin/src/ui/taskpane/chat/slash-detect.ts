/**
 * The slash-menu activates when the user is typing a `/word` token at the
 * start of the input or after whitespace, with the caret inside or right
 * after that token. This module is the pure-logic side of that detection
 * so it can be unit-tested without a DOM.
 */
export interface SlashToken {
  /** Offset of the `/` in the input string. */
  start: number;
  /** Offset of the first character past the token (exclusive). */
  end: number;
  /** The query — characters between `/` and `end`. */
  query: string;
}

/**
 * Return the slash token under the caret, or `null` if none.
 *
 * Rules:
 * - The token starts with `/` at offset 0 or immediately after a whitespace
 *   character.
 * - The query continues until the next whitespace or end-of-string.
 * - Only allow `[a-zA-Z0-9_-]` in the query so accidental URLs (e.g. "https://")
 *   and paths don't fire the menu.
 * - The caret must be at or after `start + 1` (after the `/`) and at or before `end`.
 */
export function detectSlashToken(text: string, caret: number): SlashToken | null {
  if (caret < 1 || caret > text.length) return null;

  // Walk left from `caret - 1` to find the start of the current "word".
  let i = caret - 1;
  while (i > 0 && !isSpace(text.charCodeAt(i - 1))) i--;

  // Must be at a `/` to count.
  if (text.charCodeAt(i) !== 47 /* '/' */) return null;

  // The query starts at i + 1 and runs until the next whitespace or
  // disallowed char. Disallowed chars (anything not in the query alphabet)
  // also end the token; the menu vanishes once you type a slash + a space
  // or a `/`-then-letter that turns into a URL etc.
  let j = i + 1;
  while (j < text.length) {
    const c = text.charCodeAt(j);
    if (!isQueryChar(c)) break;
    j++;
  }

  // The caret must be within the token (inclusive of end so cursor at the
  // tail still keeps the menu open).
  if (caret < i + 1 || caret > j) return null;

  return {
    start: i,
    end: j,
    query: text.slice(i + 1, j),
  };
}

/**
 * Replace a slash token with a chosen replacement, returning the new text
 * and the caret position. By default we delete the token entirely AND eat
 * a trailing space so e.g. "hi /und ah" becomes "hi ah" rather than "hi  ah".
 */
export function replaceSlashToken(
  text: string,
  token: SlashToken,
  replacement = ""
): { text: string; caret: number } {
  let end = token.end;
  // Eat one trailing space if we're collapsing to empty so we don't leave a
  // dangling double-space behind.
  if (replacement === "" && end < text.length && text.charCodeAt(end) === 32) {
    end += 1;
  }
  const next = text.slice(0, token.start) + replacement + text.slice(end);
  const caret = token.start + replacement.length;
  return { text: next, caret };
}

function isSpace(code: number): boolean {
  // Space, tab, newline, carriage return.
  return code === 32 || code === 9 || code === 10 || code === 13;
}

function isQueryChar(code: number): boolean {
  // a-z A-Z 0-9 _ -
  return (
    (code >= 97 && code <= 122) ||
    (code >= 65 && code <= 90) ||
    (code >= 48 && code <= 57) ||
    code === 95 ||
    code === 45
  );
}
