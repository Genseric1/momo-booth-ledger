/* ═══════════════ STATISTICS (spec §7) ═══════════════ */

import { el, card, tile, chipRow, bars, sheet, toast, fill, amountInput } from '../ui.js';
import { NETWORKS, WALLET_LABEL, money, dayLabel, monthKey, maskNumber } from '../util.js';
import { stats, rangeFor } from '../stats.js';
import * as store from '../store.js';

const PRESETS = [
  { value: 'day', label: '1 day' }, { value: 'week', label: '7 days' },
  { value: 'month', label: '30 days' }, { value: 'year', label: '12 months' },
  { value: 'custom', label: 'Custom' },
];

export function statsScreen(ctx) {
  const dates = store.datesWithData();
  const range = rangeFor(ctx.statsPreset, dates, ctx.statsCustom);
  const s = stats({
    range, txs: store.state.txs, days: store.state.days,
    debtEntries: store.state.debtEntries, commissions: store.state.commissions,
  });
  const pct = (v) => `${(v * 100).toFixed(1)}%`;

  return el('div.wrap',
    el('div', { class: 'full' }, card('Period', [
      chipRow(PRESETS, ctx.statsPreset, (v) => ctx.setStatsPreset(v)),
      ctx.statsPreset === 'custom' ? el('div', { style: { marginTop: '10px' } },
        el('div', el('label', { text: 'From' }), el('input', { type: 'date', value: range.start,
          onchange: (e) => ctx.setStatsCustom({ ...ctx.statsCustom, start: e.target.value }) })),
        el('div', el('label', { text: 'To' }), el('input', { type: 'date', value: range.end,
          onchange: (e) => ctx.setStatsCustom({ ...ctx.statsCustom, end: e.target.value }) }))) : null,
      el('p.note', { style: { marginTop: '8px' },
        text: `${dayLabel(range.start, { weekday: false })} → ${dayLabel(range.end, { weekday: false })} · the period ends on the last day with data · debts excluded` }),
    ])),

    el('div', { style: { display: 'grid', gap: '14px' } },
      card('Volume', [
        el('div.rows',
          tile('Transactions', String(s.count), `${s.perDayAverageCount.toFixed(1)} per day`),
          tile('Cash in', money(s.cashIn), `${s.byType.cash_in.count} lines`),
          tile('Cash out', money(s.cashOut), `${s.byType.cash_out.count} lines`),
          tile('Airtime + bundles', money(s.byType.airtime.total + s.byType.bundle.total),
            `${s.byType.airtime.count + s.byType.bundle.count} lines`)),
        el('div.rows', { style: { marginTop: '10px' } },
          tile('Total volume', money(s.volume), '', { accent: true }),
          tile('Average', money(s.average)),
          tile('Median', money(s.median)),
          tile('Largest', money(s.largest))),
      ]),

      card('By network', [
        el('div.scroll-x', el('table.tbl',
          el('tr', el('th', { text: '' }), el('th', { text: 'Volume' }), el('th', { text: 'Net float' }),
            el('th', { text: 'In/Out' }), el('th', { text: 'Volume share' }), el('th', { text: 'Count share' })),
          ...NETWORKS.map((w) => {
            const p = s.perNetwork[w];
            return el('tr', el('td', { text: WALLET_LABEL[w] }),
              el('td.num', { text: money(p.volume) }),
              el('td.num', { class: p.netFloat >= 0 ? 'pos' : 'neg', text: money(p.netFloat, { sign: true }) }),
              el('td.num', { text: p.inOutRatio === Infinity ? 'in only' : p.inOutRatio.toFixed(2) }),
              el('td.num', { text: pct(p.shareVolume) }),
              el('td.num', { text: pct(p.shareCount) }));
          }))),
        el('p.note', { style: { marginTop: '8px' },
          text: 'Net float + means the network gained float (more cash-out than cash-in); - means it lost float and will need a top-up.' }),
      ]),

      card('Busiest times', [
        el('label', { text: 'By weekday' }),
        bars(s.perWeekday.map((d) => ({ label: d.label, value: d.count }))),
        el('label', { style: { marginTop: '14px' }, text: 'By hour' }),
        bars(s.perHour.filter((h, i) => i >= 5 && i <= 22).map((h) => ({ label: h.label, value: h.count }))),
        el('p.note', { style: { marginTop: '8px' },
          text: `Busiest: ${s.busiestWeekday.label} · ${s.busiestHour.label}:00` }),
      ]),

      card('Capital over time', [
        s.capitalSeries.length > 1 ? spark(s.capitalSeries) : el('p.lead', { text: 'Needs at least two counted days.' }),
        el('p.note', { style: { marginTop: '6px' }, text: 'Evening capital: counted closing when available, otherwise expected.' }),
      ]),
    ),

    el('div', { style: { display: 'grid', gap: '14px' } },
      card('Gaps', [
        el('div.rows',
          tile('Days counted', String(s.daysClosed)),
          tile('Days with a gap', String(s.daysWithGap)),
          tile('Unexplained total', money(s.cumulativeGap, { sign: true }), '', { cls: Math.abs(s.cumulativeGap) > 0.004 ? 'neg' : '' }),
          tile('Extras estimated', money(s.cumulativeExtras))),
        el('p.note', { style: { marginTop: '8px' },
          text: 'The unexplained total is what is left after your own extras estimates. The app never decides whether a gap is an error or a fee.' }),
      ]),
      card('Cancelled lines', [
        el('div.rows',
          tile('Lines', String(s.cancelledCount)),
          tile('Amount', money(s.cancelledTotal))),
      ]),
      commissionCard(ctx, s),
      card('Most frequent customers', s.hasNumbers
        ? el('div', s.customers.map((c) => el('div.r', { style: { padding: '6px 0', borderBottom: '1px solid var(--rule2)' } },
            el('div', { style: { flex: '1' } }, el('div.v', {
              text: store.state.settings.numberStorage === 'full' ? c.number : maskNumber(c.number) })),
            el('p.note', { text: `${c.count} lines` }),
            el('div.strong.num', { style: { marginLeft: '10px' }, text: money(c.total) }))))
        : el('p.lead', { text: 'Customer numbers are not being stored, so this stays empty. You can change that in Settings.' })),
    ),
  );
}

