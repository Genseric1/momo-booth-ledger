/* ═══════════════ PDF REGISTER (spec §8) ═══════════════
   Reads like the notebook it replaces: date, time, type, network, amount.
   Each option is an independent checkbox; with all of them off the file holds
   dates and transactions only, and customer numbers stay masked.            */

import { Pdf } from './pdf.js';
import { WALLETS, NETWORKS, TYPE_LABEL, WALLET_LABEL, KIND_LABEL, money, dayLabel, timeLabel, displayNumber } from './util.js';
import { dayReport, debtBalances } from './calc.js';
import { stats } from './stats.js';

const INK = [0.09, 0.13, 0.20];
const DIM = [0.42, 0.46, 0.53];
const RULE = [0.80, 0.83, 0.88];
const GOLD = [0.62, 0.50, 0.18];
const RED = [0.70, 0.15, 0.15];

const M = 40;                         // page margin
const COLS = [
  { k: 'date',   label: 'Date',     w: 74,  align: 'left' },
  { k: 'time',   label: 'Time',     w: 38,  align: 'left' },
  { k: 'no',     label: 'No',       w: 30,  align: 'right' },
  { k: 'type',   label: 'Type',     w: 62,  align: 'left' },
  { k: 'net',    label: 'Network',  w: 58,  align: 'left' },
  { k: 'amount', label: 'Amount',   w: 78,  align: 'right' },
  { k: 'cust',   label: 'Customer', w: 82,  align: 'left' },
  { k: 'agent',  label: 'Agent',    w: 60,  align: 'left' },
  { k: 'note',   label: 'Note',     w: 0,   align: 'left' },     // 0 = take the rest
];

