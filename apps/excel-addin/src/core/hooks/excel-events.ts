import type { ExcelDataSource } from "../context";
import type { HookRegistry } from "./registry";

/**
 * Wire Office.js events to the hook registry so `WorkbookSaved` and
 * `SheetChanged` handlers fire on the right user actions. Returns an
 * unsubscribe function that detaches all listeners (useful when the
 * AppProvider unmounts or hot-reloads).
 *
 * Implementation notes:
 * - Subscribes via the ExcelDataSource's onWorkbookSaved / onSheetChanged
 *   primitives. The Office.js implementation registers against
 *   `Worksheet.onChanged` per-sheet (plus `Worksheets.onAdded` so new
 *   sheets get wired up too); the in-memory implementation is a no-op
 *   list of listeners that tests fire manually via `emitSaved` /
 *   `emitSheetChange`.
 * - The `conversationId` getter is supplied so handlers receive the
 *   active conversation context. AppProvider passes a closure over the
 *   chat hook's current conversationId state.
 *
 * Fire-and-forget: hook firing is awaited inside the callback, but if
 * a handler throws, the registry already converts it to a veto (which
 * is ignored for these event types). We don't surface failures to
 * Office — that would tank the event subscription.
 */
export function attachExcelEventBridge(args: {
  ds: ExcelDataSource;
  hooks: HookRegistry;
  getConversationId: () => string | null;
}): () => void {
  const { ds, hooks, getConversationId } = args;

  const unsubSaved = ds.onWorkbookSaved(() => {
    void hooks.fire({ event: "WorkbookSaved", conversationId: getConversationId() }).catch(() => {
      /* registry already handles handler errors; ignore here */
    });
  });

  const unsubChanged = ds.onSheetChanged((event) => {
    void hooks
      .fire({
        event: "SheetChanged",
        sheetName: event.sheetName,
        address: event.address,
        changeType: event.changeType,
        conversationId: getConversationId(),
      })
      .catch(() => {
        /* same */
      });
  });

  return () => {
    unsubSaved();
    unsubChanged();
  };
}
