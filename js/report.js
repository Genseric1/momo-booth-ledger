/* ═══════════════ THE REGISTER ═══════════════
   The printed page carries the same four things as the screen: the number, the
   network, in or out, the amount. The date is a heading, the way it is written
   once at the top of a page in the book, and each day closes on its own totals.
   Every option is a separate checkbox; with all of them off the file holds the
   lines and nothing else, numbers masked.                                     */

import { Pdf } from './pdf.js';
import { LOGO, logoBytes } from './logo.js';
import { WALLETS, NETWORKS, WALLET_LABEL, money, dayLabel, displayNumber, toP, toGhs, sum } from './util.js';
import { dayReport, debtBalances } from './calc.js';

const INK = [0.09, 0.19, 0.42];
const GREY = [0.48, 0.52, 0.58];
const FAINT = [0.72, 0.75, 0.80];
const GOLD = [0.66, 0.50, 0.12];
const RED = [0.75, 0.22, 0.17];

const M = 54;                       // a wide margin: the page should feel empty
const LINE = 20;                    // one written line, with room to breathe
/* written short, the way it is written by hand */
const DIR = { cash_in: 'in', cash_out: 'out', airtime: 'a', bundle: 'b' };

/* Whole cedis unless there are pesewas — the book writes round numbers. */
const amt = (v) => money(v, { dp: Number.isInteger(Number(v)) ? 0 : 2 });
const countLines = (n) => (n === 1 ? '1 line' : `${n} lines`);

