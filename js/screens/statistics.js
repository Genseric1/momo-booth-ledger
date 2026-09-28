/* ═══════════════ STATISTICS ═══════════════
   One chart. You choose what it shows — the measure, the network, the period —
   and the rest of the page is the handful of numbers that chart cannot say.   */

import { el, fill, sheet, toast, amountInput } from '../ui.js';
import { NETWORKS, WALLET_LABEL, money, dayLabel, dayKey, monthKey, parseDay, today, toP, toGhs, sum } from '../util.js';
import { timeChart } from '../chart.js';
import { dayReport, debtBalances } from '../calc.js';
import * as store from '../store.js';
import * as sync from '../sync.js';

const MEASURES = [
  { id: 'volume', label: 'Volume', money: true },
  { id: 'in', label: 'In', money: true },
  { id: 'out', label: 'Out', money: true },
  { id: 'lines', label: 'Lines', money: false },
  { id: 'capital', label: 'Capital', money: true },
];
const PERIODS = [
  { id: 'week', label: '7 days', days: 7 },
  { id: 'month', label: '30 days', days: 30 },
  { id: 'year', label: '12 months', months: 12 },
];

export function statsScreen(ctx) {
  const st = ctx.stats || (ctx.stats = { measure: 'volume', period: 'week', network: null });
  const measure = MEASURES.find((m) => m.id === st.measure);
  const period = PERIODS.find((p) => p.id === st.period);
  const out = el('div.sheetview');

  const render = () => {
    const series = build(st, period);
    const previous = build(st, period, true);
    const total = measure.id === 'capital' ? (series.at(-1)?.value ?? 0) : sum(series, (p) => p.value);
    const before = measure.id === 'capital' ? (previous.at(-1)?.value ?? 0) : sum(previous, (p) => p.value);
    const change = before ? (total - before) / Math.abs(before) : null;
    const fmt = (v) => measure.money ? money(v, { dp: 0 }) : String(Math.round(v));

    fill(out,
      el('div.pick', PERIODS.map((p) => el(`button${st.period === p.id ? '.on' : ''}`, {
        text: p.label, onclick: () => { st.period = p.id; render(); },
      }))),
      el('div.pick', { style: { marginTop: '8px' } }, MEASURES.map((m) => el(`button${st.measure === m.id ? '.on' : ''}`, {
        text: m.label, onclick: () => { st.measure = m.id; render(); },
      }))),
      measure.id === 'capital' ? null
        : el('div.pick', { style: { marginTop: '8px' } },
            [{ id: null, label: 'All' }, ...NETWORKS.map((w) => ({ id: w, label: WALLET_LABEL[w] }))]
              .map((n) => el(`button${st.network === n.id ? '.on' : ''}`, {
                text: n.label, onclick: () => { st.network = n.id; render(); },
              }))),

      el('div.hero',
        el('div.k', { text: heroLabel(st, measure, period) }),
        el('div.v.num', { text: measure.money ? `GHS ${fmt(total)}` : fmt(total) }),
        change == null ? el('div.s', { text: 'no earlier period to compare with' })
          : el(`div.s.${change >= 0 ? 'pos' : 'neg'}`, {
              text: `${change >= 0 ? '+' : ''}${(change * 100).toFixed(0)}% against the ${period.label} before`,
            })),

      series.some((p) => p.value !== 0)
        ? timeChart(series, { format: (v) => measure.money ? `GHS ${money(v, { dp: 0 })}` : String(v),
            fromZero: measure.id !== 'capital' })
        : el('p.chart-empty', { text: 'Nothing written in this period yet.' }),

      numbers(st, period),
      networkTable(st, period),
      extras(ctx),
    );
  };
  render();
  return out;
}

const heroLabel = (st, measure, period) => {
  const where = st.network && measure.id !== 'capital' ? ` · ${WALLET_LABEL[st.network]}` : '';
  const name = { in: 'Cash in', out: 'Cash out' }[measure.id] || measure.label;
  return measure.id === 'capital' ? `Capital at the end${where}` : `${name} over ${period.label}${where}`;
};

