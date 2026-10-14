/* ═══════════════ MORNING AND EVENING COUNT ═══════════════
   Four figures and a list of people, twice a day. Each count is a sheet of its
   own, the way the two halves of a page in the book are their own.

   A count holds its own people. Not a view onto a running list of debts — its
   own, written on it and signed with it. That is the whole of the booth's
   rule, and the one thing a shared list could never give: what is written or
   removed on the evening cannot reach the morning it followed, and what is
   written tomorrow cannot reach either of them.

   It was a view onto a running list for a while, and every coupling the booth
   complained about followed from that: the morning and the evening of one day
   showing the same names, a debt settled in November emptying an October
   count, a line deleted today vanishing from every day behind it. The
   registers stayed right throughout, because a register has always read the
   counts themselves.                                                         */

import { el, toast, fill, sheet, amountInput, confirmSheet, chipRow } from '../ui.js';
import { WALLETS, WALLET_LABEL, money, dayLabel, addDays, foldName } from '../util.js';
import * as store from '../store.js';
import * as sync from '../sync.js';
import { reportFor } from './page.js';

const sumOf = (o) => WALLETS.reduce((t, w) => t + (Number(o?.[w]) || 0), 0);
const netOf = (people) => people.reduce((t, p) => t + (Number(p.net) || 0), 0);

/* The people a saved count carries, copied so that editing the sheet cannot
   reach back into what was signed. */
const carried = (snap) => (Array.isArray(snap?.debts) ? snap.debts.map((p) => ({ ...p })) : null);

/* A sheet that has never been signed opens on the one before it — last night's
   people for a morning, this morning's for an evening — already written, so
   the booth adjusts instead of remembering. From that moment it is its own. */
function startingPeople(date, which) {
  const day = store.getDay(date);
  const mine = carried(which === 'opening' ? day?.opening : day?.closing);
  if (mine) return mine;
  if (which === 'closing') {
    const morning = carried(day?.opening);
    if (morning) return morning;
  }
  return carried(store.getDay(addDays(date, -1))?.closing) || [];
}

/* ── the sheet ─────────────────────────────────────────────────────────── */

function countSheet(vals, people, { onEdit = null } = {}) {
  const total = el('div.v.num');
  const waiting = el('small');

  /* A sum that leaves out the wallets is not a total. The four fields start
     empty on purpose — a count is counted, not copied — and while they are,
     adding them to the people gave a figure that looked like the booth's
     worth and was only what people owed. It says nothing at all until it can
     say the truth. */
  const retotal = () => {
    const missing = WALLETS.filter((w) => vals[w] === '' || vals[w] == null);
    total.textContent = missing.length ? '—' : money(sumOf(vals) + netOf(people), { dp: 0 });
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
    ...people.map((p, i) => el(`${onEdit ? 'button' : 'div'}.countrow.owed`,
      { onclick: onEdit ? () => onEdit(i) : null },
      el('label', { text: p.name }, el('small', { text: p.net > 0 ? 'owes us' : 'we owe' })),
      el(`div.v.num.${p.net > 0 ? 'pos' : 'neg'}`, { text: money(p.net, { sign: p.net < 0, dp: 0 }) }))),
    el('div.countrow.total', el('label', { text: 'TOTAL' }, waiting), total));
}

/* ── writing a person onto the sheet ───────────────────────────────────── */

/* The people already on the sheet come first and a name is typed only for
   somebody new, so one person cannot become two over a spelling. And a name
   that folds onto one already there joins it rather than sitting beside it. */
function addPerson(people, direction, done) {
  const st = { name: '', amount: '', fresh: !people.length };
  const title = direction > 0 ? 'Someone owes us' : 'We owe someone';

  sheet(title, ({ body, close }) => {
    const render = () => fill(body,
      el('div.field',
        el('label', { text: 'Who' }),
        people.length ? el('div.pick', people.map((p) =>
          el(`button${foldName(st.name) === foldName(p.name) ? '.on' : ''}`, {
            text: p.name, onclick: () => { st.name = p.name; st.fresh = false; render(); },
          }))) : null,
        st.fresh
          ? el('input', { value: st.name, placeholder: 'name', autocomplete: 'off',
              style: { marginTop: '8px' }, oninput: (e) => { st.name = e.target.value; } })
          : el('button.big.quiet', { text: 'Someone new', style: { marginTop: '8px' },
              onclick: () => { st.fresh = true; st.name = ''; render(); } })),
      el('div.field',
        el('label', { text: 'How much' }),
        amountInput({ value: st.amount, oninput: (v) => { st.amount = v; } })),
      el('p.note', { text: direction > 0
        ? 'Written down as owed to the booth. Nothing is taken out of MTN, Telecel, AT or the cash box.'
        : 'Written down as owed by the booth. Nothing is added to MTN, Telecel, AT or the cash box.' }),
      el('button.big', { text: 'Add', style: { marginTop: '10px' }, onclick: () => {
        const name = st.name.trim();
        const value = Number(st.amount);
        if (!name) return toast('Who?', { error: true });
        if (!(value > 0)) return toast('How much?', { error: true });

        const found = people.findIndex((p) => foldName(p.name) === foldName(name));
        if (found >= 0) people[found].net += direction * value;
        else people.push({ name, net: direction * value });
        close();
        done();
      } }));
    render();
    return [];
  });
}

