import { describe, expect, it } from "vitest";
import { inMemoryDataSource } from "../context";
import type { InMemoryWorkbook } from "../context/in-memory";
import {
  MEMORY_MAX_CHARS,
  MEMORY_SHEET,
  readWorkbookMemory,
  writeWorkbookMemory,
} from "./workbook-memory";

describe("workbook memory", () => {
  it("read returns empty string when the memory sheet does not exist", async () => {
    const ds = inMemoryDataSource({ sheets: [{ name: "Sheet1" }] });
    expect(await readWorkbookMemory(ds)).toBe("");
  });

  it("write creates the hidden sheet on first call and stores content in A1", async () => {
    const wb: InMemoryWorkbook = { sheets: [{ name: "Sheet1" }] };
    const ds = inMemoryDataSource(wb);

    await writeWorkbookMemory(ds, "# Conventions\n- $ in thousands\n");

    const memSheet = wb.sheets.find((s) => s.name === MEMORY_SHEET);
    expect(memSheet).toBeDefined();
    expect(memSheet?.visible).toBe(false);
    expect(memSheet?.cells?.A1?.value).toBe("# Conventions\n- $ in thousands\n");
  });

  it("read returns what was just written (round-trip)", async () => {
    const ds = inMemoryDataSource({ sheets: [{ name: "Sheet1" }] });
    const content = "## Sheet purposes\n- Inputs: assumptions only\n- Calcs: derived\n";

    await writeWorkbookMemory(ds, content);
    expect(await readWorkbookMemory(ds)).toBe(content);
  });

  it("write overwrites prior memory rather than appending", async () => {
    const ds = inMemoryDataSource({ sheets: [{ name: "Sheet1" }] });
    await writeWorkbookMemory(ds, "first");
    await writeWorkbookMemory(ds, "second");
    expect(await readWorkbookMemory(ds)).toBe("second");
  });

  it("write throws when content exceeds the per-cell character limit", async () => {
    const ds = inMemoryDataSource({ sheets: [{ name: "Sheet1" }] });
    const oversized = "x".repeat(MEMORY_MAX_CHARS + 1);

    await expect(writeWorkbookMemory(ds, oversized)).rejects.toThrow(/per-cell limit/);
    // Sheet should not have been created when validation fails before write.
    const sheets = await ds.listSheets();
    expect(sheets.some((s) => s.name === MEMORY_SHEET)).toBe(false);
  });

  // The write-side cap can't protect the read path: a hand-edited cell holds
  // ~32,767 chars, and this content lands in the system prompt.
  it("read truncates an oversized hand-edited cell instead of returning it whole", async () => {
    const oversized = "x".repeat(MEMORY_MAX_CHARS + 5_000);
    const ds = inMemoryDataSource({
      sheets: [
        {
          name: MEMORY_SHEET,
          visible: false,
          cells: { A1: { value: oversized } },
        },
      ],
    });

    const got = await readWorkbookMemory(ds);
    expect(got.length).toBeLessThan(oversized.length);
    expect(got).toContain("[truncated");
    expect(got.startsWith("x".repeat(100))).toBe(true);
  });

  it("read returns empty string when the memory cell is blank (sheet exists but never written)", async () => {
    const ds = inMemoryDataSource({
      sheets: [{ name: "Sheet1" }, { name: MEMORY_SHEET, visible: false }],
    });
    expect(await readWorkbookMemory(ds)).toBe("");
  });
});
