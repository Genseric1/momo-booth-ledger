/* ═══════════════ THE PAGE ═══════════════
   What the agent looks at all day: the page of the notebook and, under it, the
   totals block that writes itself. A line is written exactly as on paper —
   the number, then in or out, then the amount.                               */

import { el, toast } from '../ui.js';
import { WALLETS, WALLET_LABEL, money, addDays, displayNumber } from '../util.js';
import { dayReport, debtBalances } from '../calc.js';
import * as store from '../store.js';
import { editLine } from './editline.js';

const DIR = { cash_in: 'in', cash_out: 'out', airtime: 'air', bundle: 'bdl' };
const CLS = { cash_in: 'in', cash_out: 'out', airtime: 'other', bundle: 'other' };

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
  const mode = store.state.settings.numberStorage;

  const lines = txs.length
    ? txs.map((t) => el(`button.line.${CLS[t.type]}${t.cancelled ? '.off' : ''}`, {
        onclick: () => editLine(t, ctx),
      },
      el('div.who.num', { text: displayNumber(t.customer_number, mode) || '—' }),
      el('div.net', { text: WALLET_LABEL[t.wallet].toLowerCase() }),
      el('div.dir', { text: DIR[t.type] }),
      el('div.amt.num', { text: money(t.amount, { dp: 0 }) })))
    : [el('div.page-empty', { text: 'Empty page. Write the first line below.' })];

  return el('div.book',
    el('div', { class: 'left' },
      el('div.sheetpage', lines),
      totalsBlock(rep, ctx, 'phone')),
    el('div', { class: 'right' }, totalsBlock(rep, ctx, 'pc')),
  );
}

/* The block written at the foot of the page: each network, then the total. */
function totalsBlock(rep, ctx, where) {
  const b = (w) => rep.hasOpening ? rep.expected[w] : rep.movement[w];
  return el(`div.totals${where === 'pc' ? '' : '.on-phone'}`,
    ...WALLETS.map((w) => el('div.t',
      el('div.k', { text: WALLET_LABEL[w] }),
      el('div.d.num', { text: rep.movement[w] ? money(rep.movement[w], { sign: true, dp: 0 }) : '' }),
      el('div.v.num', { text: money(b(w), { dp: 0 }) }))),
    el('div.sum',
      el('div.k', { text: 'TOTAL' }),
      el('div.v.num', { text: money(rep.hasOpening ? rep.expectedCapital : 0, { dp: 0 }) })),
    message(rep, ctx),
  );
}

function message(rep, ctx) {
  if (!rep.hasOpening) {
    const prev = reportFor(addDays(ctx.date, -1));
    return el('div.msg',
      'No morning count yet. ',
      prev.hasClosing
        ? el('button', {
            text: `Take yesterday's (${money(prev.realCapital, { dp: 0 })})`,
            onclick: async () => {
              await store.setOpening(ctx.date, prev.real, null);
              toast('Morning taken from yesterday');
              ctx.refresh();
            },
          })
        : el('button', { text: 'Write the morning count', onclick: () => ctx.go('morning') }));
  }
  if (!rep.hasClosing) {
    return el('div.msg', `${rep.txCount} line${rep.txCount === 1 ? '' : 's'} today. `,
      el('button', { text: 'Count the evening', onclick: () => ctx.go('evening') }));
  }
  const gap = rep.residualGap != null ? rep.residualGap : rep.totalGap;
  if (Math.abs(gap) < 0.005) {
    return el('div.msg', el('b', { text: 'The evening count is exact.' }), ' ',
      el('button', { text: 'See it', onclick: () => ctx.go('evening') }));
  }
  return el('div.msg.warn',
    el('b', { text: `${money(Math.abs(gap), { dp: 0 })} ${gap > 0 ? 'more' : 'missing'}` }),
    ' against the page. ',
    el('button', { text: 'Why', onclick: () => ctx.go('evening') }));
}
