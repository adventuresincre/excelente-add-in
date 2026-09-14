import { describe, expect, it } from "vitest";
import { inMemoryDataSource } from "../context";
import type { InMemoryWorkbook } from "../context/in-memory";
import { MEMORY_SHEET, readWorkbookMemory } from "../memory";
import { createUndoStack } from "./undo";
import { readWorkbookMemoryTool, writeWorkbookMemoryTool } from "./memory";

const baseCtx = (ds: ReturnType<typeof inMemoryDataSource>) => ({
  ds,
  undoStack: createUndoStack(),
});

describe("read_workbook_memory", () => {
  it("returns empty string when no memory has been written yet", async () => {
    const ds = inMemoryDataSource({ sheets: [{ name: "Sheet1" }] });
    expect(await readWorkbookMemoryTool.execute({}, baseCtx(ds))).toBe("");
  });

  it("returns the stored memory content after a write", async () => {
    const ds = inMemoryDataSource({ sheets: [{ name: "Sheet1" }] });
    await writeWorkbookMemoryTool.execute(
      { content: "# Conventions\n- $ in thousands\n" },
      baseCtx(ds)
    );
    expect(await readWorkbookMemoryTool.execute({}, baseCtx(ds))).toBe(
      "# Conventions\n- $ in thousands\n"
    );
  });

  it("is a Read permission tool (no approval gate)", () => {
    expect(readWorkbookMemoryTool.requiredPermission).toBe("Read");
  });
});

describe("write_workbook_memory", () => {
  it("creates the hidden _excelente sheet on first write", async () => {
    const wb: InMemoryWorkbook = { sheets: [{ name: "Sheet1" }] };
    const ds = inMemoryDataSource(wb);

    await writeWorkbookMemoryTool.execute({ content: "memory body" }, baseCtx(ds));

    const memSheet = wb.sheets.find((s) => s.name === MEMORY_SHEET);
    expect(memSheet).toBeDefined();
    expect(memSheet?.visible).toBe(false);
  });

  it("returns { written } reflecting the content length", async () => {
    const ds = inMemoryDataSource({ sheets: [{ name: "Sheet1" }] });
    const result = await writeWorkbookMemoryTool.execute({ content: "1234567890" }, baseCtx(ds));
    expect(result).toEqual({ written: 10 });
  });

  it("replaces (does not append) existing memory", async () => {
    const ds = inMemoryDataSource({ sheets: [{ name: "Sheet1" }] });
    await writeWorkbookMemoryTool.execute({ content: "first" }, baseCtx(ds));
    await writeWorkbookMemoryTool.execute({ content: "second" }, baseCtx(ds));
    expect(await readWorkbookMemory(ds)).toBe("second");
  });

  it("is a Write permission tool (gated through approval UI)", () => {
    expect(writeWorkbookMemoryTool.requiredPermission).toBe("Write");
  });

  it("rejects oversized content with a clear error", async () => {
    const ds = inMemoryDataSource({ sheets: [{ name: "Sheet1" }] });
    const oversized = "x".repeat(100_000);
    await expect(
      writeWorkbookMemoryTool.execute({ content: oversized }, baseCtx(ds))
    ).rejects.toThrow(/per-cell limit/);
  });
});
