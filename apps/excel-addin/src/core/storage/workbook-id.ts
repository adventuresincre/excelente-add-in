/**
 * Stable-ish identifier for the workbook the add-in is loaded against. Used
 * to scope conversation history per workbook so opening a different file
 * doesn't show conversations from another one.
 *
 * Office.js doesn't expose a true workbook GUID, so we derive an id from
 * `Office.context.document.url` when available. For new untitled workbooks
 * the URL may be empty — those collapse into a shared "untitled" bucket.
 * Acceptable tradeoff for v1; a future improvement is stashing a GUID in
 * the hidden `_excelente` sheet on first conversation so the id survives
 * file moves and renames.
 */
export function getWorkbookId(): string {
  try {
    // Office is provided by the Office.js runtime; defensive in case the
    // module loads before Office is ready.
    const url =
      typeof Office !== "undefined" && Office.context?.document?.url
        ? Office.context.document.url
        : "";
    if (!url) return "<untitled>";
    return url;
  } catch {
    return "<untitled>";
  }
}
