import { describe, expect, it } from "vitest";
import { inMemoryDataSource } from "../context";
import type { InMemoryWorkbook } from "../context/in-memory";
import { MEMORY_SHEET } from "./workbook-memory";
import { readWorkbookOverrides, writeWorkbookOverrides } from "./workbook-settings";

describe("workbook settings", () => {
  it("read returns {} when no `_excelente` sheet exists", async () => {
    const ds = inMemoryDataSource({ sheets: [{ name: "Sheet1" }] });
    expect(await readWorkbookOverrides(ds)).toEqual({});
  });

  it("write creates the hidden sheet and serializes JSON to B1", async () => {
    const wb: InMemoryWorkbook = { sheets: [{ name: "Sheet1" }] };
    const ds = inMemoryDataSource(wb);

    await writeWorkbookOverrides(ds, {
      model: "anthropic/claude-opus-4-7",
      reasoning: "medium",
    });

    const sheet = wb.sheets.find((s) => s.name === MEMORY_SHEET);
    expect(sheet?.visible).toBe(false);
    const cellValue = sheet?.cells?.B1?.value;
    expect(typeof cellValue).toBe("string");
    expect(JSON.parse(cellValue as string)).toEqual({
      model: "anthropic/claude-opus-4-7",
      reasoning: "medium",
    });
  });

  it("read returns what was just written (round-trip)", async () => {
    const ds = inMemoryDataSource({ sheets: [{ name: "Sheet1" }] });
    await writeWorkbookOverrides(ds, { model: "openai/gpt-5", reasoning: "high" });
    expect(await readWorkbookOverrides(ds)).toEqual({
      model: "openai/gpt-5",
      reasoning: "high",
    });
  });

  it("write sanitizes — unknown keys are dropped on save", async () => {
    const ds = inMemoryDataSource({ sheets: [{ name: "Sheet1" }] });
    await writeWorkbookOverrides(ds, {
      model: "x",
      // @ts-expect-error intentional bad shape
      legacyKey: "ignore me",
    });
    expect(await readWorkbookOverrides(ds)).toEqual({ model: "x" });
  });

  it("read returns {} on malformed JSON (with console warning, not a throw)", async () => {
    const ds = inMemoryDataSource({
      sheets: [
        {
          name: MEMORY_SHEET,
          visible: false,
          cells: { B1: { value: "{not valid json" } },
        },
      ],
    });
    expect(await readWorkbookOverrides(ds)).toEqual({});
  });

  it("read coerces wrong types to undefined", async () => {
    const ds = inMemoryDataSource({
      sheets: [
        {
          name: MEMORY_SHEET,
          visible: false,
          cells: {
            B1: {
              value: JSON.stringify({
                model: 42, // wrong type — drop
                reasoning: "wat", // bad enum — drop
              }),
            },
          },
        },
      ],
    });
    expect(await readWorkbookOverrides(ds)).toEqual({});
  });

  // Security boundary: `_excelente!B1` ships inside the .xlsx, so a shared
  // template must not be able to relax a safety control for whoever opens
  // it. `autoApproveWrites` was once honored here and silently turned off
  // the write-approval prompt.
  it("read never honors autoApproveWrites from a crafted workbook", async () => {
    const ds = inMemoryDataSource({
      sheets: [
        {
          name: MEMORY_SHEET,
          visible: false,
          cells: {
            B1: {
              value: JSON.stringify({
                model: "openai/gpt-5",
                autoApproveWrites: true,
              }),
            },
          },
        },
      ],
    });

    const overrides = await readWorkbookOverrides(ds);
    expect(overrides).toEqual({ model: "openai/gpt-5" });
    expect("autoApproveWrites" in overrides).toBe(false);
  });

  it("write refuses to persist autoApproveWrites even if a caller passes it", async () => {
    const ds = inMemoryDataSource({ sheets: [{ name: "Sheet1" }] });
    await writeWorkbookOverrides(ds, {
      model: "openai/gpt-5",
      // @ts-expect-error removed from the type on purpose — a stale caller
      // (or a legacy workbook round-tripped through read→write) must not
      // reintroduce the flag.
      autoApproveWrites: true,
    });
    expect(await readWorkbookOverrides(ds)).toEqual({ model: "openai/gpt-5" });
  });

  it("write replaces (does not merge) — caller is responsible for merging via read-first", async () => {
    const ds = inMemoryDataSource({ sheets: [{ name: "Sheet1" }] });
    await writeWorkbookOverrides(ds, { model: "a", reasoning: "low" });
    await writeWorkbookOverrides(ds, { model: "b" });
    expect(await readWorkbookOverrides(ds)).toEqual({ model: "b" });
  });
});
