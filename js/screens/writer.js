/* ═══════════════ THE PEN ═══════════════
   One line at the foot of the page, the height of a line in the book: the
   number, in or out, the amount, done. It uses the phone's own keyboard — the
   page is for reading the day, not for holding a keypad.

   It writes lines and nothing else. A debt is written in the morning and
   evening counts, where it is a figure in the capital beside the wallets it
   moves — and where the people the booth already knows are listed, so a name
   is chosen rather than typed. Typing it here, from memory, is how one person
   became two.                                                               */

import { el, toast } from '../ui.js';
import {
  WALLET_LABEL, walletFromNumber, groupNumber, groupAmount, parseAmount,
  acceptNumberInput, NUMBER_LENGTH, isCompleteNumber,
} from '../util.js';
import * as store from '../store.js';

const TYPE_OF = { in: 'cash_in', out: 'cash_out', air: 'airtime', bdl: 'bundle' };

export function writerBar(ctx) {
  const d = ctx.draft;

  const number = el('input.pen-num.num', {
    type: 'tel', inputmode: 'numeric', autocomplete: 'off', placeholder: '024 000 0000',
    value: groupNumber(d.number), 'aria-label': 'customer number',
    oninput: (e) => {
      const { value, error } = acceptNumberInput(e.target.value, d.number);
      d.number = value;
      e.target.value = groupNumber(d.number);
      if (error) toast(error, { error: true });
      paintNet();
      if (isCompleteNumber(d.number)) amount.focus();          // the number is done, move on
    },
    /* Enter does the obvious thing from wherever the cursor is: move on if the
       amount is still missing, write the line if it is there. */
    onkeydown: (e) => {
      if (e.key !== 'Enter' && e.key !== 'Return') return;
      e.preventDefault();
      if (Number(d.amount) > 0) save(); else amount.focus();
    },
  });

  const amount = el('input.pen-amt.num', {
    type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: 'amount',
    value: groupAmount(d.amount), 'aria-label': 'amount',
    oninput: (e) => { d.amount = parseAmount(e.target.value); e.target.value = groupAmount(d.amount); },
    onkeydown: (e) => {
      if (e.key !== 'Enter' && e.key !== 'Return') return;
      e.preventDefault();
      save();
    },
  });

  const dirs = el('div.pen-dirs');
  const net = el('button.pen-net', { title: 'network', onclick: cycleNet });
  const done = el('button.pen-ok', { text: '✓', title: 'write the line (Enter)', onclick: () => save() });

  const bar = el('div.pen', number, dirs, amount, done);
  const more = el('button.pen-more', { text: 'a — airtime', onclick: () => setDir(d.dir === 'air' ? 'in' : 'air') });
  const bundle = el('button.pen-more', { text: 'b — bundle', onclick: () => setDir(d.dir === 'bdl' ? 'in' : 'bdl') });
  const row2 = el('div.pen-row2', net, more, bundle);
  const wrap = el('div.writer', bar, row2);

  function paintDirs() {
    dirs.replaceChildren(
      el(`button.in${d.dir === 'in' ? ' on' : ''}`, { text: 'in', onclick: () => setDir('in') }),
      el(`button.out${d.dir === 'out' ? ' on' : ''}`, { text: 'out', onclick: () => setDir('out') }));
    more.classList.toggle('on', d.dir === 'air');
    bundle.classList.toggle('on', d.dir === 'bdl');
  }
  function paintNet() {
    const w = d.wallet || walletFromNumber(d.number);
    net.textContent = w ? WALLET_LABEL[w].toLowerCase() : 'network?';
    net.classList.toggle('guessed', !d.wallet && !!w);
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

  paintDirs();
  paintNet();
  wrap.focusPen = () => number.focus();
  return wrap;
}

export const emptyDraft = () => ({ number: '', dir: 'in', amount: '', wallet: null });
export const unbindKeyboard = () => {};        // the native keyboard needs no binding
