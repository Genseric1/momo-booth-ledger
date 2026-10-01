/* ═══════════════ WHO OWES WHOM ═══════════════
   A name, an amount, and which way it goes. It sits in the capital until it
   comes back, then it leaves the list. Nothing else: no accounts to open, no
   kinds of entry to choose from.                                             */

import { el, fill, sheet, toast, amountInput, confirmSheet } from '../ui.js';
import { WALLETS, WALLET_LABEL, money, today, foldName, looksLike } from '../util.js';
import { openBalances } from '../calc.js';
import * as store from '../store.js';
import * as sync from '../sync.js';

/* One person = one open balance, whichever way it points. */
const people = () => openBalances(store.state.debtEntries, store.state.debtAccounts);

export function debtsScreen(ctx) {
  const open = people();
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
  const st = { name: '', amount: '', wallet: 'CASH', fresh: !store.state.debtAccounts.length };
  const known = store.state.debtAccounts;
  sheet(direction === 'owed_to_us' ? 'Someone owes us' : 'We owe someone', ({ body, close }) => {
    const note = el('p.note');
    const sayEffect = () => { note.textContent = effect(direction, st); };
    const render = () => fill(body,
      /* The people the booth already knows come first, and writing a name is
         the deliberate second step. A name typed from memory is how one
         person became two. */
      el('div.field',
        el('label', { text: 'Who' }),
        known.length ? el('div.pick', known.map((a) =>
          el(`button${foldName(st.name) === foldName(a.name) ? '.on' : ''}`, {
            text: a.name, onclick: () => { st.name = a.name; st.fresh = false; render(); },
          }))) : null,
        st.fresh
          ? el('input', { value: st.name, placeholder: 'name', autocomplete: 'off',
              style: { marginTop: '8px' }, oninput: (e) => { st.name = e.target.value; } })
          : el('button.big.quiet', { text: 'Someone new', style: { marginTop: '8px' },
              onclick: () => { st.fresh = true; st.name = ''; render(); } })),
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
/* Everyone the booth knows except the one being looked at — the names it could
   be merged into. Archived ones are already gone from this list. */
const othersThan = (id) => store.state.debtAccounts.filter((a) => a.account_id !== id);

function mergeSheet(ctx, person, closeParent) {
  const candidates = othersThan(person.account_id);
  sheet(`${person.name} is…`, ({ body, close }) => {
    fill(body,
      el('p.lead', { text: `Every entry written under ${person.name} moves onto the person you pick. Nothing is lost — the two debts become one.` }),
      el('div.rows', candidates.map((a) => el('button.r', {
        onclick: async () => {
          if (!await confirmSheet('Put them together',
            `${person.name} and ${a.name} are the same person. Everything written under ${person.name} moves onto ${a.name}.`,
            { okLabel: `Yes, one person` })) return;
          await store.mergeDebtAccounts(person.account_id, a.account_id);
          toast(`${person.name} and ${a.name} are one`);
          close(); closeParent(); ctx.refresh();
        },
      }, el('div', { text: a.name }), el('div.sp'), el('div.go', { text: '›' })))));
    return [];
  });
}

function settleSheet(ctx, person) {
  const owed = person.net > 0;
  const others = () => othersThan(person.account_id);
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
      /* Two spellings, one person: the halves are put back together rather
         than one of them deleted, so nothing of what was lent is lost. */
      others().length ? el('button.big.quiet', { text: 'Same person as…', style: { marginTop: '8px' },
        onclick: () => mergeSheet(ctx, person, close) }) : null,
      el('button.big.warn', { text: 'Delete this debt', style: { marginTop: '8px' }, onclick: async () => {
        if (!await confirmSheet('Delete the debt',
          'Written down by mistake? Every entry for this person is removed and the money goes back where it was.',
          { danger: true, okLabel: 'Delete' })) return;
        for (const e of store.state.debtEntries.filter((e) => e.account_id === person.account_id)) {
          await store.deleteDebtEntry(e.entry_id);
        }
        toast('Deleted'); close(); ctx.refresh();
      } }));
    render();
    return [];
  });
}

/* The person is the account. A name written a second time, spelled a little
   differently, used to open a second account — and the debt of one person sat
   in two halves, each looking complete. Anything that folds to the same name
   is the same person without asking; anything close enough to be a slip is
   asked about, because only the booth knows whether it really has both a
   Modest and a Modeste. */
async function accountFor(name) {
  const known = store.state.debtAccounts;
  const same = known.find((a) => foldName(a.name) === foldName(name));
  if (same) return same.account_id;

  /* Nobody is asked to arbitrate a spelling in the middle of a queue: a name
     close enough to be the same one is the same one, and the screen says which
     person it went to rather than deciding in silence. */
  const near = known.find((a) => looksLike(a.name, name));
  if (near) {
    toast(`Written under ${near.name}`);
    return near.account_id;
  }
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

/* The counts are where the balances live, so they are where a debt is written
   and settled. The pen at the foot of the page writes lines, nothing else. */
export { addSheet as entrySheet, settleSheet as personSheet };
