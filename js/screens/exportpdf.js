/* ═══════════════ PDF EXPORT (spec §8) ═══════════════
   Every checkbox is independent. All unchecked = dates and transactions only,
   customer numbers masked.                                                   */

import { el, card, chipRow, toast } from '../ui.js';
import { dayLabel, today, addDays, monthKey, parseDay, dayKey } from '../util.js';
import { buildRegister, suggestedName } from '../report.js';
import * as store from '../store.js';

const SCOPES = [
  { value: 'day', label: 'One day' }, { value: 'week', label: 'A week' },
  { value: 'month', label: 'A month' }, { value: 'year', label: 'A year' },
  { value: 'range', label: 'Two dates' },
];

const OPTIONS = [
  ['balances', 'Include opening and closing balances'],
  ['statistics', 'Include statistics'],
  ['extras', 'Include estimated extra fees'],
  ['cancelled', 'Include cancelled lines (struck through)'],
  ['debts', 'Include who still owes'],
  ['agents', 'Include who wrote each line'],
  ['fullNumbers', 'Show full customer numbers'],
];

export function exportScreen(ctx) {
  const st = ctx.exportState;
  const range = rangeOf(st);
  const booth = store.state.settings.exportPassword || '';
  const password = st.password === null ? booth : st.password;
  const count = store.state.txs.filter((t) => t.day >= range.start && t.day <= range.end
    && (st.options.cancelled || !t.cancelled)).length;

  return el('div.sheetview',
    el('div',
      card('What to export', [
        chipRow(SCOPES, st.scope, (v) => { st.scope = v; ctx.refresh(); }),
        st.scope === 'range'
          ? el('div.field', { style: { marginTop: '12px' } },
              el('label', { text: 'From, to' }),
              el('div.grid2',
                el('input', { type: 'date', value: st.from, max: today(),
                  onchange: (e) => { st.from = e.target.value; ctx.refresh(); } }),
                el('input', { type: 'date', value: st.to, max: today(),
                  onchange: (e) => { st.to = e.target.value; ctx.refresh(); } })))
          : el('div.field', { style: { marginTop: '12px' } },
          el('label', { text: st.scope === 'year' ? 'Year' : st.scope === 'month' ? 'Month' : 'Date inside the period' }),
          st.scope === 'year'
            ? el('input', { type: 'number', min: '2020', max: '2100', value: st.anchor.slice(0, 4),
                onchange: (e) => { st.anchor = `${e.target.value}-01-01`; ctx.refresh(); } })
            : st.scope === 'month'
              ? el('input', { type: 'month', value: monthKey(st.anchor),
                  onchange: (e) => { st.anchor = `${e.target.value}-01`; ctx.refresh(); } })
              : el('input', { type: 'date', value: st.anchor, max: today(),
                  onchange: (e) => { st.anchor = e.target.value; ctx.refresh(); } })),
        el('p.note', { text: `${dayLabel(range.start, { weekday: false })} → ${dayLabel(range.end, { weekday: false })} · ${count} line${count === 1 ? '' : 's'}` }),
      ]),

      card('Options', [
        ...OPTIONS.map(([k, label]) => el('label', {
          style: { display: 'flex', gap: '10px', alignItems: 'center', textTransform: 'none',
            fontSize: '14px', letterSpacing: '0', color: 'var(--ink)', margin: '0 0 12px' },
        },
          el('input', { type: 'checkbox', checked: st.options[k], style: { width: '22px', height: '22px', minHeight: '22px' },
            onchange: (e) => { st.options[k] = e.target.checked; ctx.refresh(); } }),
          el('span', { text: label }))),
        el('p.note', { text: st.options.fullNumbers
          ? 'Full numbers will be printed. Only do this if the person receiving the file is allowed to see them.'
          : 'Customer numbers are masked (024 *** 3456).' }),
      ]),

      card('Password (optional)', [
        el('div.field',
          el('input', { type: 'text', placeholder: 'Leave empty for no password', value: password,
            oninput: (e) => { st.password = e.target.value; ctx.refresh(); } })),
        password
          ? el('p.note', { text: 'Every register you export carries this password. Whoever receives the file needs it to open it.' })
          : el('p.note', { style: { color: 'var(--red)' }, text: 'This register will open without a password. Set one in Settings to lock every export.' }),
        el('p.note', { text: 'This is the PDF format’s own lock: it keeps a casual reader out, not somebody determined. What really protects the file is what is left out of it — customer numbers are masked unless the box above is ticked.' }),
      ]),

      el('button.big', { text: 'Generate PDF', onclick: () => generate(st, range, password) }),
    ),
    el('div', card('What the file looks like', [
      el('p.lead', { text: 'The page, printed: the date as a heading, then one line each — the number, the network, in or out, the amount. It can be handed over as a record.' }),
      el('p.note', { style: { marginTop: '8px' }, text: 'With every box unchecked the file holds the lines and nothing else, numbers masked.' }),
      el('p.note', { style: { marginTop: '8px' }, text: 'It is generated on the device: nothing is uploaded to make it.' }),
    ])),
  );
}

function rangeOf(st) {
  const a = st.anchor;
  if (st.scope === 'range') {
    /* whichever way round they were picked */
    const [start, end] = [st.from, st.to].sort();
    return { start, end };
  }
  if (st.scope === 'day') return { start: a, end: a };
  if (st.scope === 'week') {
    const d = parseDay(a);
    const monday = addDays(dayKey(d), -((d.getDay() + 6) % 7));
    return { start: monday, end: addDays(monday, 6) };
  }
  if (st.scope === 'month') {
    const [y, m] = a.split('-').map(Number);
    return { start: `${a.slice(0, 7)}-01`, end: dayKey(new Date(y, m, 0)) };
  }
  return { start: `${a.slice(0, 4)}-01-01`, end: `${a.slice(0, 4)}-12-31` };
}

function generate(st, range, password) {
  try {
    const bytes = buildRegister({
      boothName: store.state.settings.boothName,
      range, days: store.state.days, txs: store.state.txs,
      debtEntries: store.state.debtEntries, debtAccounts: store.state.debtAccounts,
      commissions: store.state.commissions,
      options: st.options, password,
    });
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedName(store.state.settings.boothName, range, st.scope);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    toast('PDF generated');
  } catch (e) {
    toast('Could not generate: ' + e.message, { error: true });
  }
}

export const initialExportState = () => ({
  scope: 'day', anchor: today(), from: today(), to: today(),
  /* null means untouched: the booth's own password is used, whatever it is
     at the moment of the export */
  password: null,
  options: { balances: false, statistics: false, extras: false, cancelled: false,
    debts: false, agents: false, fullNumbers: false },
});
