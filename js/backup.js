/* ═══════════════ THE BACKUP ═══════════════
   One file that survives everything else.

   It is a web page carrying the whole register inside it, locked. Double-click
   it on any computer — no internet, no app, nothing installed — type the
   password, and it shows the register and everything that was ever done to it.
   The same file hands the rows back to the app when a server or a device has
   to be refilled.

   The register never overwrites anything: a correction is a new row beside the
   old one. So the journal of who did what, and what the figure was before, is
   not something assembled here — it is already in the rows, and this only
   writes it down.                                                            */

import * as DB from './db.js';
import { state } from './store.js';
import { VERSION } from './config.js';

const enc = new TextEncoder();
const b64 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));   // in slices: a whole year at once overflows the call stack
  }
  return btoa(s);
};

/* The same lock the app uses on a customer number, on a whole file: a key
   stretched from the password, and a salt so that two booths with the same
   password do not share a key. */
async function keyFrom(password, salt) {
  const material = await crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/* What goes in: every version row of every store, and what the booth is
   called. Not the keys to the door — who may open the app lives on the
   server, not in the register. */
async function payload() {
  const stores = {};
  for (const name of DB.STORE_NAMES) {
    stores[name] = (await DB.all(name)).map(({ pending, ...row }) => row);
  }
  const s = state.settings || {};
  return {
    app: 'PACSBI Register',
    version: VERSION,
    madeAt: new Date().toISOString(),
    booth: { name: s.boothName, id: s.boothId },
    settings: { boothName: s.boothName, agents: s.agents, numberStorage: s.numberStorage,
      exportPassword: s.exportPassword },
    stores,
  };
}

/* `given` is for the tests, which have no device to read: everywhere else the
   backup is whatever this device holds. */
export async function makeBackup(password, given = null) {
  if (!password) throw new Error('A backup needs a password.');
  const data = enc.encode(JSON.stringify(given || await payload()));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, await keyFrom(password, salt), data));

  return page({ salt: b64(salt), iv: b64(iv), body: b64(sealed),
    booth: (given ? given.booth?.name : state.settings?.boothName) || 'PACSBI',
    made: new Date().toISOString() });
}

/* Reading one back, inside the app this time. */
export async function readBackup(text, password) {
  const m = text.match(/<script type="application\/vnd\.pacsbi\+json"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('That file is not a PACSBI backup.');
  const sealed = JSON.parse(m[1]);
  const un = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: un(sealed.iv) },
      await keyFrom(password, un(sealed.salt)), un(sealed.body));
  } catch {
    throw new Error('Wrong password for that file.');
  }
  return JSON.parse(new TextDecoder().decode(plain));
}

