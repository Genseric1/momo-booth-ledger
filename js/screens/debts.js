/* ═══════════════ WHO OWES WHOM ═══════════════
   A name, an amount, and which way it goes. It sits in the capital until it
   comes back, then it leaves the list. Nothing else: no accounts to open, no
   kinds of entry to choose from.                                             */

import { el, fill, sheet, toast, amountInput, confirmSheet } from '../ui.js';
import { WALLETS, WALLET_LABEL, money, today } from '../util.js';
import { debtBalances } from '../calc.js';
import * as store from '../store.js';
import * as sync from '../sync.js';

/* One person = one open balance, whichever way it points. */
function people() {
  const bal = debtBalances(store.state.debtEntries);
  return store.state.debtAccounts.map((a) => {
    const b = bal.perAccount.get(a.account_id) || { owed_to_us: 0, we_owe: 0, net: 0 };
    return { ...a, ...b, open: Math.abs(b.net) > 0.004 };
  });
}

export function debtsScreen(ctx) {
  const open = people().filter((p) => p.open);
  const owedToUs = open.filter((p) => p.net > 0).reduce((t, p) => t + p.net, 0);
  const weOwe = open.filter((p) => p.net < 0).reduce((t, p) => t - p.net, 0);
  const write = sync.canWrite();

  return el('div.sheetview',
    el('div.hero',
      el('div.k', { text: 'In the capital right now' }),
      el('div.v.num', { text: money(owedToUs - weOwe, { sign: true, dp: 0 }) }),
      el('div.s', { text: owedToUs || weOwe
        ? `${money(owedToUs, { dp: 0 })} owed to us · ${money(weOwe, { dp: 0 })} we owe`
        : 'nobody owes anybody' })),

    open.length
      ? el('div.rows', open.map((p) => el(write ? 'button.r' : 'div.r', {
          onclick: write ? () => settleSheet(ctx, p) : null,
        },
        el('div', { text: p.name },
          el('small', { text: p.net > 0 ? 'owes us' : 'we owe' })),
        el('div.sp'),
        el('div.v.num', { class: p.net > 0 ? 'pos' : 'neg', text: money(Math.abs(p.net), { dp: 0 }) }),
        write ? el('div.go', { text: '›' }) : null)))
      : el('p.lead', { style: { marginTop: '18px' }, text: 'Nothing outstanding.' }),

    write ? el('div', { style: { marginTop: '20px' } },
      el('button.big', { text: 'Someone owes us', onclick: () => addSheet(ctx, 'owed_to_us') }),
      el('button.big.quiet', { text: 'We owe someone', style: { marginTop: '8px' },
        onclick: () => addSheet(ctx, 'we_owe') })) : null,

    el('p.note', { style: { marginTop: '18px' },
      text: 'Lending takes the money out of the till and puts it here, so the capital does not move. When it comes back, the line leaves this page — the entries stay in the exported register.' }),
  );
}

/* Adding: a name, an amount, and what it came out of. */
function addSheet(ctx, direction) {
  const st = { name: '', amount: '', wallet: 'CASH' };
  const known = store.state.debtAccounts;
  sheet(direction === 'owed_to_us' ? 'Someone owes us' : 'We owe someone', ({ body, close }) => {
    const note = el('p.note');
    const sayEffect = () => { note.textContent = effect(direction, st); };
    const render = () => fill(body,
      el('div.field',
        el('label', { text: 'Who' }),
        el('input', { value: st.name, placeholder: 'name', autocomplete: 'off',
          oninput: (e) => { st.name = e.target.value; } }),
        known.length ? el('div.pick', { style: { marginTop: '8px' } }, known.slice(0, 6).map((a) =>
          el('button', { text: a.name, onclick: (e) => {
            st.name = a.name;
            e.target.closest('.field').querySelector('input').value = a.name;
          } }))) : null),
      el('div.field', el('label', { text: 'How much' }),
        amountInput({ value: st.amount, oninput: (v) => { st.amount = v; sayEffect(); } })),
      el('div.field',
        el('label', { text: direction === 'owed_to_us' ? 'Taken out of' : 'Put into' }),
        el('div.pick', WALLETS.map((w) => el(`button${st.wallet === w ? '.on' : ''}`, {
          text: WALLET_LABEL[w], onclick: () => { st.wallet = w; render(); } })))),
      note,
      el('button.big', { text: 'Save', style: { marginTop: '10px' }, onclick: async () => {
        if (!st.name.trim()) return toast('Who?', { error: true });
        if (!(Number(st.amount) > 0)) return toast('How much?', { error: true });
        const account_id = await accountFor(st.name.trim());
        await store.addDebtEntry({
          account_id, day: ctx.date || today(), wallet: st.wallet, amount: Number(st.amount),
          kind: direction === 'owed_to_us' ? 'lend' : 'borrow', agent: ctx.agent || null,
        });
        toast('Written down'); close(); ctx.refresh();
      } }));
    render();
    sayEffect();
    return [];
  });
}

