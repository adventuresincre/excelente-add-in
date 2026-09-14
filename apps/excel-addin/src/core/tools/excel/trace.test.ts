import { describe, expect, it } from "vitest";
import { inMemoryDataSource } from "../../context";
import { createUndoStack } from "../undo";
import { readTools } from "./read";
import { traceDependenciesTool } from "./trace";

const ctx = (ds: ReturnType<typeof inMemoryDataSource>) => ({
  ds,
  undoStack: createUndoStack(),
});

const makeDs = () =>
  inMemoryDataSource({
    sheets: [
      {
        name: "Model",
        cells: {
          B2: { value: 100 },
          D2: { value: 200, formula: "=B2*2" },
        },
      },
      {
        name: "Summary",
        cells: {
          B1: { value: 2400, formula: "=Model!D2*12" },
        },
      },
    ],
  });

describe("trace_dependencies tool", () => {
  it("is a Read tool and ships in the readTools bundle", () => {
    expect(traceDependenciesTool.requiredPermission).toBe("Read");
    expect(readTools.map((t) => t.name)).toContain("trace_dependencies");
  });

  it("traces dependents end-to-end and returns rendered text", async () => {
    const result = await traceDependenciesTool.execute(
      { direction: "dependents", sheetName: "Model", address: "D2" },
      ctx(makeDs())
    );
    expect(result).toContain("# Dependents of Model!D2");
    expect(result).toContain("Summary!B1");
    expect(result).toContain("`=Model!D2*12`");
  });

  it("traces precedents end-to-end", async () => {
    const result = await traceDependenciesTool.execute(
      { direction: "precedents", sheetName: "Summary", address: "B1" },
      ctx(makeDs())
    );
    expect(result).toContain("Model!D2");
  });

  it("passes scopeSheets through to the dependents scan", async () => {
    const result = await traceDependenciesTool.execute(
      {
        direction: "dependents",
        sheetName: "Model",
        address: "D2",
        scopeSheets: ["Model"],
      },
      ctx(makeDs())
    );
    expect(result).toContain("No dependents found");
    expect(result).toContain("Scanned 1 sheet(s)");
  });

  it("clamps out-of-range depth instead of throwing", async () => {
    const result = await traceDependenciesTool.execute(
      { direction: "dependents", sheetName: "Model", address: "B2", depth: 99 },
      ctx(makeDs())
    );
    expect(result).toContain("# Dependents of Model!B2");
  });

  it("rejects non-rectangular / whole-column target addresses with a clear error", async () => {
    await expect(
      traceDependenciesTool.execute(
        { direction: "dependents", sheetName: "Model", address: "B:B" },
        ctx(makeDs())
      )
    ).rejects.toThrow(/A1 cell or rectangular range/);
  });

  it("rejects an invalid direction", async () => {
    await expect(
      traceDependenciesTool.execute(
        // @ts-expect-error — exercising runtime validation of bad model input
        { direction: "sideways", sheetName: "Model", address: "B2" },
        ctx(makeDs())
      )
    ).rejects.toThrow(/direction must be/);
  });

  it("surfaces unknown sheets as errors", async () => {
    await expect(
      traceDependenciesTool.execute(
        { direction: "precedents", sheetName: "Nope", address: "A1" },
        ctx(makeDs())
      )
    ).rejects.toThrow("Sheet not found: Nope");
  });
});
