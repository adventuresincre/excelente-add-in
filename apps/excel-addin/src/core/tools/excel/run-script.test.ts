import { describe, expect, it, vi } from "vitest";
import { inMemoryDataSource } from "../../context";
import { createUndoStack } from "../undo";
import { runExcelScriptTool } from "./run-script";

describe("run_excel_script", () => {
  it("requires Write permission (approval-gated, code visible on the card)", () => {
    expect(runExcelScriptTool.requiredPermission).toBe("Write");
  });

  it("schema requires description AND code", () => {
    const schema = runExcelScriptTool.inputSchema as { required: string[] };
    expect(schema.required.sort()).toEqual(["code", "description"]);
  });

  it("returns ok: false when ds.runScript is not provided (test contexts)", async () => {
    const ds = inMemoryDataSource({ sheets: [{ name: "Sheet1" }] });
    const result = await runExcelScriptTool.execute(
      { description: "test", code: "return 1;" },
      { ds, undoStack: createUndoStack() }
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not supported/);
  });

  it("delegates to ds.runScript and surfaces the result on success", async () => {
    const ds = inMemoryDataSource({ sheets: [{ name: "Sheet1" }] });
    // Attach a stub runScript to the in-memory ds for this test.
    const dsWithRunner = ds as typeof ds & {
      runScript?: (code: string) => Promise<unknown>;
    };
    const runScript = vi.fn().mockResolvedValue({ output: { rows: 5 }, swallowedErrors: [] });
    dsWithRunner.runScript = runScript;

    const result = await runExcelScriptTool.execute(
      { description: "Insert 5 rows", code: "/* code */" },
      { ds, undoStack: createUndoStack() }
    );

    expect(runScript).toHaveBeenCalledWith("/* code */");
    expect(result).toEqual({ ok: true, output: { rows: 5 } });
  });

  // Regression guard for the 2026-09-04 rent-roll incident: a script that
  // returned nothing serialized to exactly `{"ok":true}` — indistinguishable
  // from one that silently discarded every write.
  it("never lets a no-value script serialize to a bare {ok:true}", async () => {
    const ds = inMemoryDataSource({ sheets: [{ name: "Sheet1" }] });
    const dsWithRunner = ds as typeof ds & {
      runScript?: (code: string) => Promise<unknown>;
    };
    dsWithRunner.runScript = async () => ({ output: undefined, swallowedErrors: [] });

    const result = (await runExcelScriptTool.execute(
      { description: "add a sheet", code: "ctx.workbook.worksheets.add('X');" },
      { ds, undoStack: createUndoStack() }
    )) as { ok: boolean; output: unknown; warning?: string };

    expect(result.ok).toBe(true);
    expect(result.output).toBeNull();
    expect(result.warning).toMatch(/NOT that the workbook changed/);
    // The wire form the model actually sees must carry more than ok.
    expect(JSON.stringify(result)).not.toBe('{"ok":true}');
    expect(JSON.parse(JSON.stringify(result))).toHaveProperty("output", null);
  });

  it("fails the call when errors escaped as unhandled rejections", async () => {
    const ds = inMemoryDataSource({ sheets: [{ name: "Sheet1" }] });
    const dsWithRunner = ds as typeof ds & {
      runScript?: (code: string) => Promise<unknown>;
    };
    dsWithRunner.runScript = async () => ({
      output: undefined,
      swallowedErrors: ["InvalidRequestContext: the context has been released"],
    });

    const result = (await runExcelScriptTool.execute(
      { description: "bulk write", code: "rows.forEach(async r => { await ctx.sync(); });" },
      { ds, undoStack: createUndoStack() }
    )) as { ok: boolean; error?: string };

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/unhandled promise rejections/);
    expect(result.error).toMatch(/InvalidRequestContext/);
    expect(result.error).toMatch(/were discarded/);
  });

  it("returns ok: false with the JS error message on failure", async () => {
    const ds = inMemoryDataSource({ sheets: [{ name: "Sheet1" }] });
    const dsWithRunner = ds as typeof ds & {
      runScript?: (code: string) => Promise<unknown>;
    };
    dsWithRunner.runScript = async () => {
      throw new Error("ReferenceError: foo is not defined");
    };

    const result = await runExcelScriptTool.execute(
      { description: "broken", code: "foo()" },
      { ds, undoStack: createUndoStack() }
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/foo is not defined/);
  });
});
