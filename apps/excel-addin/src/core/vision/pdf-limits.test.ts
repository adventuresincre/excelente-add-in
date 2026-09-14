import { describe, expect, it } from "vitest";
import { clampScale, isUsableImageDataUrl } from "./pdf";

/** Minimal stand-in for pdf.js's page: viewport scales linearly. */
function page(baseWidth: number, baseHeight: number) {
  return {
    getViewport({ scale }: { scale: number }) {
      return { width: baseWidth * scale, height: baseHeight * scale };
    },
  };
}

describe("clampScale", () => {
  it("leaves an ordinary letter-size page untouched", () => {
    // 612x792pt at 1.5x is ~1.1M pixels — nowhere near the cap.
    expect(clampScale(page(612, 792), 1.5)).toBe(1.5);
  });

  it("shrinks an oversized page below the canvas area budget", () => {
    // A large-format sheet (a 42x30in site plan is 3024x2160pt) rendered at
    // a high scale blows past what WebKit will serialize: 7560x5400 is
    // ~41M pixels against a 16M budget.
    const large = page(3024, 2160);
    const clamped = clampScale(large, 2.5);

    expect(clamped).toBeLessThan(2.5);
    const { width, height } = large.getViewport({ scale: clamped });
    expect(width * height).toBeLessThanOrEqual(16_000_000);
    expect(Math.max(width, height)).toBeLessThanOrEqual(8_192);
  });

  it("respects the max-edge limit even when total area would fit", () => {
    // A long, thin page: modest area, but one enormous edge.
    const banner = page(20_000, 200);
    const clamped = clampScale(banner, 1);
    const { width, height } = banner.getViewport({ scale: clamped });
    expect(Math.max(width, height)).toBeLessThanOrEqual(8_192);
  });

  it("does not divide by zero on a degenerate page", () => {
    expect(clampScale(page(0, 0), 1.5)).toBe(1.5);
  });
});

describe("isUsableImageDataUrl", () => {
  it("rejects WebKit's degenerate canvas output", () => {
    // What Safari-based engines return when a canvas is too large to
    // serialize. Passing this through would hand the model a blank page.
    expect(isUsableImageDataUrl("data:,")).toBe(false);
    expect(isUsableImageDataUrl("")).toBe(false);
    expect(isUsableImageDataUrl("data:image/jpeg;base64,")).toBe(false);
  });

  it("accepts a real encoded page", () => {
    expect(isUsableImageDataUrl(`data:image/jpeg;base64,${"A".repeat(5_000)}`)).toBe(true);
  });
});
