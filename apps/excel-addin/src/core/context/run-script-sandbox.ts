/**
 * Sandbox construction for `run_excel_script`. Extracted as a pure helper so
 * the behavior is unit-testable without an Office.js host.
 *
 * SECURITY MODEL — stated precisely, because an earlier version of this
 * comment claimed a CSP backstop that does not and cannot exist:
 *
 * Layer 1, shadowing. `new Function` only controls its named parameters; the
 * body otherwise resolves free identifiers against the global scope. The
 * escalation-vector globals (network, storage, host credentials, DOM) are
 * passed as parameters bound to `undefined`, so referencing them directly
 * yields `undefined` rather than the real global. Ordinary JS built-ins
 * (Object, Array, JSON, Math, Promise, Date, console, …) are deliberately
 * NOT shadowed — legitimate Office.js needs them.
 *
 * Shadowing alone is NOT a security boundary. Parameter binding cannot
 * cover the Function-constructor chain, and all of these reach the real
 * global scope (each verified against this implementation):
 *
 *     Function("return fetch")()
 *     ({}).constructor.constructor("return fetch")()
 *     Object.constructor("return fetch")()
 *
 * Layer 2, static refusal. `findSandboxEscapes` rejects code containing
 * those patterns before it is ever compiled. This is a denylist, so it is
 * evadable by construction (`["cons"+"tructor"]` and friends) — its purpose
 * is not to be airtight. It closes every accidental path, and it forces any
 * deliberate escape into obfuscated form, which is exactly the shape a human
 * notices in the approval card.
 *
 * Layer 3, and the one that actually bounds the damage: the per-script
 * APPROVAL GATE. The user sees the verbatim code before it runs. This is the
 * real control; layers 1 and 2 exist to make anything malicious look
 * malicious. Note the corollary — "approve all" removes this layer, which is
 * why it is a per-session choice the user makes explicitly and why it can no
 * longer be set from inside a workbook file.
 *
 * What CSP does and does not do here: `script-src` must retain
 * `'unsafe-eval'` because this tool depends on `new Function`, so CSP can
 * never close the Function-constructor escape. It does block remote module
 * loading (`import("https://…")`), which is a separate escape vector, and
 * that is why the shipped policy still matters. It does not meaningfully
 * constrain exfiltration destinations, because the product deliberately lets
 * users point MCP connectors at arbitrary https hosts.
 */

export const SCRIPT_BLOCKED_GLOBALS = [
  // Network
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "navigator",
  "sendBeacon",
  // Dynamic code construction. `Function` was missing from this list, which
  // left the shortest escape of all — `Function("return fetch")()` — working
  // by direct reference.
  //
  // NOTE: `eval` is intentionally absent — the language forbids using it as
  // a parameter name in strict mode (SyntaxError). Direct `eval` and the
  // `constructor.constructor` chain are handled by `findSandboxEscapes`
  // below, NOT by CSP: `script-src` must keep `'unsafe-eval'` for this tool
  // to work at all, so CSP cannot close them.
  "Function",
  // Workers / remote code loading.
  "Worker",
  "SharedWorker",
  "importScripts",
  "WebAssembly",
  // Persistence / browser storage
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "caches",
  // Host credentials + settings (API key lives in OfficeRuntime.storage)
  "OfficeRuntime",
  "Office",
  // Window / DOM / navigation
  "window",
  "self",
  "globalThis",
  "top",
  "parent",
  "frames",
  "frameElement",
  "document",
  "location",
  "history",
] as const;

/**
 * Patterns that reach the real global scope regardless of parameter
 * shadowing, or that load remote code. None of them appear in legitimate
 * generated Office.js — the API surface for workbook work is `ctx` and
 * `Excel`, neither of which needs dynamic code construction.
 */
