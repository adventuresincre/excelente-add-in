import {
  AttachmentPageLimitError,
  AttachmentSizeLimitError,
  PDF_PAGE_LIMIT,
  PDF_PAYLOAD_BYTE_BUDGET,
  type PdfRasterizer,
  type RasterizeOptions,
  type RasterizeProgress,
} from "./types";

/**
 * Production rasterizer. Lazily loads pdfjs-dist + its worker so the chunk
 * isn't pulled into the entry bundle.
 *
 * Default output is JPEG at 0.85 quality — 30–50% the size of PNG for
 * financial-document content (charts + photos) while staying readable for
 * text. Format / quality / scale are configurable per call.
 *
 * Aborts via `AttachmentSizeLimitError` if rendered bytes would exceed
 * `byteBudget` (defaults to 28 MB — slack under OpenRouter's 30 MB cap).
 */
/**
 * Ceiling on rendered canvas area. WebKit (and therefore Excel for Mac,
 * whose WKWebView follows the OS) caps canvas backing stores around 16M
 * pixels; past that `toDataURL` degrades instead of throwing. Chromium is
 * more generous but still finite. Staying under this for every engine costs
 * nothing on ordinary letter/A4 pages, which land near 1.5M pixels at the
 * default scale.
 */
const MAX_CANVAS_PIXELS = 16_000_000;

/** Longest permitted edge, independent of total area. */
const MAX_CANVAS_EDGE = 8_192;

/** A `PdfPageLike` is just the slice of pdf.js's page API we need here. */
interface PdfPageLike {
  getViewport(params: { scale: number }): { width: number; height: number };
}

/**
 * Reduce `scale` until the page fits the canvas budget. Returns `scale`
 * unchanged for ordinary pages.
 */
export function clampScale(page: PdfPageLike, scale: number): number {
  const { width, height } = page.getViewport({ scale });
  if (width <= 0 || height <= 0) return scale;

  const areaFactor = Math.sqrt(MAX_CANVAS_PIXELS / (width * height));
  const edgeFactor = MAX_CANVAS_EDGE / Math.max(width, height);
  const factor = Math.min(1, areaFactor, edgeFactor);
  if (factor >= 1) return scale;
  // Truncate rather than round: the sqrt above lands exactly on the budget,
  // and float error can leave the product a hair OVER it. Being fractionally
  // under the cap costs nothing; being over is the failure this guards.
  return Math.floor(scale * factor * 10_000) / 10_000;
}

/**
 * True when a data URL actually carries image payload. WebKit returns the
 * degenerate `"data:,"` when it cannot serialize a canvas.
 */
export function isUsableImageDataUrl(dataUrl: string): boolean {
  if (!dataUrl.startsWith("data:image/")) return false;
  const commaIdx = dataUrl.indexOf(",");
  if (commaIdx < 0) return false;
  // A real encoded page is kilobytes; anything this small is a failed
  // serialization, not a blank-but-valid page.
  return dataUrl.length - commaIdx - 1 > 128;
}

export function createPdfRasterizer(): PdfRasterizer {
  return {
    async *rasterize(data: ArrayBuffer, opts?: RasterizeOptions): AsyncIterable<RasterizeProgress> {
      // Legacy build, deliberately: the modern build calls
      // Promise.withResolvers() unguarded (Safari 17.4+), which crashes on
      // Excel for Mac whose WKWebView is pinned to the OS WebKit. The
      // legacy build ships its own polyfills and supports the older
      // engines Office actually runs on. Same API surface.
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      // Vite-specific: ?url returns the bundled URL for the worker script.
      //
      // Excel for Mac pins WKWebView to the OS WebKit, and on some versions
      // this worker-URL pattern fails. Don't let that take the whole
      // attachment down: pdf.js falls back to running on the main thread
      // ("fake worker") when no workerSrc resolves, which is slower but
      // correct. Rasterizing a handful of pages inline beats telling the
      // user their PDF is unsupported.
      try {
        const workerUrl = (await import("pdfjs-dist/legacy/build/pdf.worker.mjs?url"))
          .default as string;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      } catch (e) {
        console.warn(
          `PDF worker unavailable, rendering on the main thread instead: ${(e as Error).message}`
        );
      }

      const limit = opts?.maxPages ?? PDF_PAGE_LIMIT;
      const scale = opts?.scale ?? 1.5;
      const format = opts?.format ?? "image/jpeg";
      const quality = opts?.quality ?? 0.85;
      const byteBudget = opts?.byteBudget ?? PDF_PAYLOAD_BYTE_BUDGET;

      const pdf = await pdfjs.getDocument({
        data: new Uint8Array(data),
        disableFontFace: false,
      }).promise;
      const totalPages = pdf.numPages;

      if (totalPages > limit) {
        await pdf.destroy();
        throw new AttachmentPageLimitError(totalPages, limit);
      }

      let accumulatedBytes = 0;
      try {
        for (let n = 1; n <= totalPages; n++) {
          if (opts?.signal?.aborted) {
            throw Object.assign(new Error("PDF rasterization aborted"), {
              name: "AbortError",
            });
          }
          const page = await pdf.getPage(n);
          // Clamp the effective scale so the canvas stays inside browser
          // limits. A large-MediaBox page (site plan, CAD export, poster —
          // all realistic CRE attachments) at scale 1.5 can exceed WebKit's
          // maximum canvas area, and Safari-based engines respond by having
          // `toDataURL` return a degenerate "data:," rather than throwing.
          // That silently yields a BLANK page which the model then analyzes
          // as though it were the document — worse than an error, because
          // nothing looks wrong. Excel for Mac is exactly that engine.
          const viewport = page.getViewport({ scale: clampScale(page, scale) });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Failed to obtain 2D canvas context");
          await page.render({ canvasContext: ctx, viewport }).promise;
          const dataUrl = canvas.toDataURL(format, quality);

          // Belt and braces for the same failure mode: if the engine handed
          // back an empty or degenerate data URL, fail loudly instead of
          // passing a blank image off as the page.
          if (!isUsableImageDataUrl(dataUrl)) {
            throw new Error(
              `Page ${n} of this PDF could not be rendered on this version of Excel ` +
                `(the page is ${Math.round(viewport.width)}×${Math.round(viewport.height)}px ` +
                `after scaling). Try exporting the PDF at a smaller page size, or attach ` +
                `the specific pages you need as images.`
            );
          }

          // Estimate bytes from the base64-encoded data URL. Strip the
          // "data:image/jpeg;base64," prefix and apply the 4:3 base64 ratio.
          const commaIdx = dataUrl.indexOf(",");
          const base64Len = commaIdx >= 0 ? dataUrl.length - commaIdx - 1 : dataUrl.length;
          const pageBytes = Math.floor(base64Len * 0.75);
          accumulatedBytes += pageBytes;

          if (accumulatedBytes > byteBudget) {
            await pdf.destroy();
            throw new AttachmentSizeLimitError(n, totalPages, accumulatedBytes, byteBudget);
          }

          yield { pageNumber: n, totalPages, pngDataUrl: dataUrl };
          page.cleanup();
        }
      } finally {
        await pdf.destroy();
      }
    },
  };
}
