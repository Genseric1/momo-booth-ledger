/* ═══════════════ MORNING AND EVENING COUNT ═══════════════
   Four numbers in the morning, four at night. At night the page says in one
   sentence whether it falls right, and never decides for the agent whether a
   difference is a mistake or a fee they charged on top.                      */

import { el, toast, fill, amountInput, confirmSheet } from '../ui.js';
import { WALLETS, WALLET_LABEL, money, dayLabel, addDays } from '../util.js';
import { openBalances } from '../calc.js';
import * as store from '../store.js';
import * as sync from '../sync.js';
import { reportFor } from './page.js';
import { entrySheet, personSheet } from './debts.js';

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

/* What a saved point carries, or nothing if it has never been saved. */
const frozen = (snap) => (Array.isArray(snap?.debts) ? snap.debts : null);
const netOf = (people) => people.reduce((t, p) => t + p.net, 0);

function countSheet(vals, people, { ctx = null } = {}) {
  const open = ctx && sync.canWrite() ? (p) => () => personSheet(ctx, p) : () => null;
  const debts = netOf(people);
  const total = el('div.v.num');
  const waiting = el('small');

  /* A sum that leaves out the wallets is not a total. The four fields start
     empty on purpose — the evening is counted, not copied — and while they
     are, adding them to the debts gave a figure that looked like the booth's
     worth and was only what people owed: 40,000 under four wallets holding
     two hundred thousand. It says nothing at all until it can say the truth. */
  const retotal = () => {
    const missing = WALLETS.filter((w) => vals[w] === '' || vals[w] == null);
    total.textContent = missing.length ? '—' : money(sumOf(vals) + debts, { dp: 0 });
    waiting.textContent = missing.length
      ? `still to count: ${missing.map((w) => (w === 'CASH' ? 'cash' : WALLET_LABEL[w])).join(', ')}`
      : '';
  };

  const rows = WALLETS.map((w) => el('div.countrow',
    el('label', { for: `count-${w}`, text: w === 'CASH' ? 'Cash in the box' : WALLET_LABEL[w] }),
    amountInput({ value: vals[w] ?? '', oninput: (v) => { vals[w] = v; retotal(); } })));
  rows.forEach((row, i) => row.querySelector('input').id = `count-${WALLETS[i]}`);

  retotal();
  return el('div.countsheet',
    ...rows,
    /* A name here is the debt itself: tapping it is how it is paid back,
       corrected or put together with the same person spelled another way. */
    ...people.map((p) => el(`${open(p) ? 'button' : 'div'}.countrow.owed`, { onclick: open(p) },
      el('label', { text: p.name }, el('small', { text: p.net > 0 ? 'owes us' : 'we owe' })),
      el(`div.v.num.${p.net > 0 ? 'pos' : 'neg'}`, { text: money(p.net, { sign: p.net < 0, dp: 0 }) }))),
    el('div.countrow.total', el('label', { text: 'TOTAL' }, waiting), total));
}

/* The two buttons that write a debt. They sit under the count because that is
   where a debt is a figure in the capital rather than a line at the counter:
   written here, beside the wallets it moves. */
function debtButtons(ctx) {
  if (!sync.canWrite()) return null;
  return el('div', { style: { marginTop: '16px' } },
    el('button.big.quiet', { text: 'Someone owes us', onclick: () => entrySheet(ctx, 'owed_to_us') }),
    el('button.big.quiet', { text: 'We owe someone', style: { marginTop: '8px' },
      onclick: () => entrySheet(ctx, 'we_owe') }));
}

/* Four wallets at nothing is a booth with nothing in it. It happens by saving
   a sheet that was never filled, and once saved it is what every device reads
   and what the register prints — so it is worth one question. */
const countedNothing = (vals) => WALLETS.every((w) => !(Number(vals[w]) > 0));
const reallyEmpty = (when) => confirmSheet(`${when} count of nothing?`,
  'All four wallets are at zero. That says the booth holds no money at all. If they have not been counted yet, go back and count them.',
  { okLabel: 'Yes, the booth is empty' });

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
  /* One list and one total. Saved, this point reads what it was saved with
     and nothing else. Not yet saved, it reads everything owed as things
     stand — last night's people are still there, and whatever Kojo writes
     this morning joins them and counts.

     There is no cut-off any more. Splitting the day was a way of stopping a
     debt written at eleven from moving a count taken at eight; a count that
     freezes when it is signed off stops that by itself, and without cutting
     anything in two. */
  const live = owing(ctx.date);
  const kept = frozen(store.getDay(ctx.date)?.opening);
  const people = kept || live;
  const moved = kept && Math.abs(netOf(kept) - netOf(live)) > 0.004;

  const sheet = countSheet(vals, people, { ctx });
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
    moved ? el('p.note', { style: { marginTop: '10px' }, text:
      `This count was saved with ${money(netOf(kept), { dp: 0 })} of debts. What is owed now reads ${money(netOf(live), { dp: 0 })}. Save again to take the new figure in.` }) : null,
    debtButtons(ctx),
    !sync.canWrite() ? null : el('button.big', {
      text: 'Save the morning count',
      style: { marginTop: '18px' },
      onclick: async () => {
        if (countedNothing(vals) && !await reallyEmpty('Morning')) return;
        await store.setOpening(ctx.date, vals, ctx.agent, live);
        toast('Morning saved');
        ctx.go('page');
      },
    }));
}

export function eveningScreen(ctx) {
  const rep = reportFor(ctx.date);
  const vals = { ...(rep.hasClosing ? rep.real : {}) };
  const out = el('div.sheetview');

  const render = () => {
    const live = owing(ctx.date);
    const kept = frozen(store.getDay(ctx.date)?.closing);
    const moved = kept && Math.abs(netOf(kept) - netOf(live)) > 0.004;

    /* No prediction under the figures. It was the opening plus the lines
       written, and this booth tops up its float during the day without those
       top-ups being lines, so it read a negative MTN float and set Kojo
       against a number that could not be right. He counts what is there. */
    const sheet = countSheet(vals, kept || live, { ctx });
    if (!sync.canWrite()) readOnly(sheet);

    fill(out,
      el('h2', { text: `Evening — ${dayLabel(ctx.date, { weekday: false })}` }),
      el('p.lead', { text: 'Count for real. This is the number that matters.' }),
      sheet,
      moved ? el('p.note', { style: { marginTop: '10px' }, text:
        `This count was saved with ${money(netOf(kept), { dp: 0 })} of debts. What is owed now reads ${money(netOf(live), { dp: 0 })}. Save again to take the new figure in.` }) : null,
      debtButtons(ctx),
      !sync.canWrite() ? null : el('button.big', {
        text: 'Save the evening count',
        onclick: async () => {
          if (countedNothing(vals) && !await reallyEmpty('Evening')) return;
          await store.setClosing(ctx.date, vals, null, ctx.agent, live);
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
/* After the count is saved: close the day, or reopen it.

   What used to stand here was a verdict — "it falls right", or how much was
   missing, with the four wallets set against what the page predicted. The
   booth asked for it to go, and it was right to: the prediction is opening
   plus the lines written, and this booth tops up its float during the day
   without those top-ups being lines. So the page expected a negative MTN
   float and announced tens of thousands missing, every evening, from
   arithmetic that could not be right. A figure nobody can act on is worse
   than no figure. */
function verdict(rep, ctx) {
  return el('div', { style: { marginTop: '26px' } },
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
