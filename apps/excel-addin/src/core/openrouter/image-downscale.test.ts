import { describe, expect, it } from "vitest";
import { downscaleImageDataUrl } from "./image-downscale";

describe("downscaleImageDataUrl", () => {
  it("returns the original data URL unchanged in Node / non-browser contexts", async () => {
    // createImageBitmap is browser-only. In the vitest Node runner it's
    // either undefined or unimplemented — either way the helper should
    // bail safely without throwing.
    const url = "data:image/png;base64,iVBORw0KGgoAAAA";
    const out = await downscaleImageDataUrl(url);
    expect(out).toBe(url);
  });

  it("never throws even on malformed input", async () => {
    await expect(downscaleImageDataUrl("not-a-data-url")).resolves.toBeTruthy();
  });
});