/* Correcting or removing one, on this sheet and nowhere else. */
function editPerson(people, i, done) {
  const p = people[i];
  const st = { amount: String(Math.abs(p.net)), owed: p.net > 0 };

  sheet(p.name, ({ body, close }) => {
    const render = () => fill(body,
      el('div.field',
        el('label', { text: 'Which way' }),
        chipRow([{ value: 'owed', label: 'owes us' }, { value: 'owe', label: 'we owe' }],
          st.owed ? 'owed' : 'owe', (v) => { st.owed = v === 'owed'; render(); })),
      el('div.field',
        el('label', { text: 'How much' }),
        amountInput({ value: st.amount, oninput: (v) => { st.amount = v; } })),
      el('button.big', { text: 'Save', style: { marginTop: '10px' }, onclick: () => {
        const value = Number(st.amount);
        if (!(value > 0)) return toast('How much?', { error: true });
        people[i] = { ...p, net: (st.owed ? 1 : -1) * value };
        close();
        done();
      } }),
      el('button.big.warn', { text: 'Remove from this count', style: { marginTop: '8px' },
        onclick: async () => {
          if (!await confirmSheet('Remove from this count',
            `${p.name} leaves this count only. Every other count keeps what it was signed with.`,
            { danger: true, okLabel: 'Remove' })) return;
          people.splice(i, 1);
          close();
          done();
        } }));
    render();
    return [];
  });
}

function debtButtons(people, done) {
  if (!sync.canWrite()) return null;
  return el('div', { style: { marginTop: '16px' } },
    el('button.big.quiet', { text: 'Someone owes us', onclick: () => addPerson(people, 1, done) }),
    el('button.big.quiet', { text: 'We owe someone', style: { marginTop: '8px' },
      onclick: () => addPerson(people, -1, done) }));
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

/* ── the two counts ────────────────────────────────────────────────────── */

export function morningScreen(ctx) {
  const rep = reportFor(ctx.date);
  const prev = reportFor(addDays(ctx.date, -1));
  const vals = { ...(rep.hasOpening ? rep.opening : {}) };
  const people = startingPeople(ctx.date, 'opening');
  const out = el('div.sheetview');

  const render = () => {
    const sheetEl = countSheet(vals, people,
      { onEdit: sync.canWrite() ? (i) => editPerson(people, i, render) : null });
    if (!sync.canWrite()) readOnly(sheetEl);

    fill(out,
      el('h2', { text: `Morning — ${dayLabel(ctx.date, { weekday: false })}` }),
      el('p.lead', { text: 'What is really in each wallet and in the box, before the first customer.' }),
      prev.hasClosing ? el('button.big.quiet', {
        text: `Take yesterday's evening count (${money(prev.realCapital, { dp: 0 })})`,
        style: { marginBottom: '18px' },
        onclick: () => {
          for (const w of WALLETS) {
            const input = sheetEl.querySelector(`#count-${w}`);
            input.value = money(prev.real[w], { dp: 0 });
            vals[w] = String(prev.real[w]);
            input.dispatchEvent(new Event('input'));
          }
          toast('Copied — check it before saving');
        },
      }) : null,
      sheetEl,
      debtButtons(people, render),
      !sync.canWrite() ? null : el('button.big', {
        text: 'Save the morning count',
        style: { marginTop: '18px' },
        onclick: async () => {
          if (countedNothing(vals) && !await reallyEmpty('Morning')) return;
          await store.setOpening(ctx.date, vals, ctx.agent, people);
          toast('Morning saved');
          ctx.go('page');
        },
      }));
  };
  render();
  return out;
}

export function eveningScreen(ctx) {
  const rep = reportFor(ctx.date);
  const vals = { ...(rep.hasClosing ? rep.real : {}) };
  const people = startingPeople(ctx.date, 'closing');
  const out = el('div.sheetview');

  const render = () => {
    const sheetEl = countSheet(vals, people,
      { onEdit: sync.canWrite() ? (i) => editPerson(people, i, render) : null });
    if (!sync.canWrite()) readOnly(sheetEl);

    fill(out,
      el('h2', { text: `Evening — ${dayLabel(ctx.date, { weekday: false })}` }),
      el('p.lead', { text: 'Count for real. This is the number that matters.' }),
      sheetEl,
      debtButtons(people, render),
      !sync.canWrite() ? null : el('button.big', {
        text: 'Save the evening count',
        onclick: async () => {
          if (countedNothing(vals) && !await reallyEmpty('Evening')) return;
          await store.setClosing(ctx.date, vals, null, ctx.agent, people);
          toast('Evening saved');
          ctx.refresh();
        },
      }),
      rep.hasClosing ? dayButtons(rep, ctx) : null);
  };
  render();
  return out;
}

/* After the count is saved: close the day, or reopen it. */
function dayButtons(rep, ctx) {
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
