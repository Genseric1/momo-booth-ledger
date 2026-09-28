/* ═══════════════ ENTITIES & MUTATIONS ═══════════════
   Projects the append-only version rows into the current state of the booth,
   and offers the mutations the screens call. Every mutation writes locally and
   returns immediately; sync happens in the background.                      */

import * as DB from './db.js';
import { uuid, today, dayKey, WALLETS } from './util.js';
import { encryptField, decryptField, deriveKey, decryptWith, encryptWith } from './crypto.js';
import { CONFIG, hasBackend } from './config.js';

/* Newest version of each entity wins; the vid breaks ties so that every device
   projects the same state from the same rows. */
export function project(versions, keyField) {
  const best = new Map();
  for (const v of versions) {
    const k = v[keyField];
    const cur = best.get(k);
    if (!cur || v.rev > cur.rev || (v.rev === cur.rev && v.vid > cur.vid)) best.set(k, v);
  }
  return best;
}
export const history = (versions, keyField, id) =>
  versions.filter((v) => v[keyField] === id).sort((a, b) => (a.rev < b.rev ? -1 : 1));

const listeners = new Set();
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
function emit() { for (const fn of listeners) fn(state); }

export const state = {
  ready: false,
  raw: {},                  // store name -> all version rows (kept for history views)
  days: new Map(),          // date -> day
  txs: [],                  // newest first
  debtAccounts: [],
  debtEntries: [],
  commissions: [],
  settings: null,
};

export const DEFAULT_SETTINGS = {
  boothName: 'PACSBI MoMo booth',
  agents: [],
  device: '',
  numberStorage: 'full',    // full | masked | last4 | off — the paper page shows the whole number
                            // (the exported PDF still masks by default, spec §8)
  encryptNumbers: true,
  showLivePanel: true,
  supabaseUrl: '',
  supabaseKey: '',
  boothId: '',
  cryptoBoothId: '',        // the booth id the stored numbers are encrypted under
};

export async function init() {
  await DB.open();
  const saved = await DB.getMeta('settings', null);
  state.settings = { ...DEFAULT_SETTINGS, ...(saved || {}) };
  /* The deployment decides where the booth lives; a device cannot drift from it. */
  if (hasBackend()) {
    state.settings.supabaseUrl = CONFIG.supabaseUrl;
    state.settings.supabaseKey = CONFIG.supabaseKey;
    state.settings.boothId = CONFIG.boothId;
  }
  if (!state.settings.device) {
    state.settings.device = `${navigator.platform || 'device'}-${uuid().slice(0, 4)}`;
    await DB.setMeta('settings', state.settings);
  }
  await reload();
  state.ready = true;
  emit();
  return state;
}

export async function saveSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  await DB.setMeta('settings', state.settings);
  emit();
  return state.settings;
}

export async function reload() {
  const raw = await DB.loadAll();
  state.raw = raw;

  state.days = project(raw.day_versions, 'date');
  state.txs = [...project(raw.tx_versions, 'tx_id').values()]
    .sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : a.vid < b.vid ? 1 : -1));
  state.debtAccounts = [...project(raw.debt_account_versions, 'account_id').values()]
    .filter((a) => !a.archived)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  state.debtEntries = [...project(raw.debt_entry_versions, 'entry_id').values()]
    .sort((a, b) => (a.time < b.time ? 1 : -1));
  state.commissions = [...project(raw.commission_versions, 'commission_id').values()]
    .sort((a, b) => a.month.localeCompare(b.month));

  for (const tx of state.txs) tx.customer_number = await decryptField(tx.customer_number);
  emit();
  return state;
}

/* ── shared stamp on every version ── */
function stamp(extra = {}) {
  return {
    vid: uuid(),
    rev: new Date().toISOString(),
    booth_id: state.settings.boothId || 'local',
    device: state.settings.device,
    ...extra,
  };
}
let syncHook = null;
export const onSyncNeeded = (fn) => { syncHook = fn; };
function queueSync() { if (syncHook) setTimeout(() => syncHook().catch(() => {}), 0); }

async function write(store, version) {
  await DB.append(store, version);
  await reload();
  queueSync();
  return version;
}

/* ── days ── */
export const getDay = (date) => state.days.get(date) || null;
export const dayTxs = (date) => state.txs.filter((t) => t.day === date);
export const dayDebtEntries = (date) => state.debtEntries.filter((e) => e.day === date);
export const datesWithData = () => {
  const s = new Set([...state.days.keys()]);
  for (const t of state.txs) s.add(t.day);
  for (const e of state.debtEntries) s.add(e.day);
  return [...s].sort();
};

const pickWallets = (o) => Object.fromEntries(WALLETS.map((w) => [w, Number(o?.[w]) || 0]));

export async function setDay(date, patch) {
  const cur = getDay(date) || { date, opening: null, closing: null, estimated_extras: null, closed: false };
  return write('day_versions', stamp({
    date,
    opening: patch.opening !== undefined ? patch.opening : cur.opening,
    closing: patch.closing !== undefined ? patch.closing : cur.closing,
    estimated_extras: patch.estimated_extras !== undefined ? patch.estimated_extras : cur.estimated_extras,
    closed: patch.closed !== undefined ? patch.closed : cur.closed,
    agent: patch.agent ?? cur.agent ?? null,
  }));
}
export const setOpening = (date, counts, agent) => setDay(date, { opening: pickWallets(counts), agent });
export const setClosing = (date, counts, extras, agent) =>
  setDay(date, { closing: pickWallets(counts), estimated_extras: extras, agent });
export const closeDay = (date) => setDay(date, { closed: true });
export const reopenDay = (date) => setDay(date, { closed: false });

