import { describe, expect, it } from "vitest";
import { inMemoryDataSource, type CellValue, type InMemoryWorkbook } from "./in-memory";
import { getSheetOutline, renderSheetOutline } from "./sheet-outline";

function makeWorkbook(
  cells: Record<string, { value?: CellValue; formula?: string }>
): InMemoryWorkbook {
  return {
    sheets: [{ name: "Sheet1", cells }],
  };
}

describe("getSheetOutline", () => {
  it("returns an empty outline for an empty sheet", async () => {
    const ds = inMemoryDataSource({ sheets: [{ name: "Sheet1" }] });
    const out = await getSheetOutline(ds, "Sheet1");
    expect(out.rowCount).toBe(0);
    expect(out.columnCount).toBe(0);
    expect(out.formulaCount).toBe(0);
    expect(out.formulaClusters).toEqual([]);
  });

  it("captures top row + left column labels", async () => {
    const ds = inMemoryDataSource(
      makeWorkbook({
        A1: { value: "Label" },
        B1: { value: "Jan" },
        C1: { value: "Feb" },
        D1: { value: "Mar" },
        A2: { value: "Rev" },
        A3: { value: "Cost" },
        A4: { value: "GP" },
        B2: { value: 100 },
        C2: { value: 150 },
        D2: { value: 200 },
        B3: { value: 50 },
        C3: { value: 60 },
        D3: { value: 75 },
      })
    );
    const out = await getSheetOutline(ds, "Sheet1");
    expect(out.topRowLabels).toEqual(["Label", "Jan", "Feb", "Mar"]);
    expect(out.leftColumnLabels).toEqual(["Label", "Rev", "Cost", "GP"]);
  });

  it("clusters horizontally-filled formulas into a single cluster", async () => {
    // GP = Rev - Cost, filled across B4, C4, D4
    const ds = inMemoryDataSource(
      makeWorkbook({
        B2: { value: 100 },
        C2: { value: 150 },
        D2: { value: 200 },
        B3: { value: 50 },
        C3: { value: 60 },
        D3: { value: 75 },
        B4: { value: 50, formula: "=B2-B3" },
        C4: { value: 90, formula: "=C2-C3" },
        D4: { value: 125, formula: "=D2-D3" },
      })
    );
    const out = await getSheetOutline(ds, "Sheet1");
    expect(out.formulaCount).toBe(3);
    expect(out.formulaClusters).toHaveLength(1);
    const cluster = out.formulaClusters[0];
    expect(cluster.count).toBe(3);
    expect(cluster.rangeAddress).toBe("B4:D4");
    expect(cluster.isRectangle).toBe(true);
    expect(cluster.sampleValues).toEqual([50, 90, 125]);
  });

  it("clusters a vertical column of 100 SUM formulas as one cluster", async () => {
    const cells: Record<string, { value?: CellValue; formula?: string }> = {};
    for (let r = 5; r <= 104; r++) {
      cells[`B${r}`] = { value: r * 10, formula: `=SUM(B$1:B${r - 1})` };
    }
    const ds = inMemoryDataSource(makeWorkbook(cells));
    const out = await getSheetOutline(ds, "Sheet1");
    expect(out.formulaCount).toBe(100);
    expect(out.formulaClusters).toHaveLength(1);
    expect(out.formulaClusters[0].count).toBe(100);
    expect(out.formulaClusters[0].rangeAddress).toBe("B5:B104");
    expect(out.formulaClusters[0].isRectangle).toBe(true);
  });

  it("ranks clusters by count (most-used first)", async () => {
    const cells: Record<string, { value?: CellValue; formula?: string }> = {};
    // 5 cells of pattern A: =A1+1 filled down
    for (let r = 2; r <= 6; r++) cells[`B${r}`] = { formula: `=B${r - 1}+1` };
    // 2 cells of pattern B: =C1*2
    cells.D2 = { formula: "=D1*2" };
    cells.D3 = { formula: "=D2*2" };

    const ds = inMemoryDataSource(makeWorkbook(cells));
    const out = await getSheetOutline(ds, "Sheet1");
    expect(out.formulaClusters[0].count).toBeGreaterThanOrEqual(out.formulaClusters[1].count);
    expect(out.formulaClusters[0].count).toBe(5);
  });

  it("captures body samples (non-formula values, not in row 1 / col A)", async () => {
    const ds = inMemoryDataSource(
      makeWorkbook({
        A1: { value: "Hdr" },
        B1: { value: "Jan" },
        A2: { value: "Rev" },
        B2: { value: 100 }, // body sample
        C2: { value: 150 }, // body sample
        B3: { value: 50, formula: "=B2-50" }, // NOT a body sample (has formula)
      })
    );
    const out = await getSheetOutline(ds, "Sheet1");
    expect(out.bodySamples.map((s) => s.address)).toEqual(["B2", "C2"]);
    expect(out.bodySamples.map((s) => s.value)).toEqual([100, 150]);
  });

  it("marks sparse cluster as isRectangle=false", async () => {
    // Three cells in a row but with a hole between them
    const ds = inMemoryDataSource(
      makeWorkbook({
        B5: { formula: "=A5+1" },
        D5: { formula: "=C5+1" }, // skip C5
        E5: { formula: "=D5+1" },
      })
    );
    const out = await getSheetOutline(ds, "Sheet1");
    // All three normalize to the same pattern (=col-1 row+0 + 1)
    expect(out.formulaClusters).toHaveLength(1);
    expect(out.formulaClusters[0].count).toBe(3);
    expect(out.formulaClusters[0].rangeAddress).toBe("B5:E5");
    expect(out.formulaClusters[0].isRectangle).toBe(false); // 3 cells in 4-wide rect
  });

  it("throws when the sheet doesn't exist", async () => {
    const ds = inMemoryDataSource({ sheets: [{ name: "Sheet1" }] });
    await expect(getSheetOutline(ds, "Missing")).rejects.toThrow(/Sheet not found/);
  });

  it("surfaces chart names (replacing the retired list_charts tool)", async () => {
    const ds = inMemoryDataSource({
      sheets: [
        {
          name: "Sheet1",
          cells: { A1: { value: "x" } },
          charts: [
            { name: "Revenue Trend", pngDataUrl: "data:image/png;base64,A" },
            { name: "Cost Breakdown", pngDataUrl: "data:image/png;base64,B" },
          ],
        },
      ],
    });
    const out = await getSheetOutline(ds, "Sheet1");
    expect(out.charts).toEqual(["Revenue Trend", "Cost Breakdown"]);
    expect(renderSheetOutline(out)).toContain("## Charts (2)");
  });

  it("reports no charts when the sheet has none", async () => {
    const ds = inMemoryDataSource(makeWorkbook({ A1: { value: "x" } }));
    const out = await getSheetOutline(ds, "Sheet1");
    expect(out.charts).toEqual([]);
    expect(renderSheetOutline(out)).not.toContain("Charts");
  });
});

