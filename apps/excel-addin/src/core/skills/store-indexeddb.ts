import { createIndexedDbAccessor } from "../storage/indexeddb";
import type { SkillStore, StoredSkill } from "./store";

const DB_NAME = "excelente-skills";
const DB_VERSION = 1;
const STORE_NAME = "skills";

/**
 * Production `SkillStore` backed by IndexedDB. Database `excelente-skills`,
 * object store `skills` keyed by `name`. The DB handle is reopened after
 * the WebView closes it (see `createIndexedDbAccessor`).
 *
 * Throws if `indexedDB` is unavailable on `globalThis` — callers should fall
 * back to the in-memory impl in that case.
 */
export function createIndexedDbSkillStore(): SkillStore {
  const db = createIndexedDbAccessor({
    name: DB_NAME,
    version: DB_VERSION,
    storeName: STORE_NAME,
    upgrade: (database) => {
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "name" });
      }
    },
  });

  function tx(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    return db.objectStore(mode);
  }

  return {
    async list() {
      const store = await tx("readonly");
      return new Promise<StoredSkill[]>((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve((req.result as StoredSkill[]) ?? []);
        req.onerror = () => reject(req.error ?? new Error("getAll failed"));
      });
    },
    async get(name) {
      const store = await tx("readonly");
      return new Promise<StoredSkill | null>((resolve, reject) => {
        const req = store.get(name);
        req.onsuccess = () => resolve((req.result as StoredSkill | undefined) ?? null);
        req.onerror = () => reject(req.error ?? new Error("get failed"));
      });
    },
    async put(skill) {
      const store = await tx("readwrite");
      return new Promise<void>((resolve, reject) => {
        const req = store.put(skill);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error ?? new Error("put failed"));
      });
    },
    async delete(name) {
      const store = await tx("readwrite");
      return new Promise<void>((resolve, reject) => {
        const req = store.delete(name);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error ?? new Error("delete failed"));
      });
    },
  };
}
