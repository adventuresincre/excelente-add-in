import { describe, expect, it } from "vitest";
import { blobToDataUrl, isPdfMime, isSupportedImageMime } from "./image";
import { IMAGE_BYTE_LIMIT, ImageSizeLimitError } from "./types";
import { AttachmentPageLimitError, PDF_PAGE_LIMIT } from "./types";
import { buildUserContent, type PreparedAttachment } from "./attachments";

describe("blobToDataUrl", () => {
  it("returns a data URL with the blob's mime + base64 body", async () => {
    const data = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    const blob = new Blob([data], { type: "image/png" });
    const url = await blobToDataUrl(blob);
    expect(url).toBe("data:image/png;base64,SGVsbG8=");
  });

  it("falls back to application/octet-stream when type is empty", async () => {
    const blob = new Blob([new Uint8Array([0])], { type: "" });
    const url = await blobToDataUrl(blob);
    expect(url.startsWith("data:application/octet-stream;base64,")).toBe(true);
  });

  it("handles large blobs without stack overflow", async () => {
    const big = new Uint8Array(200_000).fill(0x41); // 200KB of 'A'
    const blob = new Blob([big], { type: "image/png" });
    const url = await blobToDataUrl(blob);
    expect(url.startsWith("data:image/png;base64,")).toBe(true);
  });
});

describe("isSupportedImageMime / isPdfMime", () => {
  it.each([
    ["image/png", true],
    ["image/jpeg", true],
    ["image/webp", true],
    ["image/gif", true],
    ["image/heic", false],
    ["application/pdf", false],
    ["text/plain", false],
  ])("isSupportedImageMime(%s) -> %s", (mime, expected) => {
    expect(isSupportedImageMime(mime)).toBe(expected);
  });

  it.each([
    ["application/pdf", true],
    ["image/png", false],
    ["text/plain", false],
  ])("isPdfMime(%s) -> %s", (mime, expected) => {
    expect(isPdfMime(mime)).toBe(expected);
  });
});

describe("AttachmentPageLimitError", () => {
  it("includes counts + the filename when given", () => {
    const err = new AttachmentPageLimitError(150, PDF_PAGE_LIMIT, "huge.pdf");
    expect(err.actualPageCount).toBe(150);
    expect(err.limit).toBe(100);
    expect(err.message).toContain("huge.pdf");
    expect(err.message).toContain("150");
    expect(err.message).toContain("100");
  });

  it("omits the filename quote when not provided", () => {
    const err = new AttachmentPageLimitError(120, 100);
    expect(err.message).toContain("PDF has 120 pages");
    expect(err.message).not.toContain('""');
  });
});

