/* ═══════════════ THE DOOR ═══════════════
   One door: the account. Everybody works on their own phone or laptop, so the
   device is already the person's; what the booth needs to know is who is
   writing, and that is what the account says.

   The PIN this app used to ask for is gone: a device that still carries one
   drops it quietly the next time the page opens.                            */

import { el } from '../ui.js';
import * as DB from '../db.js';
import * as sync from '../sync.js';
import { needsAccount, CONFIG } from '../config.js';

const logo = () => el('div', { style: { textAlign: 'center' } },
  el('img.mark', { src: 'icons/icon-192.png', alt: 'PACSBI Limited', width: 96, height: 96 }),
  el('h1', { text: 'PACSBI Register' }),
  el('div.l2', { text: 'mobile money' }));

function shell(root, ...kids) {
  document.body.classList.add('locked');
  root.replaceChildren(el('div.lock', ...kids));
}
const opened = (resolve) => { document.body.classList.remove('locked'); resolve(); };

/* Resolves once the page may open. */
export function lockScreen(root) {
  return new Promise((resolve) => {
    (async () => {
      /* a device set up under the old version still carries a PIN; it is
         dropped here, once, without asking */
      if (await DB.getMeta('pinHash', '')) await DB.setMeta('pinHash', null);
      accountDoor(root, resolve);
    })();
  });
}

async function accountDoor(root, resolve) {
  if (!needsAccount()) return opened(resolve);
  if (!sync.hasSession()) return renderSignIn(root, resolve);
  const check = await sync.ensureMembership();
  if (check.ok) return opened(resolve);
  return renderSignIn(root, resolve,
    check.expired ? 'Your session has ended. Sign in again.' : sync.notOnTheList(check));
}

/* ── the account ── */
function renderSignIn(root, resolve, firstError = null) {
  let email = '', password = '', busy = false;
  const render = (error = firstError) => shell(root,
    logo(),
    el('p.lead', { style: { textAlign: 'center', margin: '14px 0' },
      text: 'The booth’s register: every line written at the counter, the morning and evening counts, and what is owed — the same on every device.' }),
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
          const check = await sync.ensureMembership();
          if (!check.ok) { busy = false; return render(sync.notOnTheList(check)); }
        } catch (e) {
          busy = false;
          return render(
            /invalid|credential|grant/i.test(e.message) ? 'Wrong email or password.'
            : /failed to fetch|network|load failed/i.test(e.message) ? 'Could not reach the booth server. Check the network and try again.'
            : e.message);
        }
        busy = false;
        opened(resolve);
      },
    }),
    CONFIG.googleSignIn
      ? el('button.big.quiet', { text: 'Continue with Google', style: { marginTop: '10px' },
          onclick: () => {
            if (!navigator.onLine) return render('You need the network to sign in the first time.');
            sync.googleSignIn();
          } })
      : null,
    el('p.note', { style: { textAlign: 'center' },
      text: 'Access is by account, and this device stays signed in afterwards.' }));
  render();
}
