/* ═══════════════ LOOKING SOMETHING UP ═══════════════
   "Did I do that transaction, and when?" — digits look through the numbers and
   the amounts, words look through the network, the agent and the note.        */

import { el, fill } from '../ui.js';
import { WALLET_LABEL, money, dayLabel, displayNumber, normalizeNumber } from '../util.js';
import * as store from '../store.js';

const DIR = { cash_in: 'in', cash_out: 'out', airtime: 'air', bundle: 'bdl' };

export function searchScreen(ctx) {
  const out = el('div.sheetview');
  const results = el('div');
  const mode = store.state.settings.numberStorage;

  const run = (q) => {
    ctx.query = q;
    const term = q.trim().toLowerCase();
    if (term.length < 2) {
      fill(results, el('p.lead', { text: 'Type at least two characters — a piece of a number, an amount, a name.' }));
      return;
    }
    const digits = normalizeNumber(term);
    const hits = store.state.txs.filter((t) => {
      if (digits.length >= 2) {
        if ((t.customer_number || '').includes(digits)) return true;
        if (String(t.amount).startsWith(digits)) return true;
      }
      return [WALLET_LABEL[t.wallet], DIR[t.type], t.agent, t.note, t.sub_type]
        .filter(Boolean).join(' ').toLowerCase().includes(term);
    }).slice(0, 80);

    fill(results,
      el('p.note', { text: hits.length ? `${hits.length} line${hits.length === 1 ? '' : 's'} found` : 'Nothing written like that.' }),
      el('div.rows', hits.map((t) => el('button.r', { onclick: () => { ctx.setDate(t.day); ctx.go('page'); } },
        el('div', { text: displayNumber(t.customer_number, mode) || '—' },
          el('small', { text: `${dayLabel(t.day)} · ${WALLET_LABEL[t.wallet].toLowerCase()} · ${DIR[t.type]}${t.cancelled ? ' · struck out' : ''}` })),
        el('div.sp'),
        el('div.v.num', { class: t.cancelled ? 'neg' : '', text: money(t.amount, { dp: 0 }) }),
        el('div.go', { text: '›' })))));
  };

  out.append(
    el('div.field',
      el('label', { text: 'Look for' }),
      el('input', { type: 'search', value: ctx.query || '', autocomplete: 'off',
        placeholder: 'a number, an amount, a name', oninput: (e) => run(e.target.value) })),
    results);
  run(ctx.query || '');
  setTimeout(() => out.querySelector('input')?.focus(), 60);
  return out;
}
