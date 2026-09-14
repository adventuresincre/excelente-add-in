import { describe, expect, it, vi } from "vitest";
import { inMemoryDataSource } from "../context";
import { attachExcelEventBridge } from "./excel-events";
import { createHookRegistry } from "./registry";

describe("attachExcelEventBridge", () => {
  it("fires WorkbookSaved with conversation context when ds.emitSaved() runs", async () => {
    const ds = inMemoryDataSource({ sheets: [{ name: "Sheet1" }] });
    const hooks = createHookRegistry();
    const handler = vi.fn();
    hooks.on("WorkbookSaved", handler);

    attachExcelEventBridge({
      ds,
      hooks,
      getConversationId: () => "conv-7",
    });

    ds.emitSaved();
    // Hook firing is async (registry.fire returns a Promise) — give the
    // microtask queue a tick to drain so the assertion sees the call.
    await Promise.resolve();
    await Promise.resolve();

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0]).toMatchObject({
      event: "WorkbookSaved",
      conversationId: "conv-7",
    });
  });

  it("fires SheetChanged with sheet + address + changeType + conversation id", async () => {
    const ds = inMemoryDataSource({ sheets: [{ name: "Sheet1" }] });
    const hooks = createHookRegistry();
    const handler = vi.fn();
    hooks.on("SheetChanged", handler);

    attachExcelEventBridge({
      ds,
      hooks,
      getConversationId: () => "conv-3",
    });

    ds.emitSheetChange({
      sheetName: "Sheet1",
      address: "B2:C4",
      changeType: "RangeEdited",
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0]).toMatchObject({
      event: "SheetChanged",
      sheetName: "Sheet1",
      address: "B2:C4",
      changeType: "RangeEdited",
      conversationId: "conv-3",
    });
  });

  it("returns an unsubscribe that detaches both listeners", async () => {
    const ds = inMemoryDataSource({ sheets: [{ name: "Sheet1" }] });
    const hooks = createHookRegistry();
    const handler = vi.fn();
    hooks.on("WorkbookSaved", handler);
    hooks.on("SheetChanged", handler);

    const detach = attachExcelEventBridge({
      ds,
      hooks,
      getConversationId: () => null,
    });

    detach();

    ds.emitSaved();
    ds.emitSheetChange({ sheetName: "Sheet1", address: "A1" });
    await Promise.resolve();
    await Promise.resolve();

    expect(handler).not.toHaveBeenCalled();
  });

  it("passes null conversation id when no chat is active", async () => {
    const ds = inMemoryDataSource({ sheets: [{ name: "Sheet1" }] });
    const hooks = createHookRegistry();
    const handler = vi.fn();
    hooks.on("SheetChanged", handler);

    attachExcelEventBridge({
      ds,
      hooks,
      getConversationId: () => null,
    });

    ds.emitSheetChange({ sheetName: "Sheet1", address: "A1" });
    await Promise.resolve();
    await Promise.resolve();

    expect(handler.mock.calls[0][0]).toMatchObject({ conversationId: null });
  });
});
