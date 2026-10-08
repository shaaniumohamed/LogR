/**
 * Downloaded market data files, kept in the browser.
 *
 * Files are immutable — a changed file gets a new content hash — so the hash
 * is the key and nothing can ever be served stale. Kept in IndexedDB because a
 * day of ticks is half a megabyte and a backtest session reads many; the
 * second visit to the same week should not touch the network at all.
 *
 * Everything degrades to "not cached": private browsing, a full disk or a
 * browser that refuses storage all just mean downloading again.
 */

const DB = "logr-market";
const STORE = "chunks";
/** Past this the least recently used files are dropped. */
const BUDGET_BYTES = 400 * 1024 * 1024;

interface Entry { sha: string; data: ArrayBuffer; size: number; at: number }

let opening: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (opening) return opening;
  opening = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: "sha" });
        store.createIndex("at", "at");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

const done = <T,>(req: IDBRequest<T>) => new Promise<T>((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

export async function cacheGet(sha: string): Promise<Uint8Array | null> {
  try {
    const db = await open();
    if (!db) return null;
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const hit = await done(store.get(sha) as IDBRequest<Entry | undefined>);
    if (!hit) return null;
    store.put({ ...hit, at: Date.now() });
    return new Uint8Array(hit.data);
  } catch {
    return null;
  }
}

export async function cachePut(sha: string, data: Uint8Array): Promise<void> {
  try {
    const db = await open();
    if (!db) return;
    const copy = data.slice().buffer as ArrayBuffer;
    await done(db.transaction(STORE, "readwrite").objectStore(STORE).put({ sha, data: copy, size: copy.byteLength, at: Date.now() } satisfies Entry));
    void prune(db);
  } catch {
    /* not cached — fine */
  }
}

let pruning = false;
async function prune(db: IDBDatabase) {
  if (pruning) return;
  pruning = true;
  try {
    const all = await done(db.transaction(STORE).objectStore(STORE).index("at").getAll() as IDBRequest<Entry[]>);
    let total = all.reduce((s, e) => s + e.size, 0);
    if (total <= BUDGET_BYTES) return;
    const tx = db.transaction(STORE, "readwrite");
    for (const e of all) { // oldest first
      if (total <= BUDGET_BYTES * 0.8) break;
      tx.objectStore(STORE).delete(e.sha);
      total -= e.size;
    }
  } catch {
    /* ignore */
  } finally {
    pruning = false;
  }
}