/* ── the series behind the chart ── */
function buckets(period, back = false) {
  const dates = store.datesWithData();
  const end = dates.at(-1) || today();
  const out = [];
  if (period.months) {
    const d = parseDay(end);
    for (let i = period.months - 1; i >= 0; i--) {
      const m = new Date(d.getFullYear(), d.getMonth() - i - (back ? period.months : 0), 1);
      const key = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
      out.push({ key, label: m.toLocaleDateString('en-GB', { month: 'short' }),
        sub: m.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }), month: true });
    }
  } else {
    const d = parseDay(end);
    for (let i = period.days - 1; i >= 0; i--) {
      const day = new Date(d);
      day.setDate(d.getDate() - i - (back ? period.days : 0));
      const key = dayKey(day);          // the local day, never the UTC one
      out.push({ key, label: day.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
        sub: dayLabel(key), month: false });
    }
  }
  return out;
}

function build(st, period, back = false) {
  const inBucket = (b, day) => b.month ? monthKey(day) === b.key : day === b.key;
  const raw = buckets(period, back).map((b) => {
    let value = 0;
    if (st.measure === 'capital') {
      const days = store.datesWithData().filter((d) => inBucket(b, d));
      const last = days.at(-1);
      value = last ? capitalOn(last) : NaN;
    } else {
      const rows = store.state.txs.filter((t) => !t.cancelled && inBucket(b, t.day)
        && (!st.network || t.wallet === st.network));
      if (st.measure === 'lines') value = rows.length;
      else {
        const kept = st.measure === 'volume' ? rows
          : rows.filter((t) => t.type === (st.measure === 'in' ? 'cash_in' : 'cash_out'));
        value = toGhs(sum(kept, (t) => toP(t.amount)));
      }
    }
    return { ...b, value };
  });
  /* capital is a level, not a flow: a day with no count carries the last one on */
  return raw.map((p, i) => Number.isNaN(p.value)
    ? { ...p, value: raw.slice(0, i).reverse().find((q) => !Number.isNaN(q.value))?.value ?? 0 }
    : p);
}

function capitalOn(date) {
  const rep = dayReport({
    day: store.getDay(date) || { date },
    txs: store.dayTxs(date),
    dayDebts: store.dayDebtEntries(date),
    carried: debtBalances(store.state.debtEntries.filter((e) => e.day < date)),
  });
  return rep.hasClosing ? rep.realCapital : rep.expectedCapital;
}

/* ── the numbers a line cannot say ── */
function numbers(st, period) {
  const days = buckets(period).map((b) => b.key);
  const rows = store.state.txs.filter((t) => !t.cancelled
    && (period.months ? days.includes(monthKey(t.day)) : days.includes(t.day))
    && (!st.network || t.wallet === st.network));
  const amounts = rows.map((t) => toP(t.amount)).sort((a, b) => a - b);
  const line = (k, v, sub) => el('div.r', el('div', { text: k }, sub ? el('small', { text: sub }) : null),
    el('div.sp'), el('div.v.num', { text: v }));

  return el('div.rows', { style: { marginTop: '18px' } },
    line('Lines', String(rows.length)),
    line('Average line', amounts.length ? money(toGhs(Math.round(sum(amounts) / amounts.length)), { dp: 0 }) : '0'),
    line('Biggest line', amounts.length ? money(toGhs(amounts.at(-1)), { dp: 0 }) : '0'));
}