/* Commissions are entered by hand once a month and only ever compared to volume. */
function commissionCard(ctx, s) {
  return card('Commission vs volume', [
    s.commissionVsVolume.length
      ? el('div.scroll-x', el('table.tbl',
          el('tr', el('th', { text: 'Month' }), el('th', { text: 'Volume' }), el('th', { text: 'Commission' }), el('th', { text: 'Rate' })),
          ...s.commissionVsVolume.map((m) => el('tr',
            el('td', { text: m.month }),
            el('td.num', { text: money(m.volume) }),
            el('td.num', { text: money(m.commission) }),
            el('td.num', { text: m.rate == null ? '—' : `${(m.rate * 100).toFixed(2)}%` })))))
      : el('p.lead', { text: 'No commission recorded yet.' }),
    el('button.big.quiet', { text: 'Record a commission', style: { marginTop: '10px' },
      onclick: () => commissionSheet(ctx) }),
    el('p.note', { style: { marginTop: '8px' },
      text: 'Networks pay commissions into separate accounts at month end. They are never part of the daily total.' }),
  ]);
}

function commissionSheet(ctx) {
  const st = { month: monthKey(ctx.date), wallet: 'MTN', amount: '' };
  sheet('Monthly commission', ({ body, close }) => {
    const render = () => fill(body, 
      el('div.field', el('label', { text: 'Month' }),
        el('input', { type: 'month', value: st.month, onchange: (e) => { st.month = e.target.value; } })),
      el('div.field', el('label', { text: 'Network' }),
        chipRow(NETWORKS.map((w) => ({ value: w, label: WALLET_LABEL[w] })), st.wallet, (v) => { st.wallet = v; render(); }, { small: true })),
      el('div.field', el('label', { text: 'Commission received (GHS)' }),
        amountInput({ value: st.amount, oninput: (v) => { st.amount = v; } })),
      el('button.big', { text: 'Save', onclick: async () => {
        if (!(Number(st.amount) > 0)) return toast('Enter an amount', { error: true });
        await store.setCommission(st.month, st.wallet, Number(st.amount));
        toast('Commission recorded'); ctx.refresh(); close();
      } }),
    );
    render();
    return [];
  });
}

/* Inline sparkline: capital day by day. */
function spark(series) {
  const w = 600, h = 120, pad = 6;
  const vals = series.map((p) => p.capital);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const x = (i) => pad + (i * (w - pad * 2)) / Math.max(1, series.length - 1);
  const y = (v) => h - pad - ((v - min) / span) * (h - pad * 2);
  const line = series.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.capital).toFixed(1)}`).join(' ');
  const area = `${line} L${x(series.length - 1).toFixed(1)},${h} L${x(0).toFixed(1)},${h} Z`;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('class', 'spark');
  svg.setAttribute('preserveAspectRatio', 'none');
  const path = (d, fill, stroke) => {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d); p.setAttribute('fill', fill);
    p.setAttribute('stroke', stroke); p.setAttribute('stroke-width', '2');
    return p;
  };
  svg.append(path(area, 'rgba(227,193,91,.28)', 'none'), path(line, 'none', '#A8801F'));
  return el('div',
    svg,
    el('div.r', { style: { justifyContent: 'space-between', marginTop: '4px' } },
      el('span.note', { text: `${dayLabel(series[0].date, { weekday: false })} · ${money(series[0].capital)}` }),
      el('span.note', { text: `${dayLabel(series[series.length - 1].date, { weekday: false })} · ${money(series[series.length - 1].capital)}` })),
    el('p.note', { text: `low ${money(min)} · high ${money(max)}` }));
}
