/**
 * Downscale a PNG/JPEG data URL to a target max edge length to cut vision
 * model token cost. Most providers bill image input per pixel-block — a
 * 1920×1080 spreadsheet screenshot can hit 1.5-3k image tokens; downscaling
 * to ~1280px max edge halves that with minimal quality loss for grid
 * content (numbers and short labels are still very readable).
 *
 * Browser-only. Uses createImageBitmap + OffscreenCanvas (preferred) or a
 * regular HTMLCanvasElement fallback. In test / Node contexts where neither
 * is available, returns the original data URL unchanged — vision routing
 * still works, just without the savings.
 *
 * Quality bias: JPEG output at 0.85 keeps cells crisp while shrinking the
 * payload further. PNG would be lossless but ~3-5× bigger for spreadsheet
 * content (lots of solid color blocks compress fine as JPEG too).
 */

const DEFAULT_MAX_EDGE = 1280;
const JPEG_QUALITY = 0.85;

export async function downscaleImageDataUrl(
  dataUrl: string,
  maxEdge = DEFAULT_MAX_EDGE
): Promise<string> {
  // No-op in Node / test contexts.
  if (typeof globalThis.createImageBitmap !== "function") {
    return dataUrl;
  }

  try {
    const blob = await dataUrlToBlob(dataUrl);
    const bitmap = await createImageBitmap(blob);

    if (bitmap.width <= maxEdge && bitmap.height <= maxEdge) {
      // Already small enough — skip the round-trip.
      bitmap.close?.();
      return dataUrl;
    }

    const scale = maxEdge / Math.max(bitmap.width, bitmap.height);
    const targetW = Math.round(bitmap.width * scale);
    const targetH = Math.round(bitmap.height * scale);

    const canvas: OffscreenCanvas | HTMLCanvasElement =
      typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(targetW, targetH)
        : Object.assign(document.createElement("canvas"), {
            width: targetW,
            height: targetH,
          });
    const ctx = canvas.getContext("2d") as
      | OffscreenCanvasRenderingContext2D
      | CanvasRenderingContext2D
      | null;
    if (!ctx) {
      bitmap.close?.();
      return dataUrl;
    }
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);
    bitmap.close?.();

    if ("convertToBlob" in canvas) {
      const out = await canvas.convertToBlob({
        type: "image/jpeg",
        quality: JPEG_QUALITY,
      });
      return await blobToDataUrl(out);
    }
    return (canvas as HTMLCanvasElement).toDataURL("image/jpeg", JPEG_QUALITY);
  } catch {
    // Any failure: ship the original. Better than crashing the vision call.
    return dataUrl;
  }
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return await res.blob();
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}