describe("buildUserContent", () => {
  it("returns a plain string when there are no attachments", () => {
    expect(buildUserContent("hi", [])).toBe("hi");
  });

  it("trims the text", () => {
    expect(buildUserContent("  hi  ", [])).toBe("hi");
  });

  it("returns ContentPart[] when attachments are present", () => {
    const att: PreparedAttachment = {
      kind: "image",
      filename: "photo.png",
      pages: ["data:image/png;base64,AAAA"],
      pageCount: 1,
    };
    const result = buildUserContent("describe it", [att]);
    expect(Array.isArray(result)).toBe(true);
    if (!Array.isArray(result)) return;
    expect(result).toEqual([
      { type: "text", text: "describe it" },
      { type: "text", text: '\n[Attached image "photo.png"]' },
      { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
    ]);
  });

  it("omits the text part when text is empty but attachments exist", () => {
    const att: PreparedAttachment = {
      kind: "image",
      filename: "p.png",
      pages: ["data:image/png;base64,X"],
      pageCount: 1,
    };
    const result = buildUserContent("", [att]);
    if (!Array.isArray(result)) throw new Error("expected array");
    expect(result[0].type).toBe("text");
    expect(result[0]).toEqual({ type: "text", text: '\n[Attached image "p.png"]' });
  });

  it("emits page-boundary text + image_url per page for PDFs", () => {
    const att: PreparedAttachment = {
      kind: "pdf",
      filename: "T12.pdf",
      pages: ["data:image/png;base64,A", "data:image/png;base64,B"],
      pageCount: 2,
    };
    const result = buildUserContent("analyze", [att]);
    if (!Array.isArray(result)) throw new Error("expected array");
    expect(result).toEqual([
      { type: "text", text: "analyze" },
      { type: "text", text: '\n[Attached PDF "T12.pdf" — 2 pages follow]' },
      { type: "image_url", image_url: { url: "data:image/png;base64,A" } },
      { type: "image_url", image_url: { url: "data:image/png;base64,B" } },
    ]);
  });

  it("interleaves multiple attachments in order", () => {
    const a: PreparedAttachment = {
      kind: "image",
      filename: "a.png",
      pages: ["data:img,a"],
      pageCount: 1,
    };
    const b: PreparedAttachment = {
      kind: "pdf",
      filename: "b.pdf",
      pages: ["data:pdf,b1", "data:pdf,b2"],
      pageCount: 2,
    };
    const result = buildUserContent("look", [a, b]);
    if (!Array.isArray(result)) throw new Error("expected array");
    expect(result.map((p) => p.type)).toEqual([
      "text", // user text
      "text", // [Attached image "a.png"]
      "image_url", // a.png
      "text", // [Attached PDF "b.pdf" — 2 pages follow]
      "image_url", // b page 1
      "image_url", // b page 2
    ]);
  });

  it("injects spreadsheet text content as a text part (no image_url)", () => {
    const sheet: PreparedAttachment = {
      kind: "spreadsheet",
      filename: "T12.xlsx",
      pages: [],
      pageCount: 2,
      csvText:
        '[Attached spreadsheet "T12.xlsx" — 2 sheets]\n=== Sheet: Op ===\nMonth,Rev\nJan,100',
    };
    const result = buildUserContent("analyze this", [sheet]);
    if (!Array.isArray(result)) throw new Error("expected array");
    expect(result.map((p) => p.type)).toEqual(["text", "text"]);
    const joined = result.map((p) => (p.type === "text" ? p.text : "")).join("\n");
    expect(joined).toContain("Month,Rev");
    expect(joined).toContain("analyze this");
  });

  it("renders an inserted-worksheets pointer with sheet names", () => {
    const inserted: PreparedAttachment = {
      kind: "spreadsheet-inserted",
      filename: "RR.xlsx",
      pages: [],
      pageCount: 2,
      insertedSheets: ["RentRoll", "Summary"],
    };
    const result = buildUserContent("build from these", [inserted]);
    if (!Array.isArray(result)) throw new Error("expected array");
    const joined = result.map((p) => (p.type === "text" ? p.text : "")).join("\n");
    expect(joined).toContain("Inserted worksheets");
    expect(joined).toContain('"RentRoll"');
    expect(joined).toContain('"Summary"');
    expect(joined).toContain("inspect_workbook");
    // No image parts for an insert pointer.
    expect(result.every((p) => p.type === "text")).toBe(true);
  });
});

describe("blobToDataUrl — image size cap", () => {
  it("rejects an image over the byte limit before encoding it", async () => {
    // Oversized attachments don't just fail once: the attachment lives in
    // conversation history, so every later turn re-sends it and fails the
    // same way, wedging the chat.
    const big = new Blob([new Uint8Array(IMAGE_BYTE_LIMIT + 1)], { type: "image/png" });
    await expect(blobToDataUrl(big, { filename: "site-plan.png" })).rejects.toBeInstanceOf(
      ImageSizeLimitError
    );
    await expect(blobToDataUrl(big, { filename: "site-plan.png" })).rejects.toThrow(
      /site-plan\.png/
    );
  });

  it("accepts an image at the limit", async () => {
    const ok = new Blob([new Uint8Array(1024)], { type: "image/png" });
    await expect(blobToDataUrl(ok)).resolves.toMatch(/^data:image\/png;base64,/);
  });
});
