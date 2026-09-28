/* ═══════════════ LOCAL STORAGE — IndexedDB (spec §3) ═══════════════
   Nothing is ever overwritten. Every write appends a *version* row keyed by a
   client-generated uuid (`vid`); the current state of an entity is its newest
   version. Two devices can therefore sync in any order without duplicating or
   silently losing anything, and a write never waits for the network.        */

export const STORES = {
  day_versions:           { key: 'date' },
  tx_versions:            { key: 'tx_id' },
  debt_account_versions:  { key: 'account_id' },
  debt_entry_versions:    { key: 'entry_id' },
  commission_versions:    { key: 'commission_id' },
};
export const STORE_NAMES = Object.keys(STORES);

const DB_NAME = 'momo_booth_ledger';
const DB_VERSION = 1;
let _db = null;

export function open() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORE_NAMES) {
        if (db.objectStoreNames.contains(name)) continue;
        const os = db.createObjectStore(name, { keyPath: 'vid' });
        os.createIndex('entity', STORES[name].key);
        os.createIndex('pending', 'pending');       // 1 = not yet acknowledged by the server
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'k' });
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(names, mode) {
  const t = _db.transaction(names, mode);
  const done = new Promise((res, rej) => { t.oncomplete = res; t.onerror = t.onabort = () => rej(t.error); });
  return { t, done };
}
const wrap = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

/* Append versions locally. `pending` marks them for the next sync push. */
export async function append(store, versions, { pending = true } = {}) {
  await open();
  const rows = (Array.isArray(versions) ? versions : [versions]).map((v) => ({ ...v, pending: pending ? 1 : 0 }));
  const { t, done } = tx([store], 'readwrite');
  const os = t.objectStore(store);
  for (const r of rows) os.put(r);
  await done;
  return rows;
}

export async function all(store) { await open(); const { t } = tx([store], 'readonly'); return wrap(t.objectStore(store).getAll()); }

export async function loadAll() {
  await open();
  const { t } = tx(STORE_NAMES, 'readonly');
  const out = {};
  await Promise.all(STORE_NAMES.map(async (n) => { out[n] = await wrap(t.objectStore(n).getAll()); }));
  return out;
}

export async function pending(store) {
  await open();
  const { t } = tx([store], 'readonly');
  return wrap(t.objectStore(store).index('pending').getAll(1));
}

export async function markSynced(store, vids) {
  await open();
  const { t, done } = tx([store], 'readwrite');
  const os = t.objectStore(store);
  for (const vid of vids) {
    const req = os.get(vid);
    req.onsuccess = () => { const row = req.result; if (row) os.put({ ...row, pending: 0 }); };
  }
  await done;
}

/* Rows pulled from the server are stored as already-synced. Existing vids are
   left untouched: the same version arriving twice is a no-op. */
export async function mergeRemote(store, rows) {
  await open();
  if (!rows.length) return 0;
  const { t, done } = tx([store], 'readwrite');
  const os = t.objectStore(store);
  let added = 0;
  for (const r of rows) {
    const req = os.get(r.vid);
    req.onsuccess = () => { if (!req.result) { os.put({ ...r, pending: 0 }); added++; } };
  }
  await done;
  return added;
}

export async function getMeta(k, fallback = null) {
  await open();
  const { t } = tx(['meta'], 'readonly');
  const row = await wrap(t.objectStore('meta').get(k));
  return row === undefined ? fallback : row.v;
}
export async function setMeta(k, v) {
  await open();
  const { t, done } = tx(['meta'], 'readwrite');
  t.objectStore('meta').put({ k, v });
  await done;
  return v;
}

export async function wipe() {
  await open();
  const { t, done } = tx([...STORE_NAMES, 'meta'], 'readwrite');
  for (const n of [...STORE_NAMES, 'meta']) t.objectStore(n).clear();
  await done;
}