/* ── transactions ── */
/* `state.txs` holds decrypted numbers, so a re-encrypt reads straight from it. */
function storableNumber(raw) {
  const mode = state.settings.numberStorage;
  if (!raw || mode === 'off') return null;
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;
  if (mode === 'last4') return digits.slice(-4);
  return digits;              // 'full' and 'masked' both store digits; 'masked' only masks on display
}

export async function addTx(fields) {
  const now = new Date();
  return write('tx_versions', stamp({
    tx_id: uuid(),
    day: fields.day || dayKey(now),
    time: fields.time || now.toISOString(),
    type: fields.type,
    wallet: fields.wallet,
    amount: Number(fields.amount) || 0,
    customer_number: await encryptField(storableNumber(fields.customer_number)),
    sub_type: fields.type === 'cash_in' ? (fields.sub_type || null) : null,
    agent: fields.agent || null,
    note: fields.note || null,
    cancelled: false,
    cancelled_at: null,
  }));
}

/* An edit is a new version, never an overwrite (spec §3). */
export async function editTx(tx_id, patch) {
  const cur = state.txs.find((t) => t.tx_id === tx_id);
  if (!cur) throw new Error('unknown transaction');
  const next = { ...cur, ...patch };
  return write('tx_versions', stamp({
    tx_id,
    day: next.day, time: next.time, type: next.type, wallet: next.wallet,
    amount: Number(next.amount) || 0,
    customer_number: await encryptField(storableNumber(next.customer_number)),
    sub_type: next.type === 'cash_in' ? (next.sub_type || null) : null,
    agent: next.agent || null, note: next.note || null,
    cancelled: !!next.cancelled, cancelled_at: next.cancelled_at || null,
  }));
}
export const cancelTx = (tx_id) => editTx(tx_id, { cancelled: true, cancelled_at: new Date().toISOString() });
export const uncancelTx = (tx_id) => editTx(tx_id, { cancelled: false, cancelled_at: null });

/* ── debt accounts and entries ── */
export async function addDebtAccount(name) {
  if (state.debtAccounts.length >= 4) throw new Error('v1 allows at most 4 debt accounts');
  return write('debt_account_versions', stamp({
    account_id: uuid(), name: name.trim(), archived: false, created_at: new Date().toISOString(),
  }));
}
export async function editDebtAccount(account_id, patch) {
  const cur = project(state.raw.debt_account_versions, 'account_id').get(account_id);
  return write('debt_account_versions', stamp({ ...cur, ...patch, account_id }));
}
export const archiveDebtAccount = (id) => editDebtAccount(id, { archived: true });

export async function addDebtEntry(f) {
  const now = new Date();
  return write('debt_entry_versions', stamp({
    entry_id: uuid(),
    account_id: f.account_id,
    day: f.day || dayKey(now),
    time: f.time || now.toISOString(),
    kind: f.kind,
    direction: (f.kind === 'lend' || f.kind === 'repay_received') ? 'owed_to_us' : 'we_owe',
    amount: Number(f.amount) || 0,
    wallet: f.wallet || 'CASH',
    agent: f.agent || null,
    note: f.note || null,
    cancelled: false,
  }));
}
export async function cancelDebtEntry(entry_id) {
  const cur = state.debtEntries.find((e) => e.entry_id === entry_id);
  return write('debt_entry_versions', stamp({ ...cur, cancelled: true }));
}

/* ── monthly commissions (statistics only, never part of the daily total) ── */
export async function setCommission(month, wallet, amount) {
  const cur = state.commissions.find((c) => c.month === month && c.wallet === wallet);
  return write('commission_versions', stamp({
    commission_id: cur?.commission_id || uuid(), month, wallet, amount: Number(amount) || 0,
  }));
}

/* ── agents (chip list on the quick entry screen) ── */
export async function addAgent(name) {
  const n = name.trim();
  if (!n || state.settings.agents.includes(n)) return state.settings;
  return saveSettings({ agents: [...state.settings.agents, n] });
}
export const removeAgent = (name) => saveSettings({ agents: state.settings.agents.filter((a) => a !== name) });

/* Changing the PIN changes the key: rewrite every stored number as a new version. */
export async function reencryptNumbers() {
  const rows = [];
  for (const tx of state.txs) {
    if (!tx.customer_number) continue;
    rows.push(stamp({ ...tx, customer_number: await encryptField(tx.customer_number) }));
  }
  if (rows.length) { await DB.append('tx_versions', rows); await reload(); queueSync(); }
  return rows.length;
}

export const bootstrapDay = () => today();

/* ═══ joining a booth after writing locally ═══
   The encryption key is derived from the PIN *and* the booth id, so attaching
   a device to a real booth changes the key. The numbers written before are
   re-encrypted here, before anything tries to read them with the new key —
   otherwise a day of work would come back blank.                            */
export async function rekeyNumbers(pin) {
  const from = state.settings.cryptoBoothId || 'local';
  const to = state.settings.boothId || 'local';
  if (from === to) return 0;

  const [oldKey, newKey] = await Promise.all([deriveKey(pin, from), deriveKey(pin, to)]);
  const raw = await DB.loadAll();
  const current = [...project(raw.tx_versions, 'tx_id').values()];
  const rows = [];
  for (const tx of current) {
    if (!tx.customer_number) continue;
    const clear = await decryptWith(oldKey, tx.customer_number);
    if (clear == null) continue;                    // not ours to re-encrypt; leave it alone
    rows.push(stamp({ ...tx, customer_number: await encryptWith(newKey, clear) }));
  }
  if (rows.length) await DB.append('tx_versions', rows);
  await saveSettings({ cryptoBoothId: to });
  return rows.length;
}
