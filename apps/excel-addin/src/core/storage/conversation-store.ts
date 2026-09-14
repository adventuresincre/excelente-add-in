import type { TurnItem } from "../../ui/taskpane/chat/useAgentStream";
import { createIndexedDbAccessor } from "./indexeddb";

/**
 * A persisted conversation. Stored as JSON — `TurnItem[]` round-trips
 * because it's already data-shaped (no functions, no React refs). The
 * isStreaming flag on assistant items gets squashed to `false` on save
 * (see ConversationStore.save), and pending / approved tool items are
 * dropped (they're mid-flight and don't belong in a saved snapshot).
 */
export interface StoredConversation {
  /** Stable UUID minted when the conversation first lands a user message. */
  id: string;
  /**
   * Workbook this conversation belongs to. Conversations are scoped per
   * workbook in the History view; an empty string means "untitled / no
   * stable identifier available."
   */
  workbookId: string;
  /** Short title — derived from the first user message at save time. */
  title: string;
  /** Epoch ms — set on first save. */
  createdAt: number;
  /** Epoch ms — bumped on every save. */
  updatedAt: number;
  items: TurnItem[];
}

export interface ConversationStore {
  /** All conversations for a workbook, newest first. Frontmatter-only is
   * cheaper but TurnItem[] is small enough to ship in the list — keeps the
   * History panel simple. */
  list(workbookId: string): Promise<StoredConversation[]>;
  /** Load a single conversation by id, or null if not found. */
  load(id: string): Promise<StoredConversation | null>;
  /**
   * Insert or update a conversation. Caller supplies createdAt / updatedAt;
   * the store doesn't second-guess timestamps so tests stay deterministic.
   */
  save(c: StoredConversation): Promise<void>;
  delete(id: string): Promise<void>;
  /** Convenience — load the most-recently-updated conversation for the
   * given workbook, or null if there are none. Used on app startup to
   * restore the user's last session automatically. */
  latest(workbookId: string): Promise<StoredConversation | null>;
}

const DB_NAME = "excelente-conversations";
const DB_VERSION = 1;
const STORE_NAME = "conversations";
const WORKBOOK_INDEX = "workbookId";

/**
 * Production `ConversationStore` backed by IndexedDB.
 *
 * Schema: object store `conversations` keyed by `id`, with an index on
 * `workbookId` so list / latest stay O(n) per workbook instead of O(n)
 * across all conversations.
 *
 * Throws if `indexedDB` is unavailable — callers should fall back to the
 * in-memory impl.
 */
export function createIndexedDbConversationStore(): ConversationStore {
  const db = createIndexedDbAccessor({
    name: DB_NAME,
    version: DB_VERSION,
    storeName: STORE_NAME,
    upgrade: (database) => {
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex(WORKBOOK_INDEX, "workbookId", { unique: false });
      }
    },
  });

  function tx(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    return db.objectStore(mode);
  }

  return {
    async list(workbookId) {
      const store = await tx("readonly");
      return new Promise<StoredConversation[]>((resolve, reject) => {
        const req = store.index(WORKBOOK_INDEX).getAll(workbookId);
        req.onsuccess = () => {
          const rows = (req.result as StoredConversation[]) ?? [];
          rows.sort((a, b) => b.updatedAt - a.updatedAt);
          resolve(rows);
        };
        req.onerror = () => reject(req.error ?? new Error("getAll failed"));
      });
    },

    async load(id) {
      const store = await tx("readonly");
      return new Promise<StoredConversation | null>((resolve, reject) => {
        const req = store.get(id);
        req.onsuccess = () => resolve((req.result as StoredConversation) ?? null);
        req.onerror = () => reject(req.error ?? new Error("get failed"));
      });
    },

    async save(c) {
      const sanitized = sanitizeForStorage(c);
      const store = await tx("readwrite");
      return new Promise<void>((resolve, reject) => {
        const req = store.put(sanitized);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error ?? new Error("put failed"));
      });
    },

    async delete(id) {
      const store = await tx("readwrite");
      return new Promise<void>((resolve, reject) => {
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error ?? new Error("delete failed"));
      });
    },

    async latest(workbookId) {
      const all = await this.list(workbookId);
      return all[0] ?? null;
    },
  };
}

/**
 * In-memory implementation for tests + environments without IndexedDB.
 * Behavior matches the IndexedDB impl: same sort order, same return shapes,
 * same sanitization on save.
 */
export function createInMemoryConversationStore(): ConversationStore {
  const rows = new Map<string, StoredConversation>();

  return {
    async list(workbookId) {
      return Array.from(rows.values())
        .filter((c) => c.workbookId === workbookId)
        .sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async load(id) {
      return rows.get(id) ?? null;
    },
    async save(c) {
      rows.set(c.id, sanitizeForStorage(c));
    },
    async delete(id) {
      rows.delete(id);
    },
    async latest(workbookId) {
      const all = await this.list(workbookId);
      return all[0] ?? null;
    },
  };
}

/**
 * Strip ephemeral UI state from a conversation before persisting:
 * - Assistant items keep their text + reasoning but always serialize with
 *   isStreaming: false (a loaded conversation isn't actively streaming).
 * - Tool items with non-terminal status (pending / approved) drop out —
 *   they were mid-flight when the snapshot ran and don't carry meaningful
 *   recoverable state.
 *
 * Returns a shallow-cloned StoredConversation; never mutates the input.
 */
function sanitizeForStorage(c: StoredConversation): StoredConversation {
  const items = c.items
    .filter((it) => {
      if (it.kind !== "tool") return true;
      return it.status === "result" || it.status === "error" || it.status === "rejected";
    })
    .map((it) => {
      if (it.kind === "assistant" && it.isStreaming) {
        return { ...it, isStreaming: false };
      }
      return it;
    });
  return { ...c, items };
}
