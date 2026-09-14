import { describe, expect, it } from "vitest";
import { createInMemoryConversationStore, type StoredConversation } from "./conversation-store";
import type { TurnItem } from "../../ui/taskpane/chat/useAgentStream";

function convo(
  id: string,
  workbookId: string,
  updatedAt: number,
  items: TurnItem[] = []
): StoredConversation {
  return {
    id,
    workbookId,
    title: `convo ${id}`,
    createdAt: updatedAt,
    updatedAt,
    items,
  };
}

describe("conversation store (in-memory)", () => {
  it("save + load round-trips a conversation", async () => {
    const store = createInMemoryConversationStore();
    const c = convo("c1", "wb-1", 1000, [{ kind: "user", id: "u1", content: "hi" }]);
    await store.save(c);
    const loaded = await store.load("c1");
    expect(loaded).toEqual(c);
  });

  it("load returns null for unknown ids", async () => {
    const store = createInMemoryConversationStore();
    expect(await store.load("nope")).toBeNull();
  });

  it("list returns workbook-scoped conversations newest-first", async () => {
    const store = createInMemoryConversationStore();
    await store.save(convo("a", "wb-1", 100));
    await store.save(convo("b", "wb-1", 300));
    await store.save(convo("c", "wb-1", 200));
    await store.save(convo("d", "wb-2", 999));

    const list = await store.list("wb-1");
    expect(list.map((c) => c.id)).toEqual(["b", "c", "a"]);
  });

  it("list returns [] when no conversations exist for a workbook", async () => {
    const store = createInMemoryConversationStore();
    await store.save(convo("a", "wb-1", 100));
    expect(await store.list("wb-other")).toEqual([]);
  });

  it("latest returns the most recently updated for a workbook", async () => {
    const store = createInMemoryConversationStore();
    await store.save(convo("a", "wb-1", 100));
    await store.save(convo("b", "wb-1", 300));
    const latest = await store.latest("wb-1");
    expect(latest?.id).toBe("b");
  });

  it("latest returns null when there are no conversations", async () => {
    const store = createInMemoryConversationStore();
    expect(await store.latest("wb-1")).toBeNull();
  });

  it("save overwrites by id (same id → upsert, not duplicate)", async () => {
    const store = createInMemoryConversationStore();
    await store.save(convo("c1", "wb-1", 100));
    await store.save(convo("c1", "wb-1", 200));
    const list = await store.list("wb-1");
    expect(list).toHaveLength(1);
    expect(list[0].updatedAt).toBe(200);
  });

  it("delete removes by id", async () => {
    const store = createInMemoryConversationStore();
    await store.save(convo("a", "wb-1", 100));
    await store.delete("a");
    expect(await store.load("a")).toBeNull();
  });

  it("save strips pending / approved tool items (mid-flight state shouldn't persist)", async () => {
    const store = createInMemoryConversationStore();
    const items: TurnItem[] = [
      { kind: "user", id: "u1", content: "go" },
      { kind: "assistant", id: "a1", content: "starting", isStreaming: false },
      {
        kind: "tool",
        id: "t1",
        callId: "c1",
        toolName: "read_range",
        input: {},
        requiredPermission: "Read",
        status: "pending",
      },
      {
        kind: "tool",
        id: "t2",
        callId: "c2",
        toolName: "read_range",
        input: {},
        requiredPermission: "Read",
        status: "result",
        result: { value: 1 },
      },
    ];
    await store.save(convo("c1", "wb-1", 100, items));
    const loaded = await store.load("c1");
    expect(loaded?.items).toHaveLength(3); // pending dropped
    expect(loaded?.items[2]).toMatchObject({ kind: "tool", status: "result" });
  });

  it("save squashes isStreaming on assistant items so loaded conversations don't show as live", async () => {
    const store = createInMemoryConversationStore();
    const items: TurnItem[] = [
      { kind: "user", id: "u1", content: "go" },
      { kind: "assistant", id: "a1", content: "live!", isStreaming: true },
    ];
    await store.save(convo("c1", "wb-1", 100, items));
    const loaded = await store.load("c1");
    expect(loaded?.items[1]).toMatchObject({ kind: "assistant", isStreaming: false });
  });
});
