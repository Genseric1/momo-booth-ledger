/* ═══════════════ MORNING AND EVENING COUNT ═══════════════
   Four numbers in the morning, four at night. At night the page says in one
   sentence whether it falls right, and never decides for the agent whether a
   difference is a mistake or a fee they charged on top.                      */

import { el, toast, fill, amountInput } from '../ui.js';
import { WALLETS, WALLET_LABEL, money, dayLabel, addDays } from '../util.js';
import { openBalances } from '../calc.js';
import * as store from '../store.js';
import * as sync from '../sync.js';
import { reportFor } from './page.js';

/* Who still owes, and who is still owed, as things stand on that day. A debt is
   part of the capital, so this is where it belongs — beside the wallets that
   were counted, not among the lines of the page. */
const owing = (upToDay) =>
  openBalances(store.state.debtEntries, store.state.debtAccounts, upToDay);

/* The sheet of the day: the four wallets to fill in, then every person who
   still owes or is still owed, already written down, and the total underneath.
   The people are part of the capital — leaving them out would make the total
   disagree with the lines above it. */
const sumOf = (o) => WALLETS.reduce((t, w) => t + (Number(o?.[w]) || 0), 0);

function countSheet(vals, upToDay, { hint = null } = {}) {
  const people = owing(upToDay);
  const debts = people.reduce((t, p) => t + p.net, 0);
  const total = el('div.v.num');
  const retotal = () => { total.textContent = money(sumOf(vals) + debts, { dp: 0 }); };

  const rows = WALLETS.map((w) => el('div.countrow',
    el('label', { for: `count-${w}`, text: w === 'CASH' ? 'Cash in the box' : WALLET_LABEL[w] },
      hint ? el('small', { text: hint(w) }) : null),
    amountInput({ value: vals[w] ?? '', oninput: (v) => { vals[w] = v; retotal(); } })));
  rows.forEach((row, i) => row.querySelector('input').id = `count-${WALLETS[i]}`);

  retotal();
  return el('div.countsheet',
    ...rows,
    ...people.map((p) => el('div.countrow.owed',
      el('label', { text: p.name }, el('small', { text: p.net > 0 ? 'owes us' : 'we owe' })),
      el(`div.v.num.${p.net > 0 ? 'pos' : 'neg'}`, { text: money(p.net, { sign: p.net < 0, dp: 0 }) }))),
    el('div.countrow.total', el('label', { text: 'TOTAL' }), total));
}

/* A read-only account sees the figures as text, not as fields to fill. */
function readOnly(field) {
  for (const input of field.querySelectorAll('input')) {
    input.readOnly = true;
    input.tabIndex = -1;
  }
  return field;
}

export function morningScreen(ctx) {
  const rep = reportFor(ctx.date);
  const prev = reportFor(addDays(ctx.date, -1));
  const vals = { ...(rep.hasOpening ? rep.opening : {}) };

  /* The morning is before the first customer, so the debts that belong in it
     are the ones carried over from yesterday — never the ones made during the
     day that has not started yet.

     It used the day itself, and a debt written at eleven in the morning was
     counted in a total that claims to describe eight o'clock. The booth closed
     one evening on 202,252 and opened the next morning on 257,000: the whole
     difference was money lent out after that morning count was taken. The
     button right below says yesterday's figure, and the total under it
     disagreed with it on the same screen. */
  const sheet = countSheet(vals, addDays(ctx.date, -1));
  if (!sync.canWrite()) readOnly(sheet);

  return el('div.sheetview',
    el('h2', { text: `Morning — ${dayLabel(ctx.date, { weekday: false })}` }),
    el('p.lead', { text: 'What is really in each wallet and in the box, before the first customer.' }),
    prev.hasClosing ? el('button.big.quiet', {
      text: `Take yesterday's evening count (${money(prev.realCapital, { dp: 0 })})`,
      style: { marginBottom: '18px' },
      onclick: () => {
        for (const w of WALLETS) {
          const input = sheet.querySelector(`#count-${w}`);
          input.value = money(prev.real[w], { dp: 0 });
          vals[w] = String(prev.real[w]);
          input.dispatchEvent(new Event('input'));
        }
        toast('Copied — check it before saving');
      },
    }) : null,
    sheet,
    !sync.canWrite() ? null : el('button.big', {
      text: 'Save the morning count',
      onclick: async () => { await store.setOpening(ctx.date, vals, ctx.agent); toast('Morning saved'); ctx.go('page'); },
    }));
}

