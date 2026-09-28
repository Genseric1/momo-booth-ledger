/* ═══════════════ FIRST RUN + PIN LOCK (spec §9) ═══════════════ */

import { el, toast } from '../ui.js';
import * as DB from '../db.js';
import * as store from '../store.js';
import * as sync from '../sync.js';
import { needsAccount } from '../config.js';
import { pinHash, unlock } from '../crypto.js';

const logo = () => el('div', { style: { textAlign: 'center' } },
  el('h1', { text: 'MoMo Ledger' }),
  el('div.l2', { text: 'the booth page' }));

const pad = (onDigit, onBack, onOk, okLabel) => el('div.keys',
  ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => el('button', { text: d, onclick: () => onDigit(d) })),
  el('button', { text: '⌫', onclick: onBack }),
  el('button', { text: '0', onclick: () => onDigit('0') }),
  el('button', { text: okLabel || '✓', onclick: onOk }));

/* Returns a promise that resolves once the app is open.
   Two doors, in this order: the account (once, needs the network), then the
   booth PIN (every time, works offline). */
export function lockScreen(root) {
  return new Promise((resolve) => {
    const pinDoor = () => DB.getMeta('pinHash', '').then((saved) => {
      saved ? renderUnlock(root, resolve, saved) : renderSetup(root, resolve);
    });
    /* A signed-in device keeps its session, so a lost network never locks the
       agent out of his own page. */
    if (needsAccount() && !sync.hasSession()) renderSignIn(root, pinDoor);
    else pinDoor();
  });
}

function renderSignIn(root, next) {
  let email = '', password = '', busy = false;
  const render = (error = null) => shell(root,
    logo(),
    el('p.lead', { style: { textAlign: 'center', margin: '14px 0' },
      text: 'Sign in once on this phone. Afterwards the page opens with the PIN, with or without network.' }),
    el('div.field',
      el('label', { text: 'Email' }),
      el('input', { type: 'email', inputmode: 'email', autocomplete: 'username', value: email,
        oninput: (e) => { email = e.target.value.trim(); } })),
    el('div.field',
      el('label', { text: 'Password' }),
      el('input', { type: 'password', autocomplete: 'current-password', value: password,
        oninput: (e) => { password = e.target.value; } })),
    error ? el('p.note', { style: { color: 'var(--red)' }, text: error }) : null,
    el('button.big', {
      text: busy ? 'Signing in…' : 'Sign in', disabled: busy,
      onclick: async () => {
        if (!email || !password) return render('Email and password, please.');
        if (!navigator.onLine) return render('You need the network once, to sign in the first time.');
        busy = true; render();
        try {
          await sync.signIn(email, password);
        } catch (e) {
          busy = false;
          return render(
            /invalid|credential|grant/i.test(e.message) ? 'Wrong email or password.'
            : /failed to fetch|network|load failed/i.test(e.message) ? 'Could not reach the booth server. Check the network and try again.'
            : e.message);
        }
        busy = false;
        next();
      },
    }),
    el('p.note', { style: { textAlign: 'center' },
      text: 'The manager creates the accounts. Ask him if you do not have one.' }));
  render();
}

function shell(root, ...kids) {
  document.body.classList.add('locked');
  root.replaceChildren(el('div.lock', ...kids));
}

function renderUnlock(root, resolve, saved) {
  let pin = '';
  const dots = el('div.dots');
  const paint = () => dots.replaceChildren(
    ...Array.from({ length: Math.max(4, pin.length) }, (_, i) => el(`i${i < pin.length ? '.on' : ''}`)));
  const submit = async () => {
    const booth = store.state.settings.boothId || 'local';
    if (await pinHash(pin, booth) !== saved) { pin = ''; paint(); return toast('Wrong PIN', { error: true }); }
    /* the numbers may have been written before this device joined the booth */
    const moved = await store.rekeyNumbers(pin);
    await unlock(pin, booth);
    if (moved) toast(`${moved} customer numbers carried over`);
    document.body.classList.remove('locked');
    resolve();
  };
  paint();
  shell(root,
    logo(),
    el('p.lead', { style: { textAlign: 'center', marginTop: '14px' }, text: 'Enter the booth PIN' }),
    dots,
    pad((d) => { if (pin.length < 8) { pin += d; paint(); } },
        () => { pin = pin.slice(0, -1); paint(); },
        submit, 'OK'));
}

function renderSetup(root, resolve) {
  const st = { step: 1, booth: store.state.settings.boothName, agents: [], pin: '', again: '' };
  const render = () => {
    if (st.step === 1) {
      shell(root,
        logo(),
        el('p.lead', { style: { textAlign: 'center', margin: '14px 0' }, text: 'Set up this booth once. It works offline afterwards.' }),
        el('div.field', el('label', { text: 'Booth name' }),
          el('input', { value: st.booth, oninput: (e) => { st.booth = e.target.value; } })),
        el('div.field', el('label', { text: 'Agents, separated by commas (optional)' }),
          el('input', { placeholder: 'Kofi, Ama', oninput: (e) => { st.agentsRaw = e.target.value; } })),
        el('button.big', { text: 'Continue', onclick: () => { st.step = 2; render(); } }));
      return;
    }
    const dots = el('div.dots');
    const current = () => (st.pin.length < 4 || !st.confirming ? st.pin : st.again);
    const paint = () => dots.replaceChildren(
      ...Array.from({ length: Math.max(4, current().length) }, (_, i) => el(`i${i < current().length ? '.on' : ''}`)));
    paint();
    const digit = (d) => { if (current().length >= 8) return; st.confirming ? (st.again += d) : (st.pin += d); paint(); };
    const back = () => { st.confirming ? (st.again = st.again.slice(0, -1)) : (st.pin = st.pin.slice(0, -1)); paint(); };
    const ok = async () => {
      if (!st.confirming) {
        if (!/^\d{4,8}$/.test(st.pin)) return toast('4 to 8 digits', { error: true });
        st.confirming = true; render(); return;
      }
      if (st.pin !== st.again) { st.again = ''; st.confirming = false; st.pin = ''; render(); return toast('The two PINs differ', { error: true }); }
      const agents = (st.agentsRaw || '').split(',').map((a) => a.trim()).filter(Boolean);
      await store.saveSettings({ boothName: st.booth.trim() || 'Booth', agents });
      const booth = store.state.settings.boothId || 'local';
      await DB.setMeta('pinHash', await pinHash(st.pin, booth));
      await store.saveSettings({ cryptoBoothId: booth });
      await unlock(st.pin, booth);
      document.body.classList.remove('locked');
      toast('Booth ready');
      resolve();
    };
    shell(root,
      logo(),
      el('p.lead', { style: { textAlign: 'center', margin: '14px 0 0' },
        text: st.confirming ? 'Repeat the PIN' : 'Choose a booth PIN (4 to 8 digits)' }),
      el('p.note', { style: { textAlign: 'center' }, text: 'It locks the page and encrypts customer numbers on this device.' }),
      dots,
      pad(digit, back, ok, 'OK'),
      el('button.big.quiet', { text: 'Back', onclick: () => { st.step = 1; st.confirming = false; st.pin = ''; st.again = ''; render(); } }));
  };
  render();
}