describe("renderSheetOutline", () => {
  it("emits compact text with labels, clusters, samples", async () => {
    const ds = inMemoryDataSource(
      makeWorkbook({
        A1: { value: "Hdr" },
        B1: { value: "Jan" },
        C1: { value: "Feb" },
        A2: { value: "Rev" },
        B2: { value: 100 },
        C2: { value: 150 },
        B3: { formula: "=B2*2" },
        C3: { formula: "=C2*2" },
      })
    );
    const out = await getSheetOutline(ds, "Sheet1");
    const text = renderSheetOutline(out);
    expect(text).toContain("Sheet: Sheet1");
    expect(text).toContain("Used range: A1:C3 — 3 rows × 3 columns; 2 formula cells");
    expect(text).toContain("## Row 1 labels (by column)");
    expect(text).toContain('A:"Hdr" | B:"Jan" | C:"Feb"');
    expect(text).toContain("## Column A labels (by row)");
    expect(text).toContain('1:"Hdr" | 2:"Rev" | 3:·');
    expect(text).toContain("B3:C3 (2 cells, rect)");
    expect(text).toContain("`=B2*2`");
  });

  it("anchors everything on the used range when the table does not start at A1", async () => {
    // 2026-09-10: this table was outlined as A1:H7 — row 1 and column A
    // (empty) described, column I and the totals row never seen.
    const ds = inMemoryDataSource(
      makeWorkbook({
        B2: { value: "Unit Mix" },
        B3: { value: "Unit Type" },
        C3: { value: "Units" },
        I3: { value: "Monthly Revenue" },
        B4: { value: "Studio" },
        C4: { value: 24 },
        I4: { value: 33600, formula: "=C4*G4" },
        B5: { value: "1BR" },
        C5: { value: 60 },
        I5: { value: 105000, formula: "=C5*G5" },
        B8: { value: "Total" },
        C8: { value: 84, formula: "=SUM(C4:C7)" },
        I8: { value: 138600, formula: "=SUM(I4:I7)" },
      })
    );
    const out = await getSheetOutline(ds, "Sheet1");
    expect(out.usedRange).toBe("B2:I8");
    expect(out.rowCount).toBe(7);
    expect(out.columnCount).toBe(8);
    expect(out.formulaCount).toBe(4);
    expect(out.topRowLabels[0]).toBe("Unit Mix");
    expect(out.leftColumnLabels).toEqual([
      "Unit Mix",
      "Unit Type",
      "Studio",
      "1BR",
      null,
      null,
      "Total",
    ]);
    const revenue = out.formulaClusters.find((c) => c.example === "=C4*G4");
    expect(revenue?.rangeAddress).toBe("I4:I5");
    // =SUM(C4:C7) at C8 and =SUM(I4:I7) at I8 are the same relative pattern:
    // one cluster, bounded C8:I8 with a hole, both addresses absolute.
    const sums = out.formulaClusters.find((c) => c.example === "=SUM(C4:C7)");
    expect(sums).toMatchObject({ rangeAddress: "C8:I8", count: 2, isRectangle: false });
    expect(out.formulaClusters.map((c) => c.exampleAddress).sort()).toEqual(["C8", "I4"]);

    const text = renderSheetOutline(out);
    expect(text).toContain("Used range: B2:I8 — 7 rows × 8 columns; 4 formula cells");
    expect(text).toContain("## Row 2 labels (by column)");
    expect(text).toContain('B:"Unit Mix"');
    expect(text).toContain("## Column B labels (by row)");
    expect(text).toContain('2:"Unit Mix" | 3:"Unit Type" | 4:"Studio"');
    expect(text).toContain("- I4:I5 (2 cells, rect) example I4: `=C4*G4`");
  });

  it("stays compact for a 100-formula column", async () => {
    const cells: Record<string, { value?: CellValue; formula?: string }> = {};
    for (let r = 2; r <= 101; r++) cells[`B${r}`] = { value: r, formula: `=B${r - 1}+1` };
    const ds = inMemoryDataSource(makeWorkbook(cells));
    const out = await getSheetOutline(ds, "Sheet1");
    const text = renderSheetOutline(out);
    // 100 formulas collapse to a single cluster line; total under 2k chars.
    expect(text.length).toBeLessThan(2000);
  });
});
