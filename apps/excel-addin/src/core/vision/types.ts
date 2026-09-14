/**
 * Hard cap on PDF page count. PDFs above this are rejected before rendering
 * to protect the user from accidental token blowouts (100 pages at 1.5×
 * scale is already a substantial cost).
 */
export const PDF_PAGE_LIMIT = 100;

/**
 * OpenRouter rejects requests whose downloaded image content exceeds 30 MB.
 * We size each PDF in-flight and abort if it would cross this threshold so
 * the user gets a useful error before the network round-trip 413s.
 */
export const PDF_PAYLOAD_BYTE_BUDGET = 28 * 1024 * 1024; // 28 MB, slack for text + JSON wrapper

/**
 * Cap on a single pasted/attached image.
 *
 * The PDF path has had a byte budget from the start; the image path had
 * none, and the consequence is worse than a rejected upload. An oversized
 * image becomes ~33% more base64 in the message content, the provider
 * rejects the request — and because the attachment lives in conversation
 * history, EVERY subsequent turn re-sends it and fails identically. The
 * chat is wedged with no way back except starting over.
 *
 * Sized well under the PDF budget: an image this large is already far past
 * what any model resolves usefully, and Excel for Mac's WKWebView is the
 * tightest memory environment we ship into.
 */
export const IMAGE_BYTE_LIMIT = 8 * 1024 * 1024; // 8 MB

/** JPEG or PNG data URL ("data:image/jpeg;base64,..."). */
export type PngDataUrl = string;

/** Thrown when a single attached image exceeds {@link IMAGE_BYTE_LIMIT}. */
export class ImageSizeLimitError extends Error {
  constructor(
    public readonly actualBytes: number,
    public readonly limit: number,
    public readonly filename?: string
  ) {
    const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)}MB`;
    super(
      `${filename ? `"${filename}"` : "That image"} is ${mb(actualBytes)}, over the ${mb(limit)} ` +
        `limit for a single image. Resize or crop it and attach it again.`
    );
    this.name = "ImageSizeLimitError";
  }
}

export interface RasterizeOptions {
  /** Render scale. Higher = sharper but bigger tokens. Default 1.5. */
  scale?: number;
  /** Override the default 100-page limit (only for tests). */
  maxPages?: number;
  /** Output mime: "image/jpeg" (default, smaller) or "image/png" (lossless). */
  format?: "image/jpeg" | "image/png";
  /** JPEG quality [0, 1]. Default 0.85. Ignored for PNG. */
  quality?: number;
  /** Abort if accumulated page bytes exceed this. Default ~28 MB. */
  byteBudget?: number;
  signal?: AbortSignal;
}

export interface RasterizeProgress {
  pageNumber: number;
  totalPages: number;
  pngDataUrl: PngDataUrl;
}

/**
 * Production implementation wraps pdfjs-dist; tests inject a stub.
 */
export interface PdfRasterizer {
  /** Yields one progress event per rendered page. */
  rasterize(data: ArrayBuffer, opts?: RasterizeOptions): AsyncIterable<RasterizeProgress>;
}

export class AttachmentPageLimitError extends Error {
  constructor(
    public readonly actualPageCount: number,
    public readonly limit: number,
    public readonly filename?: string
  ) {
    super(
      `${filename ? `"${filename}" has ` : "PDF has "}${actualPageCount} pages, which exceeds the ${limit}-page limit. Please split or trim the document and try again.`
    );
    this.name = "AttachmentPageLimitError";
  }
}

/**
 * Thrown when accumulated rendered page bytes would exceed the configured
 * byte budget (OpenRouter's 30 MB image-content cap minus slack). Distinct
 * from `AttachmentPageLimitError` so the UI can suggest different remedies
 * (split / trim image-heavy pages vs. reduce page count).
 */
export class AttachmentSizeLimitError extends Error {
  constructor(
    public readonly pageReached: number,
    public readonly totalPages: number,
    public readonly accumulatedBytes: number,
    public readonly budget: number,
    public readonly filename?: string
  ) {
    const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)}MB`;
    const head = filename ? `"${filename}" is too large` : "PDF is too large";
    super(
      `${head} for the model: rendered ${pageReached} of ${totalPages} pages and hit ${mb(accumulatedBytes)} (limit ${mb(budget)}). ` +
        `Try splitting the PDF, removing image-heavy pages, or sending fewer pages at a time.`
    );
    this.name = "AttachmentSizeLimitError";
  }
}
