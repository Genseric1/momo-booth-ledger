/* ═══════════════ THE PEN ═══════════════
   One line at the foot of the page, the height of a line in the book: the
   number, in or out, the amount, done. It uses the phone's own keyboard — the
   page is for reading the day, not for holding a keypad.                     */

import { el, toast } from '../ui.js';
import {
  WALLET_LABEL, walletFromNumber, groupNumber, groupAmount, parseAmount,
  acceptNumberInput, NUMBER_LENGTH, isCompleteNumber,
} from '../util.js';
import * as store from '../store.js';

const TYPE_OF = { in: 'cash_in', out: 'cash_out', air: 'airtime', bdl: 'bundle' };
const LABEL = { in: 'in', out: 'out', air: 'airtime', bdl: 'bundle' };

/* The same pen writes a debt: the number becomes a name, in/out become who
   owes whom. Writing it where the lines are written is the whole point — a
   debt is remembered at the counter, not in another screen. */
async function accountFor(name) {
  const found = store.state.debtAccounts.find((a) => a.name.toLowerCase() === name.trim().toLowerCase());
  if (found) return found.account_id;
  return (await store.addDebtAccount(name.trim())).account_id;
}

export function writerBar(ctx) {
  const d = ctx.draft;
  const debtMode = () => d.mode === 'debt';

  const number = el('input.pen-num.num', {
    type: 'tel', inputmode: 'numeric', autocomplete: 'off', placeholder: '024 000 0000',
    value: groupNumber(d.number), 'aria-label': 'customer number',
    oninput: (e) => {
      if (debtMode()) { d.name = e.target.value; return; }
      const { value, error } = acceptNumberInput(e.target.value, d.number);
      d.number = value;
      e.target.value = groupNumber(d.number);
      if (error) toast(error, { error: true });
      paintNet();
      if (isCompleteNumber(d.number)) amount.focus();          // the number is done, move on
    },
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); amount.focus(); } },
  });

  const amount = el('input.pen-amt.num', {
    type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: 'amount',
    value: groupAmount(d.amount), 'aria-label': 'amount',
    oninput: (e) => { d.amount = parseAmount(e.target.value); e.target.value = groupAmount(d.amount); },
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } },
  });

  const dirs = el('div.pen-dirs');
  const net = el('button.pen-net', { title: 'network', onclick: cycleNet });
  const done = el('button.pen-ok', { text: '✓', title: 'write the line (Enter)', onclick: () => save() });

  const bar = el('div.pen', number, dirs, amount, done);
  const more = el('button.pen-more', { text: 'airtime', onclick: () => setDir(d.dir === 'air' ? 'in' : 'air') });
  const bundle = el('button.pen-more', { text: 'bundle', onclick: () => setDir(d.dir === 'bdl' ? 'in' : 'bdl') });
  const debt = el('button.pen-more', { text: 'debt', onclick: () => setMode(debtMode() ? 'line' : 'debt') });
  const row2 = el('div.pen-row2', net, more, bundle, debt);
  const wrap = el('div.writer', bar, row2);

  function paintDirs() {
    dirs.replaceChildren(
      el(`button.in${d.dir === 'in' ? ' on' : ''}`, {
        text: debtMode() ? 'owes us' : 'in', onclick: () => setDir('in') }),
      el(`button.out${d.dir === 'out' ? ' on' : ''}`, {
        text: debtMode() ? 'we owe' : 'out', onclick: () => setDir('out') }));
    more.hidden = bundle.hidden = debtMode();
    debt.classList.toggle('on', debtMode());
    for (const b of [more, bundle]) b.classList.toggle('on', LABEL[d.dir] === b.textContent);
  }
  function paintNet() {
    const w = d.wallet || (debtMode() ? 'CASH' : walletFromNumber(d.number));
    net.textContent = w ? WALLET_LABEL[w].toLowerCase() : 'network?';
    net.classList.toggle('guessed', !d.wallet && !!w);
  }
  function setMode(mode) {
    d.mode = mode;
    /* the direction never carries over from a cash-out into a debt: it would
       turn "he owes us" into "we owe him" without anything showing it */
    d.dir = 'in';
    d.number = ''; d.name = ''; d.amount = ''; d.wallet = mode === 'debt' ? 'CASH' : null;
    number.value = '';
    number.type = mode === 'debt' ? 'text' : 'tel';
    number.inputMode = mode === 'debt' ? 'text' : 'numeric';
    number.placeholder = mode === 'debt' ? 'who owes, or who we owe' : '024 000 0000';
    paintDirs(); paintNet();
    number.focus();
  }
  function setDir(v) { d.dir = v; paintDirs(); if (!d.amount) amount.focus(); }
  function cycleNet() {
    const order = ['MTN', 'TELECEL', 'AT'];
    const cur = d.wallet || walletFromNumber(d.number) || 'MTN';
    d.wallet = order[(order.indexOf(cur) + 1) % order.length];
    paintNet();
  }

  async function save() {
    const value = Number(d.amount || 0);
    if (!(value > 0)) { amount.focus(); return toast('Write the amount', { error: true }); }

    if (debtMode()) {
      if (!d.name?.trim()) { number.focus(); return toast('Who?', { error: true }); }
      const owed = d.dir !== 'out';
      await store.addDebtEntry({
        account_id: await accountFor(d.name), day: ctx.date, wallet: d.wallet || 'CASH', amount: value,
        kind: owed ? 'lend' : 'borrow', agent: ctx.agent || null,
      });
      toast(owed ? `${d.name.trim()} owes ${money(value, { dp: 0 })}` : `We owe ${d.name.trim()} ${money(value, { dp: 0 })}`);
      setMode('debt');                        // ready for the next one, still in debt mode
      ctx.refresh({ focus: false });
      return;
    }

    if (d.number && !isCompleteNumber(d.number)) {
      number.focus();
      return toast(`A number is 0 and ${NUMBER_LENGTH - 1} more digits — this one has ${d.number.length}`, { error: true });
    }
    const wallet = d.wallet || walletFromNumber(d.number);
    if (!wallet) { cycleNet(); return toast('Which network?', { error: true }); }

    await store.addTx({
      day: ctx.date, type: TYPE_OF[d.dir], wallet, amount: value,
      customer_number: d.number, agent: ctx.agent || null,
    });
    const keepDir = d.dir;
    Object.assign(d, emptyDraft(), { dir: keepDir });     // the next line is usually the same kind
    ctx.refresh({ focus: true });
  }

  if (debtMode()) {
    number.type = 'text'; number.inputMode = 'text';
    number.placeholder = 'who owes, or who we owe';
    number.value = d.name || '';
  }
  paintDirs();
  paintNet();
  wrap.focusPen = () => number.focus();
  return wrap;
}

export const emptyDraft = () => ({ mode: 'line', number: '', name: '', dir: 'in', amount: '', wallet: null });
export const unbindKeyboard = () => {};        // the native keyboard needs no binding
