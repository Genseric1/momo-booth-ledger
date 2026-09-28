/* ═══════════════ STATISTICS (spec §7) ═══════════════
   Pure aggregates over a date range. Debts are excluded everywhere; commissions
   are shown against volume but never inside a total.                         */

import { NETWORKS, TX_TYPES, toP, toGhs, monthKey, WEEKDAYS, parseDay, dayKey, today, groupBy, sum } from './util.js';
import { dayReport, debtBalances } from './calc.js';

/* end = last date that holds data, per spec. */
export function rangeFor(preset, dates, custom = {}) {
  const end = custom.end || dates[dates.length - 1] || today();
  /* dayKey, not toISOString: a local midnight turns into the day before in UTC */
  const back = (n) => {
    const d = parseDay(end); d.setDate(d.getDate() - (n - 1));
    return dayKey(d);
  };
  const months = (n) => {
    const d = parseDay(end); d.setMonth(d.getMonth() - n);
    return dayKey(d);
  };
  switch (preset) {
    case 'day':    return { start: end, end, label: 'Today' };
    case 'week':   return { start: back(7), end, label: 'Last 7 days' };
    case 'month':  return { start: back(30), end, label: 'Last 30 days' };
    case 'year':   return { start: months(12), end, label: 'Last 12 months' };
    default:       return { start: custom.start || back(7), end, label: 'Custom range' };
  }
}

export function stats({ range, txs, days, debtEntries = [], commissions = [] }) {
  const inRange = (d) => d >= range.start && d <= range.end;
  const all = txs.filter((t) => inRange(t.day));
  const live = all.filter((t) => !t.cancelled);
  const cancelled = all.filter((t) => t.cancelled);

  const volumeP = sum(live, (t) => toP(t.amount));
  const byType = {};
  for (const ty of TX_TYPES) {
    const rows = live.filter((t) => t.type === ty);
    byType[ty] = { count: rows.length, total: toGhs(sum(rows, (t) => toP(t.amount))) };
  }

  /* per network: volume, counts, in/out and net float movement */
  const perNetwork = {};
  for (const w of NETWORKS) {
    const rows = live.filter((t) => t.wallet === w);
    const inP = sum(rows.filter((t) => t.type === 'cash_in'), (t) => toP(t.amount));
    const outP = sum(rows.filter((t) => t.type === 'cash_out'), (t) => toP(t.amount));
    const airP = sum(rows.filter((t) => t.type === 'airtime' || t.type === 'bundle'), (t) => toP(t.amount));
    const volP = inP + outP + airP;
    perNetwork[w] = {
      count: rows.length,
      volume: toGhs(volP),
      cashIn: toGhs(inP), cashOut: toGhs(outP), airtimeBundle: toGhs(airP),
      netFloat: toGhs(outP - inP - airP),            // + = network gained float
      inOutRatio: outP === 0 ? (inP ? Infinity : 0) : inP / outP,
      shareVolume: volumeP ? volP / volumeP : 0,
      shareCount: live.length ? rows.length / live.length : 0,
    };
  }

  const amountsP = live.map((t) => toP(t.amount)).sort((a, b) => a - b);
  const perWeekday = WEEKDAYS.map((label) => ({ label, count: 0, total: 0 }));
  const perHour = Array.from({ length: 24 }, (_, h) => ({ label: String(h).padStart(2, '0'), count: 0, total: 0 }));
  for (const t of live) {
    const d = new Date(t.time);
    const wd = perWeekday[d.getDay()], hr = perHour[d.getHours()];
    wd.count++; wd.total += toP(t.amount);
    hr.count++; hr.total += toP(t.amount);
  }
  for (const b of [...perWeekday, ...perHour]) b.total = toGhs(b.total);

  /* per-day series: counts, volume and evening capital */
  const dayKeys = [...new Set([...all.map((t) => t.day), ...[...days.keys()].filter(inRange)])].sort();
  const perDay = dayKeys.map((date) => {
    const day = days.get(date) || { date };
    const rep = dayReport({
      day, txs: txs.filter((t) => t.day === date),
      dayDebts: debtEntries.filter((e) => e.day === date),
      carried: debtBalances(debtEntries.filter((e) => e.day < date)),
    });
    const rows = live.filter((t) => t.day === date);
    return {
      date, count: rows.length,
      volume: toGhs(sum(rows, (t) => toP(t.amount))),
      cashIn: toGhs(sum(rows.filter((t) => t.type === 'cash_in'), (t) => toP(t.amount))),
      cashOut: toGhs(sum(rows.filter((t) => t.type === 'cash_out'), (t) => toP(t.amount))),
      capital: rep.hasClosing ? rep.realCapital : (rep.hasOpening ? rep.expectedCapital : null),
      gap: rep.totalGap, residualGap: rep.residualGap, hasClosing: rep.hasClosing,
      extras: rep.estimated_extras,
    };
  });

  const closed = perDay.filter((d) => d.hasClosing);
  const unexplained = closed.map((d) => (d.residualGap != null ? d.residualGap : d.gap));
  const daysWithGap = unexplained.filter((g) => Math.round(toP(g)) !== 0).length;

  /* commissions vs volume, by month inside the range */
  const comMonths = [...new Set([...commissions.map((c) => c.month), ...dayKeys.map(monthKey)])].sort();
  const commissionVsVolume = comMonths.map((month) => {
    const volP = sum(live.filter((t) => monthKey(t.day) === month), (t) => toP(t.amount));
    const comP = sum(commissions.filter((c) => c.month === month), (c) => toP(c.amount));
    return { month, volume: toGhs(volP), commission: toGhs(comP), rate: volP ? comP / volP : null };
  }).filter((m) => m.volume || m.commission);

  /* most frequent customers — only possible when numbers are stored */
  const withNumber = live.filter((t) => t.customer_number);
  const customers = [...groupBy(withNumber, (t) => t.customer_number)]
    .map(([number, rows]) => ({ number, count: rows.length, total: toGhs(sum(rows, (t) => toP(t.amount))) }))
    .sort((a, b) => b.count - a.count || b.total - a.total)
    .slice(0, 15);

  return {
    range,
    count: live.length,
    volume: toGhs(volumeP),
    byType,
    cashIn: byType.cash_in.total, cashOut: byType.cash_out.total,
    perNetwork, perDay, perWeekday, perHour,
    average: live.length ? toGhs(Math.round(volumeP / live.length)) : 0,
    largest: amountsP.length ? toGhs(amountsP[amountsP.length - 1]) : 0,
    median: amountsP.length ? toGhs(amountsP[Math.floor(amountsP.length / 2)]) : 0,
    perDayAverageCount: perDay.length ? live.length / perDay.length : 0,
    busiestWeekday: [...perWeekday].sort((a, b) => b.count - a.count)[0],
    busiestHour: [...perHour].sort((a, b) => b.count - a.count)[0],
    capitalSeries: perDay.filter((d) => d.capital != null).map((d) => ({ date: d.date, capital: d.capital })),
    daysClosed: closed.length,
    daysWithGap,
    cumulativeGap: toGhs(sum(unexplained, toP)),
    cumulativeExtras: toGhs(sum(closed, (d) => toP(d.extras))),
    cancelledCount: cancelled.length,
    cancelledTotal: toGhs(sum(cancelled, (t) => toP(t.amount))),
    commissionVsVolume,
    customers,
    hasNumbers: withNumber.length > 0,
  };
}
