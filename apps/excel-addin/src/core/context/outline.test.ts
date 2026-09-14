import { describe, expect, it } from "vitest";
import { inMemoryDataSource } from "./in-memory";
import { getWorkbookOutline, renderWorkbookOutline } from "./outline";

describe("getWorkbookOutline", () => {
  it("returns sheets, named ranges, and the active sheet", async () => {
    const ds = inMemoryDataSource({
      sheets: [
        {
          name: "Summary",
          cells: { A1: { value: "Title" }, B5: { value: 100 } },
          chartCount: 1,
        },
        { name: "Hidden", visible: false, cells: { A1: { value: 1 } } },
        { name: "Empty" },
      ],
      namedRanges: [{ name: "Revenue", scope: "workbook", refersTo: "=Summary!$B$5" }],
      activeSheet: "Summary",
    });

    const outline = await getWorkbookOutline(ds);
    expect(outline.activeSheet).toBe("Summary");
    expect(outline.sheets).toEqual([
      {
        name: "Summary",
        position: 0,
        visible: true,
        rowCount: 5,
        columnCount: 2,
        usedRange: "A1:B5",
        hasCharts: true,
        hasPivots: false,
      },
      {
        name: "Hidden",
        position: 1,
        visible: false,
        rowCount: 1,
        columnCount: 1,
        usedRange: "A1",
        hasCharts: false,
        hasPivots: false,
      },
      {
        name: "Empty",
        position: 2,
        visible: true,
        rowCount: 0,
        columnCount: 0,
        usedRange: null,
        hasCharts: false,
        hasPivots: false,
      },
    ]);
    expect(outline.namedRanges).toHaveLength(1);
    expect(outline.namedRanges[0].name).toBe("Revenue");
  });

  it("computes used range from cell keys", async () => {
    const ds = inMemoryDataSource({
      sheets: [{ name: "S", cells: { A1: { value: 1 }, Z100: { value: 2 } } }],
    });
    const o = await getWorkbookOutline(ds);
    expect(o.sheets[0].rowCount).toBe(100);
    expect(o.sheets[0].columnCount).toBe(26);
    expect(o.sheets[0].usedRange).toBe("A1:Z100");
  });

  it("reports a used range that does not start at A1 by its address, with its own extent", async () => {
    // Office's getUsedRange semantics: a B2:I8 table is 7×8 at "B2:I8", not 8×9.
    const ds = inMemoryDataSource({
      sheets: [
        { name: "S", cells: { B2: { value: "Unit Mix" }, I8: { value: 277000 } } },
        { name: "Empty" },
      ],
    });
    const o = await getWorkbookOutline(ds);
    expect(o.sheets[0]).toMatchObject({ rowCount: 7, columnCount: 8, usedRange: "B2:I8" });
    expect(o.sheets[1]).toMatchObject({ rowCount: 0, columnCount: 0, usedRange: null });
    expect(renderWorkbookOutline(o)).toContain("- S — B2:I8 (7×8)");
    expect(renderWorkbookOutline(o)).toContain("- Empty — empty");
  });
});

describe("renderWorkbookOutline", () => {
  it("emits a compact text representation", () => {
    const text = renderWorkbookOutline({
      activeSheet: "Summary",
      sheets: [
        {
          name: "Summary",
          position: 0,
          visible: true,
          rowCount: 50,
          columnCount: 10,
          usedRange: "A1:J50",
          hasCharts: true,
          hasPivots: false,
        },
        {
          name: "Hidden",
          position: 1,
          visible: false,
          rowCount: 5,
          columnCount: 5,
          usedRange: "A1:E5",
          hasCharts: false,
          hasPivots: false,
        },
      ],
      namedRanges: [{ name: "Revenue", scope: "workbook", refersTo: "=Summary!$B$5" }],
    });

    expect(text).toContain("Active sheet: Summary");
    expect(text).toContain("Summary — A1:J50 (50×10) [charts]");
    expect(text).toContain("Hidden — A1:E5 (5×5) [hidden]");
    expect(text).toContain("Revenue = =Summary!$B$5");
  });

  it("omits the named-ranges section when there are none", () => {
    const text = renderWorkbookOutline({
      sheets: [
        {
          name: "S",
          position: 0,
          visible: true,
          rowCount: 0,
          columnCount: 0,
          usedRange: null,
          hasCharts: false,
          hasPivots: false,
        },
      ],
      namedRanges: [],
    });
    expect(text).not.toContain("Named ranges");
  });

  it("stays compact even with many sheets", () => {
    const sheets = Array.from({ length: 50 }, (_, i) => ({
      name: `Sheet${i + 1}`,
      position: i,
      visible: true,
      rowCount: 100,
      columnCount: 20,
      usedRange: "A1:T100",
      hasCharts: false,
      hasPivots: false,
    }));
    const text = renderWorkbookOutline({ sheets, namedRanges: [] });
    // 50 sheets at ~20 chars each + header overhead is well under 4k chars.
    expect(text.length).toBeLessThan(4000);
  });
});