function networkTable(st, period) {
  const days = buckets(period).map((b) => b.key);
  const keep = (t) => !t.cancelled && (period.months ? days.includes(monthKey(t.day)) : days.includes(t.day));
  const rows = store.state.txs.filter(keep);
  const totalP = sum(rows, (t) => toP(t.amount));

  return el('div', { style: { marginTop: '22px' } },
    el('div.seclabel', el('span', { text: 'By network' })),
    el('div.rows', NETWORKS.map((w) => {
      const mine = rows.filter((t) => t.wallet === w);
      const volP = sum(mine, (t) => toP(t.amount));
      const inP = sum(mine.filter((t) => t.type === 'cash_in'), (t) => toP(t.amount));
      const outP = sum(mine.filter((t) => t.type === 'cash_out'), (t) => toP(t.amount));
      const airP = sum(mine.filter((t) => t.type === 'airtime' || t.type === 'bundle'), (t) => toP(t.amount));
      const net = toGhs(outP - inP - airP);
      return el('div.r',
        el('div', { text: WALLET_LABEL[w] },
          el('small', { text: `${mine.length} lines · ${totalP ? Math.round((volP / totalP) * 100) : 0}% of the volume` })),
        el('div.sp'),
        el('div.v.num', { text: money(toGhs(volP), { dp: 0 }) }),
        el('div.v.num', { class: net >= 0 ? 'pos' : 'neg', style: { width: '86px', textAlign: 'right' },
          text: money(net, { sign: true, dp: 0 }) }));
    })),
    el('p.note', { text: 'The second number is the float the network gained or lost. Minus means it will need a top-up.' }));
}

/* ── gaps and commissions: four lines, not four sections ── */
function extras(ctx) {
  const closed = store.datesWithData().map((d) => capitalGap(d)).filter((g) => g != null);
  const unexplained = toGhs(sum(closed, toP));
  const withGap = closed.filter((g) => toP(g) !== 0).length;
  const cancelled = store.state.txs.filter((t) => t.cancelled);
  const month = monthKey(ctx.date);
  const com = store.state.commissions.filter((c) => c.month === month);
  const row = (k, sub, v, cls) => el('div.r', el('div', { text: k }, sub ? el('small', { text: sub }) : null),
    el('div.sp'), el('div.v.num', { class: cls || '', text: v }));

  return el('div', { style: { marginTop: '22px' } },
    el('div.seclabel', el('span', { text: 'Checks' })),
    el('div.rows',
      row('Days with a gap', `${closed.length} evenings counted`, String(withGap)),
      row('Unexplained, all together', 'after the extras you estimated',
        money(unexplained, { sign: true, dp: 0 }), Math.abs(unexplained) > 0.004 ? 'neg' : ''),
      row('Struck out lines', null, String(cancelled.length)),
      el(sync.canWrite() ? 'button.r' : 'div.r', { onclick: sync.canWrite() ? () => commissionSheet(ctx) : null },
        el('div', { text: `Commission ${month}` }, el('small', { text: 'paid by the networks, never in the total' })),
        el('div.sp'),
        el('div.v.num', { text: com.length ? money(toGhs(sum(com, (c) => toP(c.amount))), { dp: 0 }) : 'record' }),
        sync.canWrite() ? el('div.go', { text: '›' }) : null)));
}

function capitalGap(date) {
  const rep = dayReport({
    day: store.getDay(date) || { date },
    txs: store.dayTxs(date),
    dayDebts: store.dayDebtEntries(date),
    carried: debtBalances(store.state.debtEntries.filter((e) => e.day < date)),
  });
  if (!rep.hasClosing) return null;
  return rep.residualGap != null ? rep.residualGap : rep.totalGap;
}

function commissionSheet(ctx) {
  const st = { month: monthKey(ctx.date), wallet: 'MTN', amount: '' };
  sheet('Commission received', ({ body, close }) => {
    const render = () => fill(body,
      el('div.field', el('label', { text: 'Month' }),
        el('input', { type: 'month', value: st.month, onchange: (e) => { st.month = e.target.value; } })),
      el('div.field', el('label', { text: 'Network' }),
        el('div.pick', NETWORKS.map((w) => el(`button${st.wallet === w ? '.on' : ''}`, {
          text: WALLET_LABEL[w], onclick: () => { st.wallet = w; render(); } })))),
      el('div.field', el('label', { text: 'Amount' }),
        amountInput({ value: st.amount, oninput: (v) => { st.amount = v; } })),
      el('button.big', { text: 'Save', onclick: async () => {
        if (!(Number(st.amount) > 0)) return toast('Amount?', { error: true });
        await store.setCommission(st.month, st.wallet, Number(st.amount));
        toast('Commission recorded'); close(); ctx.refresh();
      } }));
    render();
    return [];
  });
}
