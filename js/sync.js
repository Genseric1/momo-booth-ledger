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
import { state, reload } from './store.js';
import { hasBackend } from './config.js';

export const status = { configured: false, online: navigator.onLine, signedIn: false,
  busy: false, lastSync: null, lastError: null, pendingCount: 0, email: null, role: null };

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

const listeners = new Set();
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => { for (const fn of listeners) fn(status); };

const cfg = () => ({ url: (state.settings?.supabaseUrl || '').replace(/\/+$/, ''), key: state.settings?.supabaseKey || '' });
let session = null;                 // { access_token, refresh_token, expires_at, user }

export async function init() {
  session = await DB.getMeta('session', null);
  if (hasBackend() && !session) await captureRedirectSession();
  const { url, key } = cfg();
  status.configured = !!(url && key);
  status.signedIn = !!session?.access_token;
  status.email = session?.user?.email || null;
  status.role = await DB.getMeta('role', null);        // remembered, so it holds offline
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

async function rest(path, opts = {}) {
  const { url } = cfg();
  const res = await fetch(`${url}${path}`, { ...opts, headers: { ...headers(), ...(opts.headers || {}) } });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? null : res.json();
}

/* The role comes from the booth's own membership table. */
export const refreshRole = () => loadRole();

async function loadRole() {
  const booth = state.settings?.boothId;
  const uid = session?.user?.id;
  if (!booth || !uid) return null;
  try {
    const rows = await rest(`/rest/v1/booth_members?select=role&booth_id=eq.${booth}&user_id=eq.${uid}`);
    status.role = rows?.[0]?.role || null;
    await DB.setMeta('role', status.role);
    emit();
  } catch { /* keep the remembered role */ }
  return status.role;
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
  try {
    const { url, key } = cfg();
    const res = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${token}` } });
    if (res.ok) session.user = await res.json();
  } catch { /* the token still works; the name simply stays unknown */ }
  await DB.setMeta('session', session);
  history.replaceState(null, '', location.pathname + location.search);
  status.signedIn = true;
  status.email = session.user?.email || null;
  await loadRole();
  emit();
  return true;
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
  if (!res.ok) throw new Error((await res.json()).error_description || 'sign in failed');
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
  status.signedIn = false; status.email = null; status.role = null; emit();
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
const STRIP = ['pending', 'cipher_number'];     // local helpers, not columns
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

async function pullStore(store) {
  const cursorKey = `cursor:${store}`;
  const since = await DB.getMeta(cursorKey, '1970-01-01T00:00:00Z');
  const rows = await rest(`/rest/v1/${store}?select=*&server_at=gt.${encodeURIComponent(since)}&order=server_at.asc&limit=1000`);
  if (!rows?.length) return 0;
  const added = await DB.mergeRemote(store, rows.map(clean));
  await DB.setMeta(cursorKey, rows[rows.length - 1].server_at);
  return added;
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
    for (const s of STORE_NAMES) {
      if (!canWrite()) { pulled += await pullStore(s); continue; }   // a viewer only reads
      try { pushed += await pushStore(s); }
      catch (e) {
        if (String(e.message).startsWith('401') && await refresh()) pushed += await pushStore(s);
        else throw e;
      }
      pulled += await pullStore(s);
    }
    status.lastSync = new Date().toISOString();
    await DB.setMeta('lastSync', status.lastSync);
    if (pulled) await reload();
  } catch (e) {
    status.lastError = e.message;
  } finally {
    status.pendingCount = await countPending();
    status.busy = false; emit();
  }
  return { pushed, pulled, error: status.lastError };
}

/* Called by the store after every local write, and on a timer while online. */
export function startAutoSync(everyMs = 30000) {
  setInterval(() => { if (navigator.onLine) sync(); }, everyMs);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
}