/* Settling: the amount comes back, and when nothing is left the line goes. */
function settleSheet(ctx, person) {
  const owed = person.net > 0;
  const st = { amount: String(Math.abs(person.net)), wallet: 'CASH' };
  sheet(person.name, ({ body, close }) => {
    const render = () => fill(body,
      el('p.lead', { text: owed
        ? `${person.name} owes ${money(Math.abs(person.net), { dp: 0 })}.`
        : `We owe ${person.name} ${money(Math.abs(person.net), { dp: 0 })}.` }),
      el('div.field', el('label', { text: owed ? 'Paid back' : 'We paid back' }),
        amountInput({ value: st.amount, oninput: (v) => { st.amount = v; } })),
      el('div.field', el('label', { text: owed ? 'Received into' : 'Paid out of' }),
        el('div.pick', WALLETS.map((w) => el(`button${st.wallet === w ? '.on' : ''}`, {
          text: WALLET_LABEL[w], onclick: () => { st.wallet = w; render(); } })))),
      el('button.big', { text: 'Paid back', onclick: async () => {
        const value = Number(st.amount);
        if (!(value > 0)) return toast('How much?', { error: true });
        if (value > Math.abs(person.net) + 0.004) return toast('That is more than is owed', { error: true });
        await store.addDebtEntry({
          account_id: person.account_id, day: ctx.date || today(), wallet: st.wallet, amount: value,
          kind: owed ? 'repay_received' : 'repay_paid', agent: ctx.agent || null,
        });
        toast(value >= Math.abs(person.net) - 0.004 ? 'Settled' : 'Part paid back');
        close(); ctx.refresh();
      } }),
      el('button.big.warn', { text: 'Cancel this debt', style: { marginTop: '8px' }, onclick: async () => {
        if (!await confirmSheet('Cancel the debt',
          'Written down by mistake? The entries are struck out and the money goes back where it was.',
          { danger: true, okLabel: 'Cancel it' })) return;
        for (const e of store.state.debtEntries.filter((e) => e.account_id === person.account_id && !e.cancelled)) {
          await store.cancelDebtEntry(e.entry_id);
        }
        toast('Cancelled'); close(); ctx.refresh();
      } }));
    render();
    return [];
  });
}

/* The person is the account: the same name reuses the same one. */
async function accountFor(name) {
  const found = store.state.debtAccounts.find((a) => a.name.toLowerCase() === name.toLowerCase());
  if (found) return found.account_id;
  const created = await store.addDebtAccount(name);
  return created.account_id;
}

function effect(direction, st) {
  const a = Number(st.amount || 0);
  const w = WALLET_LABEL[st.wallet];
  return direction === 'owed_to_us'
    ? `${w} goes down by ${money(a, { dp: 0 })} and the same amount waits here. The capital does not move.`
    : `${w} goes up by ${money(a, { dp: 0 })} and the same amount is owed. The capital does not move.`;
}

export { addSheet as entrySheet };
