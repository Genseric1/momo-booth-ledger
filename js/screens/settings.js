/* ═══════════════ SETTINGS (spec §2, §3, §9) ═══════════════ */

import { el, card, sheet, toast, chipRow, confirmSheet, tile, fill } from '../ui.js';
import { dayKey } from '../util.js';
import * as store from '../store.js';
import * as sync from '../sync.js';
import * as DB from '../db.js';
import { hasBackend, needsAccount, CONFIG } from '../config.js';

const NUMBER_MODES = [
  { value: 'masked', label: 'Masked' }, { value: 'last4', label: 'Last 4 only' },
  { value: 'full', label: 'Full number' }, { value: 'off', label: 'Do not store' },
];

export function settingsScreen(ctx) {
  const s = store.state.settings;
  const st = sync.status;

  return el('div.sheetview',
    el('div',
      card('Booth', [
        el('div.field', el('label', { text: 'Booth name' }),
          el('input', { value: s.boothName, onchange: (e) => store.saveSettings({ boothName: e.target.value || 'Booth' }).then(ctx.refresh) })),
        el('div.field', el('label', { text: 'Who writes' }),
          CONFIG.agents?.length
            ? el('div',
                el('div.pick', CONFIG.agents.map((a) => el('button', { text: a, disabled: true }))),
                el('p.note', { text: 'This list belongs to the booth, not to this phone. It is changed in the deployment so every device shows the same names.' }))
            : el('div.pick', [
                ...s.agents.map((a) => el('button', { text: `${a}  ✕`, onclick: async () => {
                  await store.removeAgent(a); ctx.refresh();
                } })),
                el('button', { text: '+ add', onclick: () => addAgentSheet(ctx) }),
              ])),
        el('p.note', { text: `Pick who is writing from the menu. This device: ${s.device}` }),
      ]),

      card('Customer numbers', [
        chipRow(NUMBER_MODES, s.numberStorage, async (v) => { await store.saveSettings({ numberStorage: v }); ctx.refresh(); }),
        el('p.note', { style: { marginTop: '10px' }, text:
          s.numberStorage === 'off' ? 'No number is stored at all. The customer field disappears from the entry screen.'
          : s.numberStorage === 'last4' ? 'Only the last four digits are kept.'
          : s.numberStorage === 'full' ? 'Full numbers are kept and shown. Check your obligations under Ghana’s Data Protection Act 2012 (Act 843) before doing this on a server.'
          : 'Numbers are stored but displayed masked (0244***123).' }),
        el('p.note', { style: { marginTop: '8px' }, text: 'Numbers are kept in the booth’s own database, which refuses them to anyone outside the booth. They are never sent to any analytics.' }),
      ]),

      card('Sync', [
        el('div.rows',
          tile('Backend', st.configured ? 'configured' : 'local only'),
          tile('Account', st.signedIn ? 'signed in' : 'signed out', st.email || ''),
          tile('Waiting to send', String(st.pendingCount)),
          tile('Last sync', st.lastSync ? new Date(st.lastSync).toLocaleTimeString('en-GB') : '—')),
        st.lastError ? el('p.note', { text: st.lastError }) : null,
        hasBackend()
          ? el('div', { style: { marginTop: '12px' } },
              el('p.note', { text: `Booth server: ${s.supabaseUrl}` }),
              el('p.note', { text: `Booth id: ${s.boothId}` }),
              el('p.note', { text: needsAccount()
                ? 'An account is required to open this page.'
                : 'An account is optional: the page opens without one.' }))
          : el('div',
              el('div.field', { style: { marginTop: '12px' } }, el('label', { text: 'Supabase project URL' }),
                el('input', { value: s.supabaseUrl, placeholder: 'https://xxxx.supabase.co',
                  onchange: (e) => store.saveSettings({ supabaseUrl: e.target.value.trim() }).then(() => sync.init()).then(ctx.refresh) })),
              el('div.field', el('label', { text: 'Anon key' }),
                el('input', { value: s.supabaseKey, placeholder: 'eyJ…',
                  onchange: (e) => store.saveSettings({ supabaseKey: e.target.value.trim() }).then(() => sync.init()).then(ctx.refresh) })),
              el('div.field', el('label', { text: 'Booth id' }),
                el('input', { value: s.boothId, placeholder: 'uuid of the booth row',
                  onchange: (e) => store.saveSettings({ boothId: e.target.value.trim() }).then(ctx.refresh) })),
              el('p.note', { text: 'Set these once in js/config.js before publishing, and no agent ever has to type them.' })),
        el('div.r',
          st.signedIn
            ? el('button.big.quiet', { text: 'Sign out', onclick: async () => {
                if (!await confirmSheet('Sign out',
                  needsAccount()
                    ? 'This page will ask for the account again, and that needs the network. Lines already written stay on the device.'
                    : 'Lines already written stay on the device.',
                  { danger: true, okLabel: 'Sign out' })) return;
                await sync.signOut();
                needsAccount() ? location.reload() : ctx.refresh();
              } })
            : el('button.big', { text: 'Sign in', onclick: () => signInSheet(ctx) }),
          el('button.big.quiet', { text: st.busy ? 'Syncing…' : 'Sync now', onclick: async () => {
            const r = await sync.sync();
            toast(r?.skipped ? 'Nothing to sync (offline or local only)' : r.error ? r.error : `Sent ${r.pushed}, received ${r.pulled}`,
              { error: !!r?.error });
            ctx.refresh();
          } })),
        el('p.note', { style: { marginTop: '8px' }, text: 'Run supabase/schema.sql once in your project, then add each agent to booth_members. Rows are isolated per booth by the database itself.' }),
      ]),
    ),

    el('div',
      !st.signedIn ? null : card('Your account', [
        el('p.lead', { text: `Signed in as ${st.email || 'this account'}.` }),
        el('button.big.quiet', { text: 'Change my password', onclick: () => changePasswordSheet(ctx) }),
        el('p.note', { text: 'Given a password to get started? Change it here — nobody else needs to know the new one.' }),
      ]),

      card('Exported registers', [
        el('div.field',
          el('label', { text: 'Password put on every export' }),
          el('input', { type: 'text', value: s.exportPassword || '', placeholder: 'none — registers open freely',
            onchange: async (e) => {
              try {
                const r = await sync.pushExportPassword(e.target.value.trim());
                toast(r.shared ? 'Saved for the whole booth' : 'Saved on this device');
              } catch (err) {
                toast(/403|401/.test(err.message) ? 'Only a manager can change it' : err.message, { error: true });
              }
              ctx.refresh();
            } })),
        el('p.note', { text: 'Set once, and every register exported from any device of the booth carries it. Leave it empty and they open freely.' }),
        el('p.note', { text: 'It is the PDF format’s own lock: a speed bump, not a safe. And whoever receives a register needs this password to read it — give it to them by another route than the file itself.' }),
      ]),

      card('Backup', [
        el('p.lead', { text: 'A backup file holds every version row of this device, including the encrypted customer numbers.' }),
        el('div.r', { style: { marginTop: '10px' } },
          el('button.big.quiet', { text: 'Export backup', onclick: exportBackup }),
          el('button.big.quiet', { text: 'Import backup', onclick: () => importBackup(ctx) })),
      ]),

      card('This device', [
        el('div.rows',
          tile('Transactions', String(store.state.txs.length)),
          tile('Days', String(store.state.days.size)),
          tile('Version rows', String(Object.values(store.state.raw).reduce((n, r) => n + r.length, 0))),
          tile('Debt entries', String(store.state.debtEntries.length))),
        el('button.big.warn', { text: 'Erase local data', style: { marginTop: '12px' }, onclick: async () => {
          if (!await confirmSheet('Erase local data',
            'Everything stored on this device is removed. Rows already synced can come back from the server; anything still waiting to send is lost.',
            { danger: true, okLabel: 'Erase' })) return;
          await DB.wipe();
          location.reload();
        } }),
      ]),

      card('About', [
        el('p.lead', { text: 'PACSBI Register v1 — one booth, one shared till, several agents. Works offline; entries are never lost waiting for the network.' }),
        el('p.note', { style: { marginTop: '8px' }, text: 'Not yet in this version: photo/OCR of transaction IDs, viewer accounts for bosses, several booths, automatic SMS reading.' }),
      ]),
    ),
  );
}

