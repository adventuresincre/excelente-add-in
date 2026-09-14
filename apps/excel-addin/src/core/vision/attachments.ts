import type { ContentPart } from "../openrouter";
import type { PngDataUrl } from "./types";

/**
 * A user-facing attachment after preparation.
 * - `image` → one page (the image data URL).
 * - `pdf` → one page per rasterized PDF page.
 * - `spreadsheet` → text path: CSV-per-sheet content, no image pages.
 * - `spreadsheet-inserted` → insert path: a pointer note telling the
 *   agent which worksheets were added to the live workbook (the data is
 *   in the workbook, not in the message).
 */
export interface PreparedAttachment {
  /** Source kind. */
  kind: "image" | "pdf" | "spreadsheet" | "spreadsheet-inserted";
  /** Original filename, for display in the UI / agent context. */
  filename: string;
  /** PNG data URLs the model will consume (image / pdf only). */
  pages: PngDataUrl[];
  /** Convenience: pages.length. */
  pageCount: number;
  /** Text path: the rendered CSV-per-sheet content injected into the message. */
  csvText?: string;
  /** Insert path: names of worksheets inserted into the live workbook. */
  insertedSheets?: string[];
}

/**
 * Compose a user message's `content` array from text + prepared attachments.
 * - When there are no attachments, returns a plain string (matches the
 *   simpler ChatMessage.content shape).
 * - When there ARE attachments, returns a ContentPart[] suitable for
 *   OpenRouter chat completions.
 */
export function buildUserContent(
  text: string,
  attachments: PreparedAttachment[]
): string | ContentPart[] {
  const trimmed = text.trim();
  if (attachments.length === 0) {
    return trimmed;
  }

  const parts: ContentPart[] = [];

  // Lead with text so the model anchors on the user's question before
  // scanning images.
  if (trimmed.length > 0) {
    parts.push({ type: "text", text: trimmed });
  }

  for (const att of attachments) {
    if (att.kind === "spreadsheet") {
      // Text path — inject the CSV content directly. No image pages.
      parts.push({
        type: "text",
        text: `\n${att.csvText ?? `[Attached spreadsheet "${att.filename}"]`}`,
      });
      continue;
    }
    if (att.kind === "spreadsheet-inserted") {
      // Insert path — the data lives in the workbook now. Point the agent
      // at the inserted sheets so it reads them with inspect_workbook.
      const names = (att.insertedSheets ?? []).map((n) => `"${n}"`).join(", ");
      parts.push({
        type: "text",
        text: `\n[Inserted worksheets from "${att.filename}" into the workbook: ${names}. Read them with inspect_workbook to use their data.]`,
      });
      continue;
    }
    if (att.kind === "pdf") {
      // Mark page boundaries inline so the model knows page-level context.
      parts.push({
        type: "text",
        text: `\n[Attached PDF "${att.filename}" — ${att.pageCount} pages follow]`,
      });
    } else {
      parts.push({
        type: "text",
        text: `\n[Attached image "${att.filename}"]`,
      });
    }
    for (const url of att.pages) {
      parts.push({ type: "image_url", image_url: { url } });
    }
  }

  return parts;
}
