import { describe, expect, it } from "vitest";
import { headerBands, paintRangeHeaders } from "./paint-headers";

/** Real widths measured from Sheet1!B2:N10 in a live host, 2026-09-10. */
const REAL_WIDTHS = [87, 28.8, 49.2, 60, 40.8, 75, 66, 82.8, 76.2, 112.2, 85.2, 78.6, 115.2];
const REAL_IMAGE_W = 1596;
/** Gridline x-positions detected in that capture's pixels. */
const REAL_GRIDLINES = [145, 193, 275, 375, 443, 568, 678, 816, 943, 1130, 1272, 1403];

const letters = (i: number) => "BCDEFGHIJKLMN"[i] ?? "?";
const noMin = () => 0;

describe("headerBands", () => {
  /**
   * The whole risk of this feature: a gutter whose labels drift off their
   * columns is worse than no gutter, because the agent reads it and names the
   * wrong column. Measured against the gridlines Excel actually rendered.
   */
  it("lands within 1px of the real gridlines across a 1596px capture", () => {
    const bands = headerBands(REAL_IMAGE_W, REAL_WIDTHS, letters, noMin);
    // Each band's trailing edge is a boundary; the last one is the image edge.
    const boundaries = bands.slice(0, -1).map((b) => b.start + b.size);
    expect(boundaries).toHaveLength(REAL_GRIDLINES.length);
    boundaries.forEach((computed, i) => {
      expect(Math.abs(computed - REAL_GRIDLINES[i])).toBeLessThan(1);
    });
  });

  /**
   * Proportional mapping is what makes the above hold. The live host rendered
   * at 120 DPI (125% display scaling), not the 96 DPI a points-to-pixels
   * constant would assume — at 4/3 px/pt the rightmost boundary is out by
   * hundreds of pixels. Same widths, any bitmap size, still aligned.
   */
  it("is immune to DPI, zoom and display scaling", () => {
    for (const width of [957, 1276, 1596, 3192]) {
      const bands = headerBands(width, REAL_WIDTHS, letters, noMin);
      const total = REAL_WIDTHS.reduce((a, b) => a + b, 0);
      // Every boundary stays at the same FRACTION of the image.
      let acc = 0;
      bands.forEach((b, i) => {
        acc += REAL_WIDTHS[i];
        expect(b.start + b.size).toBeCloseTo((acc / total) * width, 6);
      });
      expect(bands[bands.length - 1].start + bands[bands.length - 1].size).toBeCloseTo(width, 6);
    }
  });

  it("covers the full extent with no gaps between bands", () => {
    const bands = headerBands(REAL_IMAGE_W, REAL_WIDTHS, letters, noMin);
    bands.forEach((b, i) => {
      if (i === 0) expect(b.start).toBe(0);
      else expect(b.start).toBeCloseTo(bands[i - 1].start + bands[i - 1].size, 6);
    });
  });

  // A gutter that overprints two letters into mush is worse than one that
  // leaves a sliver unlabelled, because the agent would read the mush.
  it("drops the label on a band too narrow to hold it, keeping the band", () => {
    const bands = headerBands(100, [1, 99], letters, () => 20);
    expect(bands[0].label).toBe("");
    expect(bands[0].size).toBeCloseTo(1, 6);
    expect(bands[1].label).toBe("C");
  });

  it("returns nothing rather than dividing by zero", () => {
    expect(headerBands(100, [], letters, noMin)).toEqual([]);
    expect(headerBands(0, REAL_WIDTHS, letters, noMin)).toEqual([]);
    expect(headerBands(100, [0, 0], letters, noMin)).toEqual([]);
  });
});

describe("paintRangeHeaders", () => {
  const url = "data:image/png;base64,iVBORw0KGgoAAAA";

  // Browser-only, same contract as image-downscale: no canvas in Node, so the
  // caller gets an unpainted screenshot rather than an exception.
  it("returns the original data URL unchanged with no canvas", async () => {
    const out = await paintRangeHeaders(url, {
      startCol: 1,
      startRow: 2,
      columnWidths: REAL_WIDTHS,
      rowHeights: [14.5],
    });
    expect(out).toBe(url);
  });

  it("no-ops on empty dimensions rather than producing an empty gutter", async () => {
    expect(
      await paintRangeHeaders(url, { startCol: 0, startRow: 1, columnWidths: [], rowHeights: [] })
    ).toBe(url);
  });

  it("never throws on malformed input", async () => {
    await expect(
      paintRangeHeaders("not-a-data-url", {
        startCol: 0,
        startRow: 1,
        columnWidths: [10],
        rowHeights: [10],
      })
    ).resolves.toBeTruthy();
  });
});