function addAgentSheet(ctx) {
  let name = '';
  sheet('Add agent', ({ close }) => [
    el('div.field', el('label', { text: 'Name' }), el('input', { oninput: (e) => { name = e.target.value; } })),
    el('button.big', { text: 'Add', onclick: async () => {
      if (!name.trim()) return toast('Enter a name', { error: true });
      await store.addAgent(name); ctx.refresh(); close();
    } }),
  ]);
}

function signInSheet(ctx) {
  let email = '', password = '';
  sheet('Sign in', ({ close }) => [
    el('div.field', el('label', { text: 'Email' }),
      el('input', { type: 'email', inputmode: 'email', oninput: (e) => { email = e.target.value.trim(); } })),
    el('div.field', el('label', { text: 'Password' }),
      el('input', { type: 'password', oninput: (e) => { password = e.target.value; } })),
    el('button.big', { text: 'Sign in', onclick: async () => {
      try { await sync.signIn(email, password); } catch (e) { return toast(e.message, { error: true }); }
      const check = await sync.ensureMembership();
      if (!check.ok) { ctx.refresh(); return toast(sync.notOnTheList(check), { error: true, ms: 12000 }); }
      toast('Signed in'); close(); ctx.refresh(); sync.sync();
    } }),
    el('p.note', { style: { marginTop: '10px' }, text: 'The manager creates the accounts and puts them on the booth’s list.' }),
  ]);
}