const ESCAPE_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  {
    // `({}).constructor.constructor`, `[].constructor.constructor`, and any
    // other `.constructor.constructor` chain to the Function constructor.
    pattern: /\.\s*constructor\s*(\[\s*["']constructor["']\s*\]|\.\s*constructor)/,
    reason: "reaches the Function constructor via a .constructor chain",
  },
  {
    // `Object.constructor(...)`, `Array.constructor(...)` — the same escape
    // one link shorter, since a built-in's .constructor IS Function.
    pattern: /\b(Object|Array|String|Number|Boolean|Promise|RegExp)\s*\.\s*constructor\s*\(/,
    reason: "calls a built-in's .constructor, which is the Function constructor",
  },
  {
    pattern: /\bnew\s+Function\s*\(/,
    reason: "constructs a function from a string",
  },
  {
    // Bare `Function("…")`. `Function` is shadowed to undefined, so this
    // would throw anyway — refusing gives a better message than "undefined
    // is not a function".
    pattern: /\bFunction\s*\(/,
    reason: "constructs a function from a string",
  },
  {
    pattern: /\beval\s*\(/,
    reason: "evaluates code from a string",
  },
  {
    // Dynamic import of remote code. `import(` is syntax, not an
    // identifier, so shadowing can never cover it.
    pattern: /\bimport\s*\(/,
    reason: "loads code from another module at runtime",
  },
  {
    pattern: /\bimportScripts\s*\(/,
    reason: "loads code from another script at runtime",
  },
];

/**
 * Scan a script body for known sandbox escapes. Returns the reasons a script
 * was refused; empty means nothing matched.
 *
 * Deliberately a denylist, and deliberately not airtight — see the security
 * model at the top of this file. It exists to stop accidental escapes
 * outright and to force deliberate ones into obfuscated form that stands out
 * during approval. Do not treat a passing scan as proof a script is safe.
 */
export function findSandboxEscapes(code: string): string[] {
  const found: string[] = [];
  for (const { pattern, reason } of ESCAPE_PATTERNS) {
    if (pattern.test(code) && !found.includes(reason)) found.push(reason);
  }
  return found;
}

/**
 * Build the sandboxed async function for a run_excel_script body. The
 * returned function takes `(ctx, Excel)` and runs `code` with the blocked
 * globals shadowed to `undefined`. The caller invokes it inside `Excel.run`.
 *
 * Throws before compiling anything when the body contains a known escape,
 * so refused code never executes.
 */
export function buildScriptFunction(
  code: string
): (ctx: unknown, excel: unknown) => Promise<unknown> {
  const escapes = findSandboxEscapes(code);
  if (escapes.length > 0) {
    throw new Error(
      `Refusing to run this script: it ${escapes.join("; it ")}. ` +
        `run_excel_script is for workbook operations through \`ctx\` and \`Excel\` — ` +
        `it cannot construct code at runtime or load code from elsewhere. ` +
        `Rewrite the script using the Office.js API directly.`
    );
  }

  // Correctness guard, not a security one — see findUnawaitedAsyncCalls.
  // A dropped promise here means the request context is released mid-flight
  // and the workbook silently does not change, while the tool reports
  // success. Refuse instead, with the exact rewrite spelled out.
  const unawaited = findUnawaitedAsyncCalls(code);
  if (unawaited.length > 0) {
    const list = unawaited.map((n) => `${n}()`).join(", ");
    const first = unawaited[0];
    throw new Error(
      `Refusing to run this script: ${list} ${unawaited.length === 1 ? "is" : "are"} called ` +
        `but never awaited. Your code already runs inside an async function, so \`Excel.run\` ` +
        `resolves and RELEASES the request context the moment it reaches the bare call — ` +
        `every queued operation is discarded, the workbook does not change, and any error ` +
        `inside is lost. This reports as success, so you would not find out.\n\n` +
        `Fix it one of two ways:\n` +
        `  • write the body at the top level and \`await\` directly (preferred), or\n` +
        `  • \`return ${first}();\` so the promise is awaited and its value becomes the ` +
        `tool's \`output\`.`
    );
  }

  const blocked = [...SCRIPT_BLOCKED_GLOBALS];

  const fn = new Function(
    "ctx",
    "Excel",
    ...blocked,
    `"use strict"; return (async () => { ${code} })();`
  ) as (...args: unknown[]) => Promise<unknown>;
  return (ctx, excel) => fn(ctx, excel, ...blocked.map(() => undefined));
}

/* ---------------------- unawaited-async detection (lint) ------------------- */

/**
 * Blank out comments and string/template-literal CONTENT, preserving byte
 * offsets and line structure. Token scanning below must not trip over an
 * Excel formula that happens to contain `main(` inside a quoted string —
 * formula-heavy scripts are full of `"=IF(SUM(A1:A9)>0,...)"`.
 */
function blankNonCode(code: string): string {
  const out = code.split("");
  let i = 0;
  const n = code.length;
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== "\n") out[k] = " ";
  };
  while (i < n) {
    const c = code[i];
    const next = code[i + 1];
    if (c === "/" && next === "/") {
      const end = code.indexOf("\n", i);
      blank(i, end < 0 ? n : end);
      i = end < 0 ? n : end;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = code.indexOf("*/", i + 2);
      blank(i, end < 0 ? n : end + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < n) {
        if (code[j] === "\\") {
          j += 2;
          continue;
        }
        if (code[j] === c) break;
        j++;
      }
      blank(i + 1, j);
      i = j + 1;
      continue;
    }
    i++;
  }
  return out.join("");
}

/** Names of async functions declared anywhere in `code`. */
function declaredAsyncFunctionNames(code: string): string[] {
  const names = new Set<string>();
  // async function NAME(...)
  for (const m of code.matchAll(/\basync\s+function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g)) {
    names.add(m[1]);
  }
  // const/let/var NAME = async function(...) | async (...) => | async arg =>
  for (const m of code.matchAll(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*async\s*(?:function\b|\(|[A-Za-z_$][\w$]*\s*=>)/g
  )) {
    names.add(m[1]);
  }
  return [...names];
}

/**
 * Tokens that CONSUME the value of a call expression. If the character run
 * immediately before `name(` ends with one of these, the promise is being
 * awaited, returned, assigned, or composed into a larger expression — all
 * fine. Anything else means the call sits in statement position and its
 * promise is dropped on the floor.
 */
const CONSUMING_TOKENS = new Set([
  "await",
  "return",
  "yield",
  "typeof",
  "of",
  "in",
  "new",
  "throw",
  "case",
  "do",
  "else",
]);
const CONSUMING_PUNCT = /[=(,[:?+\-*/%&|!<>{]$/;

/**
 * Find calls to locally-declared async functions whose promise is never
 * awaited or returned.
 *
 * This is THE failure mode that produced a silent-data-loss incident
 * (2026-09-04, rent-roll parse). `run_excel_script` wraps the body in
 * `(async () => { … })()`. A body shaped like
 *
 *     async function main() { …queue writes…; await ctx.sync(); }
 *     main();
 *
 * returns the instant it reaches the bare `main()`, so `Excel.run` resolves
 * and RELEASES the request context while `main` is still suspended at its
 * first await. Every queued operation is discarded, the rejection becomes an
 * unhandled promise, and the tool reports `{ ok: true }`. From the model's
 * side the script "succeeded" and the workbook silently did not change — it
 * burned an entire run on forensics and never got its sheet.
 *
 * Refusing before execution is the only guard that is deterministic: a final
 * `ctx.sync()` cannot help, because the orphaned continuation queues its work
 * on a LATER microtask than any sync we could issue.
 */
export function findUnawaitedAsyncCalls(code: string): string[] {
  const src = blankNonCode(code);
  const declared = declaredAsyncFunctionNames(src);
  if (declared.length === 0) return [];

  const flagged = new Set<string>();
  for (const name of declared) {
    const callRe = new RegExp(`\\b${name}\\s*\\(`, "g");
    for (const m of src.matchAll(callRe)) {
      const before = src.slice(0, m.index).replace(/\s+$/, "");
      // `function name(` / `async function name(` — the declaration, not a call.
      if (/\bfunction\s*\*?$/.test(before)) continue;
      // Method or property call (`obj.name(`) — a different binding.
      if (/\.$/.test(before)) continue;
      if (CONSUMING_PUNCT.test(before)) continue;
      const lastToken = before.match(/[\w$]+$/)?.[0];
      if (lastToken && CONSUMING_TOKENS.has(lastToken)) continue;
      flagged.add(name);
    }
  }
  return [...flagged];
}