export const backupName = (boothName) =>
  `${(boothName || 'pacsbi').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
  + `-sauvegarde-${new Date().toISOString().slice(0, 10)}.html`;

/* ── what the file itself is ──────────────────────────────────────────────
   The viewer is written here as a real function and copied into the file as
   its own source. That way it is ordinary code — it parses with the rest of
   the app and the tests see it — instead of a string nobody can check.      */

function VIEWER() {
  const $ = (sel) => document.querySelector(sel);
  const el = (tag, attrs, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else n.setAttribute(k, v);
    }
    for (const k of kids) if (k) n.append(k);
    return n;
  };
  const money = (n) => (Number(n) < 0 ? '-' : '') + Math.abs(Number(n) || 0)
    .toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const WALLETS = ['MTN', 'TELECEL', 'AT', 'CASH'];
  const LABEL = { MTN: 'MTN', TELECEL: 'Telecel', AT: 'AT', CASH: 'Cash' };
  const DIR = { cash_in: 'in', cash_out: 'out', airtime: 'a', bundle: 'b' };

  const when = (iso) => new Date(iso).toLocaleString('en-GB',
    { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const number = (s) => {
    const d = String(s || '').replace(/\D/g, '');
    return d ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 10)}` : '—';
  };

  /* newest version of each thing wins, exactly as the app reads it */
  const project = (rows, key) => {
    const best = new Map();
    for (const v of rows || []) {
      const cur = best.get(v[key]);
      if (!cur || v.rev > cur.rev || (v.rev === cur.rev && v.vid > cur.vid)) best.set(v[key], v);
    }
    return best;
  };
  const netOf = (people) => (people || []).reduce((t, p) => t + (Number(p.net) || 0), 0);
  const sumOf = (o) => WALLETS.reduce((t, w) => t + (Number(o && o[w]) || 0), 0);

  function pointBlock(title, snap) {
    if (!snap) return null;
    const box = el('div', { class: 'point' }, el('div', { class: 'ptitle', text: title }));
    for (const w of WALLETS) {
      box.append(el('div', { class: 'row' }, el('span', { text: LABEL[w] }),
        el('b', { text: money(snap[w]) })));
    }
    for (const p of snap.debts || []) {
      box.append(el('div', { class: 'row owed' },
        el('span', { text: `${p.name} — ${p.net > 0 ? 'owes us' : 'we owe'}` }),
        el('b', { class: p.net > 0 ? 'pos' : 'neg', text: money(p.net) })));
    }
    box.append(el('div', { class: 'row total' }, el('span', { text: 'TOTAL' }),
      el('b', { text: money(sumOf(snap) + netOf(snap.debts)) })));
    return box;
  }

  /* ── the journal: every row ever written, in the order it was written ── */
  function journal(stores) {
    const out = [];
    const before = (rows, key, row) => {
      const mine = rows.filter((r) => r[key] === row[key] && r.rev < row.rev)
        .sort((a, b) => (a.rev < b.rev ? -1 : 1));
      return mine[mine.length - 1] || null;
    };

    const txs = stores.tx_versions || [];
    for (const t of txs) {
      const was = before(txs, 'tx_id', t);
      let what;
      if (!was) what = `line written · ${number(t.customer_number)} · ${String(t.wallet || '').toLowerCase()} · ${DIR[t.type] || t.type} · ${money(t.amount)}`;
      else if (t.deleted && !was.deleted) what = `line deleted · was ${money(was.amount)}`;
      else if (t.cancelled && !was.cancelled) what = `line struck out · ${money(t.amount)}`;
      else if (!t.cancelled && was.cancelled) what = `line put back · ${money(t.amount)}`;
      else {
        const diff = [];
        if (String(t.amount) !== String(was.amount)) diff.push(`${money(was.amount)} to ${money(t.amount)}`);
        if (t.wallet !== was.wallet) diff.push(`${was.wallet} to ${t.wallet}`);
        if (t.type !== was.type) diff.push(`${DIR[was.type]} to ${DIR[t.type]}`);
        if (t.customer_number !== was.customer_number) diff.push(`${number(was.customer_number)} to ${number(t.customer_number)}`);
        what = `line corrected · ${diff.join(' · ') || 'no visible change'}`;
      }
      out.push({ rev: t.rev, agent: t.agent, device: t.device, what });
    }

    const days = stores.day_versions || [];
    for (const d of days) {
      const was = before(days, 'date', d);
      const parts = [];
      const signed = (name, now, then) => {
        if (!now) return;
        if (then && JSON.stringify(then) === JSON.stringify(now)) return;
        parts.push(`${name} count signed · ${money(sumOf(now) + netOf(now.debts))}`
          + ((now.debts || []).length ? ` · ${now.debts.map((p) => `${p.name} ${money(p.net)}`).join(' · ')}` : ''));
      };
      signed('morning', d.opening, was && was.opening);
      signed('evening', d.closing, was && was.closing);
      if (d.closed && !(was && was.closed)) parts.push('day closed');
      if (!d.closed && was && was.closed) parts.push('day reopened');
      out.push({ rev: d.rev, agent: d.agent, device: d.device,
        what: `${d.date} · ${parts.join(' · ') || 'count touched'}` });
    }

    for (const name of ['debt_account_versions', 'debt_entry_versions', 'commission_versions']) {
      for (const r of stores[name] || []) {
        out.push({ rev: r.rev, agent: r.agent, device: r.device,
          what: `${name.replace('_versions', '').replace('_', ' ')} · ${r.name || r.month || ''} ${r.amount != null ? money(r.amount) : ''}`.trim() });
      }
    }
    return out.sort((a, b) => (a.rev < b.rev ? 1 : -1));
  }

  function show(data) {
    const stores = data.stores || {};
    const days = project(stores.day_versions, 'date');
    const txs = [...project(stores.tx_versions, 'tx_id').values()].filter((t) => !t.deleted);
    const dates = [...new Set([...days.keys(), ...txs.map((t) => t.day)])].sort().reverse();

    const main = $('#main');
    main.innerHTML = '';
    main.append(el('p', { class: 'meta',
      text: `${data.booth && data.booth.name ? data.booth.name : 'PACSBI'} · backup of ${new Date(data.madeAt).toLocaleString('en-GB')} · app ${data.version} · ${dates.length} days · ${txs.length} lines` }));

    const register = el('section');
    register.append(el('h2', { text: 'The register' }));
    for (const date of dates) {
      const day = days.get(date) || {};
      const mine = txs.filter((t) => t.day === date).sort((a, b) => (a.time < b.time ? -1 : 1));
      const card = el('div', { class: 'day' }, el('h3', { text: new Date(date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }) }));
      const morning = pointBlock('MORNING', day.opening);
      if (morning) card.append(morning);
      for (const t of mine) {
        card.append(el('div', { class: 'line' + (t.cancelled ? ' off' : '') },
          el('span', { class: 'num', text: number(t.customer_number) }),
          el('span', { class: 'net', text: String(t.wallet || '').toLowerCase() }),
          el('span', { class: 'dir', text: DIR[t.type] || t.type }),
          el('b', { text: money(t.amount) })));
      }
      const evening = pointBlock('EVENING', day.closing);
      if (evening) card.append(evening);
      register.append(card);
    }
    main.append(register);

    const log = el('section');
    log.append(el('h2', { text: 'Everything that was done' }));
    for (const e of journal(stores)) {
      log.append(el('div', { class: 'ev' },
        el('span', { class: 'ts', text: when(e.rev) }),
        el('span', { class: 'who', text: e.agent || '—' }),
        el('span', { class: 'what', text: e.what }),
        el('span', { class: 'dev', text: e.device || '' })));
    }
    main.append(log);
    $('#lock').style.display = 'none';
    main.style.display = 'block';
  }

  async function unlock() {
    const pass = $('#pass').value;
    if (!pass) return;
    const note = $('#note');
    note.textContent = 'Opening…';
    try {
      const sealed = JSON.parse($('#data').textContent);
      const un = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
      const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
      const key = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: un(sealed.salt), iterations: 150000, hash: 'SHA-256' },
        material, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: un(sealed.iv) }, key, un(sealed.body));
      show(JSON.parse(new TextDecoder().decode(plain)));
    } catch (e) {
      note.textContent = 'Wrong password.';
      $('#pass').select();
    }
  }

  $('#open').addEventListener('click', unlock);
  $('#pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') unlock(); });
  $('#pass').focus();
}