export function buildRegister({
  boothName, range, days, txs, debtEntries = [], debtAccounts = [], commissions = [],
  options = {}, password = '',
}) {
  const o = {
    balances: false, statistics: false, extras: false, cancelled: false, fullNumbers: false, debts: false,
    ...options,
  };
  const pdf = new Pdf({
    size: 'A4', password,
    title: `${boothName} — register ${range.start} to ${range.end}`,
  });

  const contentW = pdf.w - M * 2;
  let noteW = contentW - COLS.reduce((t, c) => t + c.w, 0);
  const cols = COLS.map((c) => ({ ...c, w: c.w || Math.max(60, noteW) }));
  let y = 0;

  const rows = txs
    .filter((t) => t.day >= range.start && t.day <= range.end)
    .filter((t) => o.cancelled || !t.cancelled)
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.time < b.time ? -1 : 1));

  const header = (sub) => {
    y = M;
    pdf.text(M, y + 10, boothName, { size: 15, bold: true, color: INK });
    pdf.text(pdf.w - M, y + 10, 'MOMO REGISTER', { size: 9, bold: true, color: GOLD, align: 'right' });
    y += 16;
    pdf.text(M, y + 10, sub, { size: 9, color: DIM });
    pdf.text(pdf.w - M, y + 10, `Printed ${new Date().toLocaleString('en-GB')}`, { size: 8, color: DIM, align: 'right' });
    y += 18;
    pdf.line(M, y, pdf.w - M, y, { width: 1, color: GOLD });
    y += 14;
  };
  const tableHead = () => {
    let x = M;
    for (const c of cols) {
      pdf.text(c.align === 'right' ? x + c.w - 2 : x, y + 8, c.label.toUpperCase(),
        { size: 7.5, bold: true, color: DIM, align: c.align });
      x += c.w;
    }
    y += 12;
    pdf.line(M, y, pdf.w - M, y, { width: 0.6, color: RULE });
    y += 4;
  };
  const room = (need = 16) => {
    if (y + need < pdf.h - M - 18) return;
    pdf.addPage();
    header(`${dayLabel(range.start, { weekday: false })}  to  ${dayLabel(range.end, { weekday: false })}`);
    tableHead();
  };

  header(`${dayLabel(range.start, { weekday: false })}  to  ${dayLabel(range.end, { weekday: false })}`);
  tableHead();

  /* ── the register itself: one ruled line per transaction ── */
  let lastDay = null, n = 0, printed = 0;
  for (const t of rows) {
    room(15);
    if (t.day !== lastDay) { lastDay = t.day; n = 0; }
    n++; printed++;
    const cust = displayNumber(t.customer_number, o.fullNumbers ? 'full' : 'masked');
    const cells = {
      date: n === 1 ? dayLabel(t.day) : '',
      time: timeLabel(t.time),
      no: String(n),
      type: TYPE_LABEL[t.type] + (t.sub_type ? ` (${t.sub_type[0]})` : ''),
      net: WALLET_LABEL[t.wallet] || t.wallet,
      amount: money(t.amount),
      cust, agent: t.agent || '', note: t.note || '',
    };
    const color = t.cancelled ? RED : INK;
    let x = M;
    for (const c of cols) {
      const raw = cells[c.k] ?? '';
      const txt = pdf.fit(raw, c.w - 4, 8.5, c.k === 'amount');
      pdf.text(c.align === 'right' ? x + c.w - 2 : x, y + 9, txt,
        { size: 8.5, bold: c.k === 'amount', color, align: c.align, strike: t.cancelled });
      x += c.w;
    }
    y += 13;
    pdf.line(M, y, pdf.w - M, y, { width: 0.35, color: RULE });
  }
  if (!printed) { pdf.text(M, y + 10, 'No transactions in this period.', { size: 9, color: DIM }); y += 16; }

  /* running total of the register, always shown: it is what a register is for */
  y += 6;
  const live = rows.filter((t) => !t.cancelled);
  const totalIn = live.filter((t) => t.type === 'cash_in').reduce((s, t) => s + Number(t.amount), 0);
  const totalOut = live.filter((t) => t.type === 'cash_out').reduce((s, t) => s + Number(t.amount), 0);
  const totalOther = live.filter((t) => t.type === 'airtime' || t.type === 'bundle').reduce((s, t) => s + Number(t.amount), 0);
  room(30);
  pdf.line(M, y, pdf.w - M, y, { width: 1, color: GOLD });
  y += 14;
  pdf.text(M, y, `${live.length} transactions`, { size: 9, bold: true, color: INK });
  pdf.text(M + 130, y, `Cash in  GHS ${money(totalIn)}`, { size: 9, color: INK });
  pdf.text(M + 280, y, `Cash out  GHS ${money(totalOut)}`, { size: 9, color: INK });
  pdf.text(pdf.w - M, y, `Airtime/bundle  GHS ${money(totalOther)}`, { size: 9, color: INK, align: 'right' });
  y += 20;

  /* ── optional sections ── */
  const section = (title) => {
    room(60);
    y += 10;
    pdf.text(M, y + 10, title.toUpperCase(), { size: 10, bold: true, color: GOLD });
    y += 16;
    pdf.line(M, y, pdf.w - M, y, { width: 0.6, color: RULE });
    y += 8;
  };
  const kv = (label, value, { bold = false, color = INK } = {}) => {
    room(14);
    pdf.text(M, y + 9, label, { size: 8.5, color: DIM });
    pdf.text(M + 300, y + 9, value, { size: 8.5, bold, color, align: 'right' });
    y += 13;
  };

  const dayKeys = [...new Set([...rows.map((t) => t.day), ...[...days.keys()]])]
    .filter((d) => d >= range.start && d <= range.end).sort();
  const reportOf = (date) => dayReport({
    day: days.get(date) || { date },
    txs: txs.filter((t) => t.day === date),
    dayDebts: debtEntries.filter((e) => e.day === date),
    carried: debtBalances(debtEntries.filter((e) => e.day < date)),
  });

  if (o.balances) {
    section('Opening and closing balances');
    const head = ['Date', ...WALLETS.map((w) => WALLET_LABEL[w]), 'Capital'];
    const colW = [90, 78, 78, 78, 78, 84];
    const line = (cells, { bold = false, color = INK, size = 8 } = {}) => {
      room(13);
      let x = M;
      cells.forEach((c, i) => {
        pdf.text(i === 0 ? x : x + colW[i] - 2, y + 9, String(c),
          { size, bold, color, align: i === 0 ? 'left' : 'right' });
        x += colW[i];
      });
      y += 12;
    };
    line(head.map((h) => h.toUpperCase()), { bold: true, color: DIM, size: 7.5 });
    for (const date of dayKeys) {
      const r = reportOf(date);
      if (!r.hasOpening && !r.hasClosing) continue;
      line([dayLabel(date), ...WALLETS.map((w) => (r.hasOpening ? money(r.opening[w]) : '-')),
        r.hasOpening ? money(r.expectedCapital) : '-'], { color: DIM });
      line([' (expected close)', ...WALLETS.map((w) => money(r.expected[w])), money(r.expectedCapital)]);
      if (r.hasClosing) {
        line([' (counted)', ...WALLETS.map((w) => money(r.real[w])), money(r.realCapital)], { bold: true });
        const anyGap = WALLETS.some((w) => Math.abs(r.gap[w]) > 0.004);
        if (anyGap) {
          line([' gap', ...WALLETS.map((w) => money(r.gap[w], { sign: true })), money(r.totalGap, { sign: true })],
            { color: RED });
        }
        if (o.extras && r.estimated_extras != null) {
          line([' extras (estimate)', '', '', '', money(r.estimated_extras), ''], { color: GOLD });
          line([' residual gap', '', '', '', '', money(r.residualGap, { sign: true })], { color: RED });
        }
        for (const h of r.hints) {
          room(12);
          pdf.text(M, y + 9, `   check: ${WALLET_LABEL[h.a]} +${money(h.amount)} and ${WALLET_LABEL[h.b]} -${money(h.amount)} — a line may be on the wrong network`,
            { size: 7.5, color: GOLD });
          y += 12;
        }
      }
      y += 4;
    }
  }

  if (o.extras && !o.balances) {
    section('Estimated extra fees collected');
    let total = 0;
    for (const date of dayKeys) {
      const d = days.get(date);
      if (d?.estimated_extras == null) continue;
      total += Number(d.estimated_extras);
      kv(dayLabel(date), `GHS ${money(d.estimated_extras)}`);
    }
    kv('Total (agent estimate, not recorded per line)', `GHS ${money(total)}`, { bold: true });
  }

  if (o.debts) {
    section('Debt accounts');
    const bal = debtBalances(debtEntries.filter((e) => e.day <= range.end));
    for (const a of debtAccounts) {
      const b = bal.perAccount.get(a.account_id) || { owed_to_us: 0, we_owe: 0, net: 0 };
      kv(a.name, `owed to us GHS ${money(b.owed_to_us)}   |   we owe GHS ${money(b.we_owe)}   |   net GHS ${money(b.net, { sign: true })}`);
    }
    kv('Total', `owed to us GHS ${money(bal.owed_to_us)}   |   we owe GHS ${money(bal.we_owe)}`, { bold: true });
    const inRange = debtEntries.filter((e) => e.day >= range.start && e.day <= range.end && (!e.cancelled || o.cancelled));
    if (inRange.length) {
      y += 6;
      for (const e of inRange) {
        room(12);
        const acc = debtAccounts.find((a) => a.account_id === e.account_id)?.name || 'account';
        pdf.text(M, y + 9, `${dayLabel(e.day, { weekday: false })}  ${timeLabel(e.time)}  ${acc}  ${KIND_LABEL[e.kind]}  ${WALLET_LABEL[e.wallet]}`,
          { size: 8, color: e.cancelled ? RED : INK, strike: e.cancelled });
        pdf.text(pdf.w - M, y + 9, `GHS ${money(e.amount)}`, { size: 8, bold: true, align: 'right', color: e.cancelled ? RED : INK });
        y += 12;
      }
    }
  }

  if (o.statistics) {
    const s = stats({ range, txs, days, debtEntries, commissions });
    section(`Statistics — ${range.start} to ${range.end}`);
    kv('Transactions', String(s.count), { bold: true });
    kv('Total cash in', `GHS ${money(s.cashIn)}`);
    kv('Total cash out', `GHS ${money(s.cashOut)}`);
    kv('Airtime', `GHS ${money(s.byType.airtime.total)}  (${s.byType.airtime.count})`);
    kv('Bundles', `GHS ${money(s.byType.bundle.total)}  (${s.byType.bundle.count})`);
    kv('Average transaction', `GHS ${money(s.average)}`);
    kv('Largest transaction', `GHS ${money(s.largest)}`);
    kv('Busiest weekday', `${s.busiestWeekday.label} (${s.busiestWeekday.count})`);
    kv('Busiest hour', `${s.busiestHour.label}:00 (${s.busiestHour.count})`);
    kv('Cancelled lines', `${s.cancelledCount}  (GHS ${money(s.cancelledTotal)})`);
    kv('Days closed', `${s.daysClosed}`);
    kv('Days with a gap', `${s.daysWithGap}`);
    kv('Cumulative unexplained gap', `GHS ${money(s.cumulativeGap, { sign: true })}`,
      { bold: true, color: Math.abs(s.cumulativeGap) > 0.004 ? RED : INK });

    y += 8;
    for (const w of NETWORKS) {
      const p = s.perNetwork[w];
      kv(`${WALLET_LABEL[w]} — volume / net float / share`,
        `GHS ${money(p.volume)}   |   ${money(p.netFloat, { sign: true })}   |   ${(p.shareVolume * 100).toFixed(1)}%`);
    }
    if (s.commissionVsVolume.length) {
      y += 8;
      for (const m of s.commissionVsVolume) {
        kv(`Commission ${m.month}`, `GHS ${money(m.commission)} on volume GHS ${money(m.volume)}` +
          (m.rate != null ? `  (${(m.rate * 100).toFixed(2)}%)` : ''));
      }
    }
  }

  /* footer on every page */
  const total = pdf.pageCount;
  pdf.pages.forEach((ops, i) => {
    pdf.ops = ops;
    pdf.line(M, pdf.h - M - 12, pdf.w - M, pdf.h - M - 12, { width: 0.4, color: RULE });
    pdf.text(M, pdf.h - M, boothName, { size: 7.5, color: DIM });
    pdf.text(pdf.w / 2, pdf.h - M, `Page ${i + 1} of ${total}`, { size: 7.5, color: DIM, align: 'center' });
    pdf.text(pdf.w - M, pdf.h - M, o.fullNumbers ? 'full customer numbers' : 'customer numbers masked',
      { size: 7.5, color: DIM, align: 'right' });
  });

  return pdf.save();
}

export const suggestedName = (boothName, range) =>
  `${boothName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-register-${range.start}_${range.end}.pdf`;
