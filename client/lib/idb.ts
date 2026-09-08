/**
 * Account-scoped IndexedDB wrapper for Sakhya E2EE state.
 *
 * IMPORTANT: crypto identity/session material is per Sakhya account, not per
 * browser profile. Older builds used one global database (sakhya-crypto),
 * which caused two accounts used in the same browser to share an Olm account.
 * This build deliberately uses a new database namespace so stale v1/v3 code
 * cannot downgrade/open this database, and each logged-in account gets an
 * isolated key store.
 */

const DB_PREFIX = "sakhya-crypto-v2:";
const DB_VERSION = 1;
const STORE = "kv";
let activeUserId: string | null = null;

function getDbName(): string {
  if (!activeUserId) {
    throw new Error("Sakhya encryption account is not initialized yet. Please reload and sign in again.");
  }
  // User IDs are server-generated UUIDs. Keep the DB name conservative anyway.
  const safe = activeUserId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${DB_PREFIX}${safe}`;
}

/** Select the account whose private E2EE material this browser may access. */
export function setIdbUserScope(userId: string | null): void {
  activeUserId = userId || null;
}

export function getIdbUserScope(): string | null {
  return activeUserId;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this environment"));
      return;
    }

    const req = indexedDB.open(getDbName(), DB_VERSION);
    req.onblocked = () => reject(new Error("Sakhya crypto database upgrade is blocked by another tab"));
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function idbGet<T = string>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
  });
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error || new Error("IndexedDB transaction aborted")); };
  });
}

export async function idbDelete(key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error || new Error("IndexedDB transaction aborted")); };
  });
}

/** Wipe only the currently selected account's local key material. */
export async function idbClearAll(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error || new Error("IndexedDB transaction aborted")); };
  });
}
