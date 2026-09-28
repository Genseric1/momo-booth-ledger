/* ═══════════════ THE PAGE ═══════════════
   The lines of the day, and nothing beside them. The balances are counted twice
   a day, in the morning and at night — so that is where they are shown. What
   stays here is a reminder, for as long as a count is still missing.          */

import { el } from '../ui.js';
import { WALLET_LABEL, money, displayNumber, today } from '../util.js';
import { dayReport, debtBalances } from '../calc.js';
import * as store from '../store.js';
import * as sync from '../sync.js';
import { editLine } from './editline.js';

const DIR = { cash_in: 'in', cash_out: 'out', airtime: 'air', bundle: 'bdl' };
const CLS = { cash_in: 'in', cash_out: 'out', airtime: 'other', bundle: 'other' };
const DEBT_DIR = { lend: 'owes us', borrow: 'we owe', repay_received: 'paid back', repay_paid: 'we paid' };

export function reportFor(date) {
  return dayReport({
    day: store.getDay(date) || { date },
    txs: store.dayTxs(date),
    dayDebts: store.dayDebtEntries(date),
    carried: debtBalances(store.state.debtEntries.filter((e) => e.day < date)),
  });
}

export function pageScreen(ctx) {
  const rep = reportFor(ctx.date);
  const txs = store.dayTxs(ctx.date).slice().reverse();      // written downwards, like the page
  const debts = store.dayDebtEntries(ctx.date).filter((e) => !e.cancelled);
  const mode = store.state.settings.numberStorage;
  const write = sync.canWrite();

  const lines = txs.map((t) => el(`${write ? 'button' : 'div'}.line.${CLS[t.type]}${t.cancelled ? '.off' : ''}`, {
    onclick: write ? () => editLine(t, ctx) : null,
  },
    el('div.who.num', { text: displayNumber(t.customer_number, mode) || '—' }),
    el('div.net', { text: WALLET_LABEL[t.wallet].toLowerCase() }),
    el('div.dir', { text: DIR[t.type] }),
    el('div.amt.num', { text: money(t.amount, { dp: 0 }) })));

  /* a debt written at the counter sits among the lines of its day, oldest first
     like everything else on the page */
  for (const e of debts.slice().reverse()) {
    const name = store.state.debtAccounts.find((a) => a.account_id === e.account_id)?.name || 'someone';
    lines.push(el(`${write ? 'button' : 'div'}.line.debt`, { onclick: write ? () => ctx.go('debts') : null },
      el('div.who', { text: name }),
      el('div.net', { text: WALLET_LABEL[e.wallet].toLowerCase() }),
      el('div.dir', { text: DEBT_DIR[e.kind] }),
      el('div.amt.num', { text: money(e.amount, { dp: 0 }) })));
  }

  return el('div.book',
    reminder(rep, ctx),
    el('div.sheetpage', lines.length ? lines
      : el('div.page-empty', { text: write ? 'Empty page. Write the first line below.' : 'Nothing written on this day.' })),
  );
}

/* One line, only while something is still owed to the day. */
function reminder(rep, ctx) {
  if (!sync.canWrite() || rep.closed) return null;
  const isToday = ctx.date === today();

  if (!rep.hasOpening) {
    return el('button.remind', { onclick: () => ctx.go('morning') },
      el('span', { text: isToday ? 'The morning count is not written yet' : 'This day has no morning count' }),
      el('b', { text: 'write it' }));
  }
  const late = !isToday || new Date().getHours() >= 16;
  if (!rep.hasClosing && rep.txCount > 0 && late) {
    return el('button.remind.evening', { onclick: () => ctx.go('evening') },
      el('span', { text: isToday ? 'Time to count the evening' : 'This day was never counted at night' }),
      el('b', { text: 'count it' }));
  }
  return null;
}