export function eveningScreen(ctx) {
  const rep = reportFor(ctx.date);
  const vals = { ...(rep.hasClosing ? rep.real : {}) };
  let extras = rep.estimated_extras ?? '';
  const out = el('div.sheetview');

  const render = () => {
    const sheet = countSheet(vals, ctx.date, {
      hint: (w) => `the page says ${money(rep.expected[w], { dp: 0 })}`,
    });
    if (!sync.canWrite()) readOnly(sheet);

    fill(out,
      el('h2', { text: `Evening — ${dayLabel(ctx.date, { weekday: false })}` }),
      el('p.lead', { text: 'Count for real. This is the number that matters.' }),
      sheet,
      !sync.canWrite() ? null : el('div.field',
        el('label', { text: 'Extra fees you collected today (if you know)' }),
        amountInput({ value: extras, placeholder: 'optional', oninput: (v) => { extras = v; } }),
        el('div.hint', { text: 'What customers pay you on top is not written line by line, so the page cannot know it.' })),
      !sync.canWrite() ? null : el('button.big', {
        text: 'Save the evening count',
        onclick: async () => {
          await store.setClosing(ctx.date, vals, extras === '' ? null : Number(extras), ctx.agent);
          toast('Evening saved');
          ctx.refresh();
        },
      }),
      rep.hasClosing ? verdict(rep, ctx) : null);
  };
  render();
  return out;
}

/* One sentence first, the four numbers after — not a table to decode. */
function verdict(rep, ctx) {
  const gap = rep.totalGap;
  const residual = rep.residualGap;
  const shown = residual != null ? residual : gap;
  const exact = Math.abs(shown) < 0.005;

  const rows = el('div.rows', WALLETS.map((w) => el('div.r',
    el('div', { text: WALLET_LABEL[w] }, el('small', { text: `page ${money(rep.expected[w], { dp: 0 })}` })),
    el('div.sp'),
    el('div.v.num', { text: money(rep.real[w], { dp: 0 }) }),
    el('div.v.num', {
      class: Math.abs(rep.gap[w]) < 0.005 ? '' : rep.gap[w] > 0 ? 'pos' : 'neg',
      style: { width: '86px', textAlign: 'right' },
      text: Math.abs(rep.gap[w]) < 0.005 ? '—' : money(rep.gap[w], { sign: true, dp: 0 }),
    }))));

  return el('div', { style: { marginTop: '26px' } },
    el('h2', { text: exact ? 'It falls right.' : shown > 0 ? `You have ${money(Math.abs(shown), { dp: 0 })} more` : `${money(Math.abs(shown), { dp: 0 })} is missing` }),
    el('p.lead', {
      text: exact
        ? 'The page and the money agree.'
        : residual != null
          ? `After your ${money(rep.estimated_extras, { dp: 0 })} of extra fees, this much is still unexplained.`
          : 'A difference is not always a mistake: the fees you charge on top are not written line by line. Write your estimate above and it will be taken off.',
    }),
    rows,
    exact && WALLETS.some((w) => Math.abs(rep.gap[w]) > 0.005)
      ? el('p.note', { text: 'The total is right but the networks do not match one by one — some lines were probably written on the wrong network.' })
      : null,
    ...rep.hints.map((h) => el('p.note', {
      text: `${WALLET_LABEL[h.a]} is ${money(h.amount, { dp: 0 })} over and ${WALLET_LABEL[h.b]} is ${money(h.amount, { dp: 0 })} short — a line of ${money(h.amount, { dp: 0 })} was probably written on the wrong network.`,
    })),
    !sync.canWrite() ? null
      : rep.closed && !sync.canReopenDay()
        ? el('p.note', { style: { marginTop: '18px' },
            text: 'This day is closed. Only the manager can reopen it.' })
        : el('button.big.quiet', {
            text: rep.closed ? 'Reopen the day' : 'Close the day',
            style: { marginTop: '18px' },
            onclick: async () => {
              rep.closed ? await store.reopenDay(ctx.date) : await store.closeDay(ctx.date);
              toast(rep.closed ? 'Day reopened' : 'Day closed');
              ctx.refresh();
            },
          }),
    el('button.big.quiet', { text: 'Back to the page', style: { marginTop: '8px' }, onclick: () => ctx.go('page') }));
}
