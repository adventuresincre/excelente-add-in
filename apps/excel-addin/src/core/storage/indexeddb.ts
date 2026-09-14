/**
 * Shared IndexedDB connection handling.
 *
 * Office WebViews (especially Excel for Mac WKWebView) close IDB handles
 * when the pane is backgrounded. Caching the open promise forever then
 * turns a transient close into permanent failure: every later
 * `transaction()` throws "The database connection is closing."
 *
 * Callers get a fresh handle after `onclose` / `onversionchange`, and one
 * retry if a transaction still hits a closing connection.
 */

export function isIndexedDbClosingError(e: unknown): boolean {
  const name =
    typeof e === "object" && e !== null && "name" in e ? String((e as { name: unknown }).name) : "";
  const msg = e instanceof Error ? e.message : String(e);
  return name === "InvalidStateError" || /connection is closing/i.test(msg);
}

export interface IndexedDbAccessor {
  /** Open (or reuse) the database, then return the named object store. */
  objectStore(mode: IDBTransactionMode): Promise<IDBObjectStore>;
  /** Drop the cached handle so the next call reopens. */
  dropHandle(): void;
}

export interface IndexedDbAccessorOptions {
  name: string;
  version: number;
  storeName: string;
  upgrade: (db: IDBDatabase) => void;
  blockedMessage?: string;
}

export function createIndexedDbAccessor(opts: IndexedDbAccessorOptions): IndexedDbAccessor {
  let dbPromise: Promise<IDBDatabase> | null = null;

  function dropHandle(): void {
    dbPromise = null;
  }

  function getDb(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;
    if (typeof indexedDB === "undefined") {
      return Promise.reject(new Error("IndexedDB is not available in this environment"));
    }
    const blocked = opts.blockedMessage ?? "IndexedDB open blocked by another connection";
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(opts.name, opts.version);
      req.onupgradeneeded = () => opts.upgrade(req.result);
      req.onsuccess = () => {
        const db = req.result;
        db.onclose = () => dropHandle();
        db.onversionchange = () => {
          db.close();
          dropHandle();
        };
        resolve(db);
      };
      req.onerror = () => {
        dropHandle();
        reject(req.error ?? new Error("IndexedDB open failed"));
      };
      req.onblocked = () => {
        dropHandle();
        reject(new Error(blocked));
      };
    });
    return dbPromise;
  }

  async function objectStore(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const open = async () => {
      const db = await getDb();
      return db.transaction(opts.storeName, mode).objectStore(opts.storeName);
    };
    try {
      return await open();
    } catch (e) {
      if (!isIndexedDbClosingError(e)) throw e;
      dropHandle();
      return await open();
    }
  }

  return { objectStore, dropHandle };
}