const STYLE = `
  :root { color-scheme: light }
  * { box-sizing: border-box }
  body { margin:0; background:#FBF8F1; color:#1D2433; font:15px/1.45 -apple-system,Segoe UI,Roboto,sans-serif }
  .wrap { max-width:860px; margin:0 auto; padding:28px 16px 80px }
  h1 { font-size:20px; margin:0 0 4px } h2 { font-size:15px; letter-spacing:.08em; text-transform:uppercase;
    color:#8A8578; margin:34px 0 10px; border-bottom:1px solid #E6E0D4; padding-bottom:6px }
  h3 { font-size:15px; margin:0 0 8px }
  .meta { color:#8A8578; font-size:13px; margin:0 0 6px }
  #lock { max-width:360px; margin:12vh auto; text-align:center }
  input { width:100%; padding:12px; font-size:16px; border:1px solid #D8D2C4; border-radius:8px; background:#fff }
  button { margin-top:10px; width:100%; padding:12px; font-size:15px; font-weight:700; color:#fff;
    background:#1F3A6E; border:0; border-radius:8px; cursor:pointer }
  #note { color:#B4392C; font-size:13px; min-height:18px; margin-top:8px }
  #main { display:none }
  .day { border-top:1px solid #E6E0D4; padding:14px 0 }
  .line { display:flex; gap:10px; align-items:baseline; padding:3px 0 }
  .line.off { color:#B4392C; text-decoration:line-through }
  .line .num { font-variant-numeric:tabular-nums; min-width:116px }
  .line .net { color:#8A8578; font-size:12px; min-width:54px }
  .line .dir { font-weight:700; min-width:26px }
  .line b { margin-left:auto; font-variant-numeric:tabular-nums }
  .point { margin:10px 0 10px auto; max-width:330px; background:#F5F1E8; border-radius:8px; padding:10px 12px }
  .ptitle { font-size:11px; letter-spacing:.1em; color:#8A8578; margin-bottom:6px }
  .point .row { display:flex; justify-content:space-between; padding:2px 0 }
  .point .row b { font-variant-numeric:tabular-nums }
  .point .total { border-top:1px solid #1D2433; margin-top:6px; padding-top:6px; font-weight:700 }
  .pos { color:#1C7A4A } .neg { color:#B4392C }
  .ev { display:flex; gap:10px; padding:4px 0; border-bottom:1px solid #F0EBE0; font-size:13px }
  .ev .ts { color:#8A8578; min-width:108px; font-variant-numeric:tabular-nums }
  .ev .who { font-weight:700; min-width:70px }
  .ev .what { flex:1 }
  .ev .dev { color:#B8B2A4; font-size:11px }
  @media (max-width:640px) { .ev { flex-wrap:wrap } .ev .dev { display:none } .point { max-width:none } }
`;

function page({ salt, iv, body, booth, made }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${booth} — backup ${made.slice(0, 10)}</title>
<style>${STYLE}</style></head>
<body><div class="wrap">
<div id="lock">
  <h1>${booth}</h1>
  <p class="meta">Backup of ${made.slice(0, 10)}. The password is the one the booth puts on its registers.</p>
  <input id="pass" type="password" placeholder="password" autocomplete="off">
  <button id="open" type="button">Open</button>
  <p id="note"></p>
</div>
<div id="main"></div>
</div>
<script type="application/vnd.pacsbi+json" id="data">${JSON.stringify({ salt, iv, body })}</script>
<script>(${VIEWER.toString()})()</script>
</body></html>`;
}
