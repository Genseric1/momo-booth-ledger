/* ═══════════════ SYNC (spec §3) ═══════════════
   Talks to Supabase over plain REST (PostgREST + GoTrue), so the app keeps no
   build step and no vendored SDK. Push then pull, per store:
     push : every local version still flagged pending, upserted on its vid.
            Re-sending the same vid is a no-op, so a retry can never duplicate.
     pull : every version of the booth newer than the stored cursor.
   Any backend exposing the same two operations can be swapped in here; row
   isolation per booth is enforced by the database (see supabase/schema.sql). */

import * as DB from './db.js';
import { STORE_NAMES } from './db.js';
import { state, reload, saveSettings } from './store.js';
import { hasBackend } from './config.js';

export const status = { configured: false, online: navigator.onLine, signedIn: false,
  busy: false, lastSync: null, lastError: null, pendingCount: 0, email: null, role: null,
  owner: false, pulledAt: null, storeErrors: {} };

export const hasSession = () => !!session?.access_token;
export const currentEmail = () => session?.user?.email || null;
export const currentUser = () => session?.user || null;

/* A viewer — a boss given read access — is refused every insert by the
   database. The app hides the pen rather than let him write lines that would
   be rejected in silence on the next sync. */
export const canWrite = () => status.role !== 'viewer';
export const isViewer = () => status.role === 'viewer';

/* Reopening a day that was closed and counted is the manager's call (spec §4).
   A booth with no backend has no roles at all — there, whoever holds the PIN
   is the manager. */
export const canReopenDay = () => !status.configured || status.role === 'manager';

/* The booth belongs to one person: what the booth itself carries is theirs to
   decide, whoever else runs the register. */
export const isOwner = () => !status.configured || status.owner;

const listeners = new Set();
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => { for (const fn of listeners) fn(status); };

const cfg = () => ({ url: (state.settings?.supabaseUrl || '').replace(/\/+$/, ''), key: state.settings?.supabaseKey || '' });
let session = null;                 // { access_token, refresh_token, expires_at, user }

export async function init() {
  session = await DB.getMeta('session', null);
  if (hasBackend() && !session) await captureRedirectSession();
  /* the token lasts an hour; renew it before anything asks the server a
     question, or the answer comes back as "who are you?" */
  if (session && expiringSoon()) await refresh();
  const { url, key } = cfg();
  status.configured = !!(url && key);
  status.signedIn = !!session?.access_token;
  status.email = session?.user?.email || null;
  await recoverOnce();
  status.role = await DB.getMeta('role', null);        // remembered, so it holds offline
  status.owner = await DB.getMeta('owner', false);
  status.pendingCount = await countPending();
  addEventListener('online', () => { status.online = true; emit(); sync(); });
  addEventListener('offline', () => { status.online = false; emit(); });
  emit();
}

async function countPending() {
  let n = 0;
  for (const s of STORE_NAMES) n += (await DB.pending(s)).length;
  return n;
}

