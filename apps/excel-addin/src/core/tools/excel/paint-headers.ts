import { columnIndexToLetter } from "../../context";

/**
 * Draw Excel-style row/column headers around a `Range.getImage()` capture.
 *
 * Office.js cannot screenshot the host window — `Range.getImage()` renders
 * the cell block and nothing else, so the capture arrives with no column
 * letters and no row numbers. An agent looking at it can see that a label is
 * clipped but cannot say WHICH column is too narrow, and it has no way to
 * name a cell it wants to fix. Worse, a model asked what it saw has been
 * observed inventing the header strip (2026-09-10: "column letters A–Q
 * across the top", from an image containing none) — a confabulation that
 * then gets used as evidence.
 *
 * We already hold everything needed to draw the headers ourselves: the
 * bitmap, the captured address, and — since the dimension work — the real
 * per-column widths and per-row heights.
 *
 * VERIFIED IN A LIVE HOST, 2026-09-10 (Excel 16 for Windows, WebView2 CDP,
 * Sheet1!B2:N10 → 1596×217px):
 *   - Capture is edge to edge. Implied padding was ±1px over 1596px.
 *   - Worst boundary drift against the gridlines Excel actually rendered:
 *     **0.88px**, monotonic, never compounding past 1px.
 *   - The render was 120 DPI, not 96 — the machine runs at 125% display
 *     scaling. This is exactly why positions are computed as each column's
 *     SHARE OF TOTAL WIDTH rather than from a points-to-pixels constant: at
 *     a hardcoded 96 DPI the rightmost boundary would have been 320px wrong.
 *     Proportional mapping cancels DPI, zoom and scaling out entirely.
 *
 * Browser-only, following `image-downscale`: in Node/test contexts there is
 * no canvas, so the original data URL is returned unchanged and the caller
 * simply gets an unpainted screenshot.
 */

/** Gutter geometry, in CSS pixels of the source bitmap. */
const HEADER_H = 22;
const ROW_GUTTER_W = 38;
const GUTTER_BG = "#f5f5f5";
const GUTTER_LINE = "#c6c6c6";
const GUTTER_TEXT = "#4d4d4d";
const LABEL_FONT = '12px "Segoe UI", system-ui, sans-serif';

export interface HeaderPaintInput {
  /** 0-based index of the leftmost captured column (A = 0). */
  startCol: number;
  /** 1-based number of the topmost captured row. */
  startRow: number;
  /** Points, left to right. Length defines the column count. */
  columnWidths: number[];
  /** Points, top to bottom. */
  rowHeights: number[];
}

export interface HeaderBand {
  label: string;
  /** Pixel offset of the band's leading edge within the bitmap. */
  start: number;
  /** Pixel extent of the band. */
  size: number;
}

/**
 * Where each label goes, as a pure function of the bitmap size and the
 * dimension arrays. Separated from the drawing so the geometry — the part
 * that can silently drift — is testable in Node.
 *
 * A band whose label will not fit is returned with an empty `label`: a
 * gutter that overprints two letters into illegible mush is worse than one
 * that leaves a narrow column unlabelled, because the agent would read it.
 */
export function headerBands(
  extentPx: number,
  sizes: number[],
  labelAt: (index: number) => string,
  minPxForLabel: (label: string) => number
): HeaderBand[] {
  const total = sizes.reduce((a, b) => a + b, 0);
  if (total <= 0 || extentPx <= 0) return [];
  const bands: HeaderBand[] = [];
  let acc = 0;
  for (let i = 0; i < sizes.length; i++) {
    const start = (acc / total) * extentPx;
    acc += sizes[i];
    const end = (acc / total) * extentPx;
    const label = labelAt(i);
    bands.push({
      label: end - start >= minPxForLabel(label) ? label : "",
      start,
      size: end - start,
    });
  }
  return bands;
}

/**
 * Paint headers onto a PNG data URL. Returns the original URL unchanged in
 * any context without a canvas, and on any failure — a screenshot without a
 * gutter is a small loss; a thrown error mid-verification is not.
 */
export async function paintRangeHeaders(dataUrl: string, input: HeaderPaintInput): Promise<string> {
  if (typeof document === "undefined" || typeof Image === "undefined") return dataUrl;
  if (input.columnWidths.length === 0 || input.rowHeights.length === 0) return dataUrl;

  try {
    const img = await loadImage(dataUrl);
    const iw = img.width;
    const ih = img.height;
    if (!iw || !ih) return dataUrl;

    const canvas = document.createElement("canvas");
    canvas.width = iw + ROW_GUTTER_W;
    canvas.height = ih + HEADER_H;
    const g = canvas.getContext("2d");
    if (!g) return dataUrl;

    g.fillStyle = GUTTER_BG;
    g.fillRect(0, 0, canvas.width, HEADER_H);
    g.fillRect(0, 0, ROW_GUTTER_W, canvas.height);
    g.drawImage(img, ROW_GUTTER_W, HEADER_H);

    g.font = LABEL_FONT;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 1;

    const cols = headerBands(
      iw,
      input.columnWidths,
      (i) => columnIndexToLetter(input.startCol + i),
      (label) => g.measureText(label).width + 4
    );
    for (const band of cols) {
      const x = ROW_GUTTER_W + band.start;
      g.strokeStyle = GUTTER_LINE;
      g.beginPath();
      g.moveTo(Math.round(x) + 0.5, 0);
      g.lineTo(Math.round(x) + 0.5, HEADER_H);
      g.stroke();
      if (band.label) {
        g.fillStyle = GUTTER_TEXT;
        g.fillText(band.label, x + band.size / 2, HEADER_H / 2);
      }
    }

    const rows = headerBands(
      ih,
      input.rowHeights,
      (i) => String(input.startRow + i),
      () => 9
    );
    for (const band of rows) {
      const y = HEADER_H + band.start;
      g.strokeStyle = GUTTER_LINE;
      g.beginPath();
      g.moveTo(0, Math.round(y) + 0.5);
      g.lineTo(ROW_GUTTER_W, Math.round(y) + 0.5);
      g.stroke();
      if (band.label) {
        g.fillStyle = GUTTER_TEXT;
        g.fillText(band.label, ROW_GUTTER_W / 2, y + band.size / 2);
      }
    }

    g.strokeStyle = GUTTER_LINE;
    g.beginPath();
    g.moveTo(0, HEADER_H + 0.5);
    g.lineTo(canvas.width, HEADER_H + 0.5);
    g.moveTo(ROW_GUTTER_W + 0.5, 0);
    g.lineTo(ROW_GUTTER_W + 0.5, canvas.height);
    g.stroke();

    return canvas.toDataURL("image/png");
  } catch {
    return dataUrl;
  }
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image decode failed"));
    img.src = dataUrl;
  });
}