export function buildRegister({
  boothName, range, days, txs, debtEntries = [], debtAccounts = [], commissions = [],
  options = {}, password = '',
}) {
  const o = { balances: false, statistics: false, extras: false, cancelled: false,
    debts: false, fullNumbers: false, agents: false, ...options };

  const pdf = new Pdf({ size: 'A4', password, title: `${boothName} — register ${range.start} to ${range.end}` });
  const right = pdf.w - M;
  const COL = { number: M, network: M + 116, dir: M + 172, note: M + 232 };
  let y = 0;

  const rows = txs
    .filter((t) => t.day >= range.start && t.day <= range.end)
    .filter((t) => o.cancelled || !t.cancelled)
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.time < b.time ? -1 : 1));

  const mark = pdf.image(logoBytes(), LOGO.width, LOGO.height);
  const MARK = 34;

  const header = () => {
    y = M;
    pdf.draw(mark, M, y - 4, MARK, MARK);
    pdf.text(M + MARK + 10, y + 12, boothName, { size: 15, bold: true, color: INK });
    y += 18;
    pdf.text(M + MARK + 10, y + 10, `${dayLabel(range.start, { weekday: false })}  to  ${dayLabel(range.end, { weekday: false })}`,
      { size: 9.5, color: GREY });
    pdf.text(right, y + 10, `printed ${new Date().toLocaleDateString('en-GB')}`, { size: 8.5, color: FAINT, align: 'right' });
    y += 16;
    pdf.line(M, y, right, y, { width: 0.8, color: GOLD });
    y += 24;
  };
  const room = (need) => {
    if (y + need < pdf.h - M - 22) return false;
    pdf.addPage();
    header();
    return true;
  };

  header();

  /* ── the days ── */
  const dayKeys = [...new Set([...rows.map((t) => t.day), ...[...days.keys()]])]
    .filter((d) => d >= range.start && d <= range.end)
    .sort();

  const reportOf = (date) => dayReport({
    day: days.get(date) || { date },
    txs: txs.filter((t) => t.day === date),
    dayDebts: debtEntries.filter((e) => e.day === date),
    carried: debtBalances(debtEntries.filter((e) => e.day < date)),
  });

  let printed = 0;
  for (const date of dayKeys) {
    const lines = rows.filter((t) => t.day === date);
    if (!lines.length && !o.balances) continue;

    room(70);
    const live = lines.filter((t) => !t.cancelled).length;
    pdf.text(M, y + 11, dayLabel(date), { size: 12, bold: true, color: INK });
    pdf.text(right, y + 11, countLines(live), { size: 9, color: FAINT, align: 'right' });
    y += 18;
    pdf.line(M, y, right, y, { width: 0.5, color: FAINT });
    y += 8;

    for (const t of lines) {
      room(LINE + 4);
      printed++;
      const off = t.cancelled;
      const colour = off ? RED : INK;
      pdf.text(COL.number, y + 13, displayNumber(t.customer_number, o.fullNumbers ? 'full' : 'masked') || '—',
        { size: 11, color: colour, strike: off });
      pdf.text(COL.network, y + 13, WALLET_LABEL[t.wallet].toLowerCase(), { size: 9, color: off ? RED : GREY });
      pdf.text(COL.dir, y + 13, DIR[t.type], { size: 10.5, bold: true, color: colour, strike: off });
      const aside = [o.agents ? t.agent : null, t.sub_type, t.note].filter(Boolean).join(' - ');
      if (aside) pdf.text(COL.note, y + 13, pdf.fit(aside, right - COL.note - 100, 8.5), { size: 8.5, color: FAINT });
      pdf.text(right, y + 13, amt(t.amount), { size: 12, bold: true, color: colour, align: 'right', strike: off });
      y += LINE;
    }

    if (o.balances) dayTotals(reportOf(date), date);
    y += 14;
  }

  if (!printed) {
    pdf.text(M, y + 10, 'No lines written in this period.', { size: 10, color: GREY });
    y += 20;
  }

  /* ── what each wallet held at the end of that day ── */
  /* The block written at the foot of a day, the way it is written by hand:
     one figure a line, the people beside the wallets, the total underlined. */
  function dayTotals(rep, date) {
    if (!rep.hasOpening && !rep.hasClosing) return;
    const bal = debtBalances(debtEntries.filter((e) => e.day <= date));
    const owing = debtAccounts
      .map((a) => ({ name: a.name, net: bal.perAccount.get(a.account_id)?.net || 0 }))
      .filter((p) => Math.abs(p.net) > 0.004);
    const lines = [
      ...WALLETS.map((w) => [WALLET_LABEL[w], rep.hasClosing ? rep.real[w] : rep.expected[w]]),
      ...owing.map((p) => [p.name, p.net]),
    ];
    /* if the block cannot follow its own lines, it says which day it closes */
    const broke = room(lines.length * 17 + 60);

    const boxL = M + (right - M) * 0.46;         // a block, set to the right
    y += 12;
    if (broke) {
      pdf.text(boxL, y + 10, `${dayLabel(date)} — closing`, { size: 9.5, color: GREY });
      y += 18;
    }
    for (const [label, value] of lines) {
      pdf.text(boxL, y + 11, pdf.fit(label, (right - boxL) * 0.6, 10), { size: 10, color: GREY });
      pdf.text(right, y + 11, money(value, { sign: value < 0, dp: 0 }), { size: 11, color: INK, align: 'right' });
      y += 16;
    }
    y += 4;
    pdf.line(boxL, y, right, y, { width: 1, color: INK });
    y += 6;
    pdf.text(boxL, y + 12, rep.hasClosing ? 'TOTAL' : 'EXPECTED', { size: 10, bold: true, color: INK });
    pdf.text(right, y + 12, amt(rep.hasClosing ? rep.realCapital : rep.expectedCapital),
      { size: 13, bold: true, color: INK, align: 'right' });
    y += 18;
    pdf.line(boxL, y, right, y, { width: 0.6, color: INK });
    y += 10;

    if (rep.hasClosing && Math.abs(rep.totalGap) > 0.004) {
      const shown = rep.residualGap != null ? rep.residualGap : rep.totalGap;
      const said = o.extras && rep.estimated_extras != null
        ? `${money(rep.totalGap, { sign: true, dp: 0 })} against the page, ${amt(rep.estimated_extras)} of it extra fees`
        : `${money(rep.totalGap, { sign: true, dp: 0 })} against the page`;
      pdf.text(right, y + 10, said, { size: 9, color: Math.abs(shown) > 0.004 ? RED : GREY, align: 'right' });
      y += 15;
    }
    for (const h of rep.hints) {
      pdf.text(right, y + 10, `${WALLET_LABEL[h.a]} over, ${WALLET_LABEL[h.b]} short, by ${amt(h.amount)}`,
        { size: 8.5, color: GOLD, align: 'right' });
      y += 13;
    }
  }

  /* ── the closing figures of the whole period ── */
  const live = rows.filter((t) => !t.cancelled);
  const totalOf = (...types) => toGhs(sum(live.filter((t) => types.includes(t.type)), (t) => toP(t.amount)));
  room(60);
  y += 10;
  pdf.line(M, y, right, y, { width: 0.8, color: GOLD });
  y += 18;
  pdf.text(M, y, countLines(live.length), { size: 11, bold: true, color: INK });
  pdf.text(right, y, `in ${amt(totalOf('cash_in'))}     out ${amt(totalOf('cash_out'))}     airtime ${amt(totalOf('airtime', 'bundle'))}`,
    { size: 10.5, color: GREY, align: 'right' });
  y += 26;

  /* ── optional blocks, each its own checkbox ── */
  const block = (title) => {
    room(80);
    y += 18;
    pdf.text(M, y + 11, title, { size: 9, bold: true, color: GOLD });
    y += 18;
  };
  const pair = (label, value, { colour = INK, bold = false } = {}) => {
    room(20);
    pdf.text(M, y + 11, label, { size: 10, color: GREY });
    pdf.text(right, y + 11, value, { size: 11, bold, color: colour, align: 'right' });
    y += 19;
  };

  if (o.debts) {
    const bal = debtBalances(debtEntries.filter((e) => e.day <= range.end));
    const open = debtAccounts
      .map((a) => ({ name: a.name, net: bal.perAccount.get(a.account_id)?.net || 0 }))
      .filter((p) => Math.abs(p.net) > 0.004);
    block('STILL OWED');
    if (!open.length) pair('Nobody owes anybody', '—');
    for (const p of open) pair(`${p.name} — ${p.net > 0 ? 'owes us' : 'we owe'}`, amt(Math.abs(p.net)));
    pair('In the capital', money(bal.owed_to_us - bal.we_owe, { sign: true, dp: 0 }), { bold: true });
  }

  if (o.statistics) {
    const amounts = live.map((t) => toP(t.amount)).sort((a, b) => a - b);
    const volume = toGhs(sum(amounts));
    block('THE PERIOD IN FIGURES');
    pair('Volume', amt(volume), { bold: true });
    pair('Average line', amounts.length ? amt(toGhs(Math.round(volume * 100 / amounts.length))) : '0');
    pair('Biggest line', amounts.length ? amt(toGhs(amounts[amounts.length - 1])) : '0');
    y += 8;
    for (const w of NETWORKS) {
      const mine = live.filter((t) => t.wallet === w);
      const volP = sum(mine, (t) => toP(t.amount));
      const inP = sum(mine.filter((t) => t.type === 'cash_in'), (t) => toP(t.amount));
      const outP = sum(mine.filter((t) => t.type === 'cash_out'), (t) => toP(t.amount));
      const airP = sum(mine.filter((t) => t.type === 'airtime' || t.type === 'bundle'), (t) => toP(t.amount));
      pair(`${WALLET_LABEL[w]} — ${countLines(mine.length)}`,
        `${amt(toGhs(volP))}     float ${money(toGhs(outP - inP - airP), { sign: true, dp: 0 })}`);
    }
    const months = [...new Set(commissions.map((c) => c.month))].sort();
    if (months.length) {
      y += 6;
      for (const m of months) {
        pair(`Commission ${m}`, amt(toGhs(sum(commissions.filter((c) => c.month === m), (c) => toP(c.amount)))));
      }
    }
  }

  /* ── footer on every page ── */
  const total = pdf.pageCount;
  pdf.pages.forEach((ops, i) => {
    pdf.ops = ops;
    pdf.line(M, pdf.h - M - 14, right, pdf.h - M - 14, { width: 0.4, color: FAINT });
    pdf.text(M, pdf.h - M - 2, boothName, { size: 7.5, color: FAINT });
    pdf.text(pdf.w / 2, pdf.h - M - 2, `${i + 1} of ${total}`, { size: 7.5, color: FAINT, align: 'center' });
    pdf.text(right, pdf.h - M - 2,
      [o.fullNumbers ? 'full customer numbers' : 'customer numbers masked', o.agents ? 'with the agent' : null]
        .filter(Boolean).join(' · '),
      { size: 7.5, color: FAINT, align: 'right' });
  });

  return pdf.save();
}

export const suggestedName = (boothName, range) =>
  `${boothName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-register-${range.start}_${range.end}.pdf`;