function changePasswordSheet(ctx) {
  let pwd = '', again = '', busy = false;
  sheet('Change my password', ({ body, close }) => {
    const render = (error = null) => fill(body,
      el('div.field', el('label', { text: 'New password' }),
        el('input', { type: 'password', autocomplete: 'new-password', value: pwd,
          oninput: (e) => { pwd = e.target.value; } })),
      el('div.field', el('label', { text: 'Repeat it' }),
        el('input', { type: 'password', autocomplete: 'new-password', value: again,
          oninput: (e) => { again = e.target.value; } })),
      error ? el('p.note', { style: { color: 'var(--red)' }, text: error }) : null,
      el('button.big', { text: busy ? 'Changing…' : 'Change it', disabled: busy, onclick: async () => {
        if (pwd.length < 6) return render('At least six characters.');
        if (pwd !== again) return render('The two do not match.');
        if (!navigator.onLine) return render('You need the network to change a password.');
        busy = true; render();
        try { await sync.changePassword(pwd); } catch (e) { busy = false; return render(e.message); }
        toast('Password changed');
        close(); ctx.refresh();
      } }),
      el('p.note', { text: 'You stay signed in on this device. Other devices keep working until they sign out.' }));
    render();
    return [];
  });
}

async function exportBackup() {
  const raw = await DB.loadAll();
  const payload = {
    app: 'momo-booth-ledger', version: 1, exported_at: new Date().toISOString(),
    settings: { ...store.state.settings, supabaseKey: '' },   // never put the key in a file that travels
    rows: raw,
  };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const who = (store.state.settings.boothName || 'booth').trim().toLowerCase().split(/\s+/)[0]
    .replace(/[^a-z0-9]+/g, '') || 'booth';
  a.download = `${who}-backup-${dayKey(new Date())}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 20000);
  toast('Backup exported');
}

function importBackup(ctx) {
  const input = el('input', { type: 'file', accept: '.json', style: { display: 'none' } });
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== 'momo-booth-ledger') throw new Error('not a ledger backup');
      let n = 0;
      for (const [store_, rows] of Object.entries(data.rows || {})) {
        if (!DB.STORE_NAMES.includes(store_)) continue;
        /* imported rows are queued for the next push, so a restored device
           feeds the booth's other devices too */
        const fresh = rows.map(({ pending, ...r }) => r);
        await DB.append(store_, fresh);
        n += fresh.length;
      }
      await store.reload();
      toast(`${n} rows imported`);
      ctx.refresh();
    } catch (e) { toast('Import failed: ' + e.message, { error: true }); }
  };
  document.body.append(input);
  input.click();
  setTimeout(() => input.remove(), 60000);
}
