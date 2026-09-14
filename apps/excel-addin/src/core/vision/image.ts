import { IMAGE_BYTE_LIMIT, ImageSizeLimitError, type PngDataUrl } from "./types";

/**
 * Read a Blob into a data URL ("data:<mime>;base64,..."). Works in both
 * the browser (Office.js taskpane) and Node (vitest). Uses `arrayBuffer()`
 * which is available in both environments, avoiding the missing-FileReader
 * gap in Node.
 *
 * Rejects oversized input BEFORE encoding: base64 inflates the payload by a
 * third, and an image too big for the provider poisons every later turn of
 * the conversation, not just the one it was attached to. See
 * {@link IMAGE_BYTE_LIMIT}.
 */
export async function blobToDataUrl(
  file: Blob,
  opts: { maxBytes?: number; filename?: string } = {}
): Promise<PngDataUrl> {
  const maxBytes = opts.maxBytes ?? IMAGE_BYTE_LIMIT;
  if (file.size > maxBytes) {
    throw new ImageSizeLimitError(file.size, maxBytes, opts.filename);
  }
  const buf = await file.arrayBuffer();
  const mime = file.type || "application/octet-stream";
  return `data:${mime};base64,${arrayBufferToBase64(buf)}`;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  // Chunk to avoid blowing the call-stack on big arrays via spread.
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(slice));
  }
  // btoa is available in browsers (always) and Node 16+ (we're on Node 22).
  return btoa(binary);
}

const IMAGE_MIME_PREFIXES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export function isSupportedImageMime(mime: string): boolean {
  return IMAGE_MIME_PREFIXES.some((p) => mime.startsWith(p));
}

export function isPdfMime(mime: string): boolean {
  return mime === "application/pdf" || mime.startsWith("application/pdf");
}