function headers(json = true) {
  const { key } = cfg();
  const h = { apikey: key, Authorization: `Bearer ${session?.access_token || key}` };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

/* An answer with nothing in it is still an answer. `return=minimal` sends an
   empty body, and not always under 204 — an insert answers 201 with no body at
   all. Handing that to res.json() throws, the push counted as failed, the rows
   were never marked sent, and the queue sat there for ever although the server
   had them. So: read the body, and only parse it if there is one. */
export async function readBody(res) {
  const body = await res.text();
  if (!body.trim()) return null;
  return JSON.parse(body);
}

async function rest(path, opts = {}) {
  const { url } = cfg();
  const res = await fetch(`${url}${path}`, { ...opts, headers: { ...headers(), ...(opts.headers || {}) } });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  return readBody(res);
}

/* The role comes from the booth's own membership table. */
export const refreshRole = async () => (await loadRole()).role ?? null;

/* Signing in is not the same as being let in: the account must be on the
   booth's list. Offline, the remembered role is trusted, so a lost network
   never locks an agent out of his own page. */
export async function ensureMembership() {
  if (status.role) return { ok: true };
  if (!navigator.onLine) return { ok: true };
  const answer = await loadRole();
  if (answer.role) return { ok: true };
  /* a dead token is not a hiccup: the session has to be started again */
  if (answer.dead) { await sessionDied(); return { ok: false, expired: true }; }
  /* the server never said no — it said nothing. Nobody is signed out over a
     network hiccup or a token that simply needed renewing. */
  if (!answer.asked) return { ok: true };
  const who = session?.user || null;
  await signOut();
  return { ok: false, email: who?.email || null, id: who?.id || null };
}

export const notOnTheList = (who) => "That account is not on this booth's list yet."
  + (who?.email ? ` Give the manager this: ${who.email}` : '')
  + (who?.id ? ` (id ${who.id})` : '');

/* { asked: false } when the server could not be reached or would not answer —
   which is NOT the same as "this account is not a member", and must never be
   treated as one. */
async function loadRole() {
  const booth = state.settings?.boothId;
  const uid = session?.user?.id;
  if (!booth || !uid) return { asked: false };
  const query = `/rest/v1/booth_members?select=role&booth_id=eq.${booth}&user_id=eq.${uid}`;
  for (const attempt of [1, 2]) {
    try {
      const rows = await rest(query);
      status.role = rows?.[0]?.role || null;
      await DB.setMeta('role', status.role);
      emit();
      return { asked: true, role: status.role };
    } catch (e) {
      if (!String(e.message).startsWith('401')) return { asked: false };
      /* an expired token reads as a refusal; renew it once and ask again */
      if (attempt === 1 && await refresh()) continue;
      return { asked: false, dead: true };
    }
  }
  return { asked: false };
}

/* ── auth ── */
/* Google sends the session back in the address bar; it is picked up here on the
   next load and the address is cleaned so it is not left lying around. */
export async function captureRedirectSession() {
  const hash = location.hash.startsWith('#') ? new URLSearchParams(location.hash.slice(1)) : null;
  const token = hash?.get('access_token');
  if (!token) return false;
  session = {
    access_token: token,
    refresh_token: hash.get('refresh_token'),
    expires_at: Number(hash.get('expires_at')) || null,
    user: null,
  };
  /* anybody can put an access_token in a link; it is only kept if the server
     recognises it */
  try {
    const { url, key } = cfg();
    const res = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error('unknown token');
    session.user = await res.json();
  } catch {
    session = null;
    history.replaceState(null, '', location.pathname + location.search);
    return false;
  }
  await DB.setMeta('session', session);
  history.replaceState(null, '', location.pathname + location.search);
  status.signedIn = true;
  status.email = session.user?.email || null;
  await loadRole();
  emit();
  return true;
}

/* A password given out to get someone started is a password they must be able
   to replace themselves, from the page, without asking anybody. */
export async function changePassword(password) {
  if (!session?.access_token) throw new Error('Sign in first.');
  const { url, key } = cfg();
  const res = await fetch(`${url}/auth/v1/user`, {
    method: 'PUT',
    headers: { apikey: key, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.msg || body.error_description || body.message || 'Could not change the password.');
  }
  const user = await res.json();
  session = { ...session, user };
  await DB.setMeta('session', session);
  emit();
  return user;
}

/* What the booth decided once, for every device: the password put on exported
   registers. Read on each sync, written only by a manager (the database says
   so, not the app). */
export async function pullBoothSettings() {
  const booth = state.settings?.boothId;
  if (!booth || !session?.access_token) return;
  try {
    const rows = await rest(`/rest/v1/booths?select=export_password,owner_id&id=eq.${booth}`);
    const row = rows?.[0];
    if (!row) return;
    status.owner = !!row.owner_id && row.owner_id === session.user?.id;
    await DB.setMeta('owner', status.owner);
    emit();
    if (row.export_password != null && row.export_password !== state.settings.exportPassword) {
      await saveSettings({ exportPassword: row.export_password });
    }
  } catch { /* keep what this device already knows */ }
}

export async function pushExportPassword(value) {
  const booth = state.settings?.boothId;
  await saveSettings({ exportPassword: value });
  if (!booth || !session?.access_token) return { shared: false };
  await rest(`/rest/v1/booths?id=eq.${booth}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ export_password: value }),
  });
  return { shared: true };
}

export function googleSignIn() {
  const { url } = cfg();
  const back = location.origin + location.pathname;
  location.href = `${url}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(back)}`;
}
export async function signIn(email, password) {
  const { url, key } = cfg();
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = await readBody(res).catch(() => null);
    throw new Error(body?.error_description || body?.msg || 'sign in failed');
  }
  session = await res.json();
  await DB.setMeta('session', session);
  status.signedIn = true; status.email = session.user?.email || email; emit();
  await loadRole();
  return session;
}
export async function signOut() {
  session = null;
  await DB.setMeta('session', null);
  await DB.setMeta('role', null);
  await DB.setMeta('owner', false);
  status.signedIn = false; status.email = null; status.role = null; status.owner = false; emit();
}
/* The server answered, and answered that this token is no good — after a
   renewal was tried and refused. That is not a hiccup: the session is dead,
   and pretending otherwise leaves the queue stuck for ever. */
async function sessionDied() {
  await signOut();
  status.lastError = 'Your session has ended. Sign in again.';
  emit();
}

/* true when the token is gone or about to be */
function expiringSoon() {
  if (!session?.expires_at) return false;
  return session.expires_at * 1000 - Date.now() < 120000;
}

async function refresh() {
  if (!session?.refresh_token) return false;
  const { url, key } = cfg();
  const res = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });
  if (!res.ok) return false;
  session = await res.json();
  await DB.setMeta('session', session);
  return true;
}

/* ── push / pull ── */
/* `pending` and `cipher_number` belong to the device; `server_at` belongs to
   the server, and a row sent back up carrying an old one would be filed behind
   every other device's cursor, where it would never be read again. */
const STRIP = ['pending', 'cipher_number', 'server_at'];
/* Lines written before the booth was configured carry booth_id 'local'. They
   are stamped with the real booth on their way up, so a day of work written
   before the account existed is not stranded on the device. */
const clean = (row) => {
  const booth = state.settings?.boothId;
  const out = Object.fromEntries(Object.entries(row).filter(([k]) => !STRIP.includes(k)));
  if (booth && (!out.booth_id || out.booth_id === 'local')) out.booth_id = booth;
  return out;
};

async function pushStore(store) {
  const rows = await DB.pending(store);
  if (!rows.length) return 0;
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200);
    await rest(`/rest/v1/${store}`, {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify(batch.map(clean)),
    });
    await DB.markSynced(store, batch.map((r) => r.vid));
  }
  return rows.length;
}

/* The cursor is kept a couple of seconds behind what was just read.

   Two rows can reach the server in the same instant — a batch of lines sent
   together does exactly that — and asking for everything strictly *after* a
   moment splits them: whichever falls on the wrong side of the cursor is never
   read by this device again. It is on the server, it is on the device that
   wrote it, and it is invisible here for ever, with no error anywhere and two
   inventories that look identical.

   Re-reading a handful of rows costs nothing: merging ignores a vid it already
   holds. This buys back the only way a line could be lost in silence. */
const OVERLAP = 2000;
export const nextCursor = (serverAt) =>
  new Date(new Date(serverAt).getTime() - OVERLAP).toISOString();

async function pullStore(store) {
  const cursorKey = `cursor:${store}`;
  const since = await DB.getMeta(cursorKey, '1970-01-01T00:00:00Z');
  const rows = await rest(`/rest/v1/${store}?select=*&server_at=gt.${encodeURIComponent(since)}&order=server_at.asc&limit=1000`);
  if (!rows?.length) return 0;
  const added = await DB.mergeRemote(store, rows.map(clean));
  await DB.setMeta(cursorKey, nextCursor(rows[rows.length - 1].server_at));
  return added;
}

/* Whatever was already lost that way is still on the server, behind a cursor
   that has passed it. So every device reads the booth once from the beginning:
   the rows it already holds are ignored, and anything that fell through comes
   back on its own. A booth holds a few hundred rows — it costs one sync. */
const REREAD = 'reread:v42';
async function recoverOnce() {
  if (await DB.getMeta(REREAD, false)) return;
  for (const s of STORE_NAMES) await DB.setMeta(`cursor:${s}`, '1970-01-01T00:00:00Z');
  await DB.setMeta(REREAD, true);
}

/* Five stores syncing side by side must not each try to renew the same token:
   the first renewal is the one everybody waits on. */
let renewing = null;
function refreshOnce() {
  renewing ||= refresh().finally(() => { renewing = null; });
  return renewing;
}

/* What each store is called when the screen has to name one. */
export const STORE_LABEL = {
  day_versions: 'days', tx_versions: 'lines', debt_account_versions: 'debt names',
  debt_entry_versions: 'debt lines', commission_versions: 'commissions',
};

/* One store being refused is not "the sync failed": four of the five can go
   through perfectly while the fifth is turned away. Reporting only that
   something went wrong is how a single stuck table hides for days — so each
   store now carries its own answer back. */
async function syncStore(store) {
  const out = { store, pushed: 0, pulled: 0, error: null };
  try {
    if (canWrite()) {                                   // a viewer only reads
      try { out.pushed = await pushStore(store); }
      catch (e) {
        if (!String(e.message).startsWith('401')) throw e;
        if (!await refreshOnce()) {
          await sessionDied();
          throw new Error('Your session has ended. Sign in again.');
        }
        out.pushed = await pushStore(store);
      }
    }
    out.pulled = await pullStore(store);
  } catch (e) {
    out.error = e.message;
  }
  return out;
}

/* What this device actually holds, store by store: how many rows, how many
   still waiting to go up, and how far down it has read. Three devices showing
   three different evenings is answered by reading this on each of them. */
export async function inventory() {
  const out = [];
  for (const s of STORE_NAMES) {
    out.push({
      store: s,
      label: STORE_LABEL[s] || s,
      rows: (await DB.all(s)).length,
      waiting: (await DB.pending(s)).length,
      cursor: await DB.getMeta(`cursor:${s}`, null),
      error: status.storeErrors[s] || null,
    });
  }
  return out;
}

let running = null;
export function sync() {
  if (running) return running;
  running = doSync().finally(() => { running = null; });
  return running;
}

async function doSync() {
  const { url, key } = cfg();
  status.configured = !!(url && key);
  if (!status.configured || !navigator.onLine || !session?.access_token) {
    status.pendingCount = await countPending(); emit(); return { skipped: true };
  }
  status.busy = true; status.lastError = null; emit();
  let pushed = 0, pulled = 0;
  try {
    if (!status.role) await loadRole();
    if (expiringSoon()) await refresh();
    /* The five stores have nothing to say to each other, so they went one
       after the other for no reason: ten questions to the server in single
       file, each waiting out the whole trip to Ghana and back. Asked together,
       a sync costs one trip instead of ten. */
    const done = await Promise.all(STORE_NAMES.map(syncStore));
    for (const r of done) { pushed += r.pushed; pulled += r.pulled; }
    status.storeErrors = Object.fromEntries(done.filter((r) => r.error).map((r) => [r.store, r.error]));
    await pullBoothSettings();
    status.lastSync = new Date().toISOString();
    await DB.setMeta('lastSync', status.lastSync);
    /* the screen is watching this: it redraws when it changes */
    if (pulled) { await reload(); status.pulledAt = Date.now(); }
    const refused = done.filter((r) => r.error);
    if (refused.length) {
      throw new Error(refused.map((r) => `${STORE_LABEL[r.store]} — ${r.error}`).join(' · '));
    }
  } catch (e) {
    status.lastError = e.message;
  } finally {
    status.pendingCount = await countPending();
    status.busy = false; emit();
  }
  return { pushed, pulled, error: status.lastError };
}

/* Nobody should have to press anything. This runs after every line written,
   whenever the app comes back to the front, the moment the network returns,
   and on a timer in between — quick while somebody is looking at the page,
   slow while nobody is, so a phone in a pocket is left alone. */
const WATCHING = 10000;
const POCKETED = 60000;

export function startAutoSync() {
  let timer = null;
  const pace = () => {
    clearInterval(timer);
    timer = setInterval(() => { if (navigator.onLine) sync(); },
      document.hidden ? POCKETED : WATCHING);
  };
  document.addEventListener('visibilitychange', () => {
    pace();
    if (!document.hidden) sync();
  });
  pace();
}
