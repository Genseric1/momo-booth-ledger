/* ═══════════════ THE WRITER ═══════════════
   The bottom of the screen is a pen. You write a line the way you write it in
   the notebook: the number, then in or out, then the amount, then the tick.
   The network is read from the number while you type — that is the part the
   agent no longer has to think about.                                        */

import { el, toast, fill } from '../ui.js';
import { WALLET_LABEL, walletFromNumber, money, groupNumber, NUMBER_LENGTH, isCompleteNumber } from '../util.js';
import * as store from '../store.js';

const TYPE_OF = { in: 'cash_in', out: 'cash_out', air: 'airtime', bdl: 'bundle' };

export function writerBar(ctx) {
  const d = ctx.draft;                       // { number, dir, amount, wallet, step }
  const bar = el('div.writer');

  const numberField = el('div.f.num');
  const dirField = el('div.dir');
  const amountField = el('div.amt.num');
  const netField = el('div.net');
  const draft = el('div.draft',
    el('div', numberField, netField),
    dirField, amountField);

  const dirs = el('div.dirs');
  const extras = el('div.extras');
  const keys = el('div.keys');
  const hint = el('div.kbhint', { text: 'keyboard: digits  ·  i = in  ·  o = out  ·  enter writes the line' });
  bar.append(draft, dirs, extras, keys, hint);

  const guess = () => walletFromNumber(d.number);

  function paint() {
    const onNumber = d.step === 'number';
    numberField.className = `f num${d.number ? '' : ' empty'}${onNumber ? ' on' : ''}`;
    numberField.textContent = d.number ? groupNumber(d.number) : '024 000 0000';

    const net = d.wallet || guess();
    netField.textContent = net ? `${WALLET_LABEL[net]}${d.wallet ? '' : ' (from the number)'}` : '';

    dirField.className = `dir ${d.dir === 'in' ? 'in' : d.dir === 'out' ? 'out' : 'other'}`;
    dirField.textContent = d.dir || '';

    amountField.className = `amt num${d.step === 'amount' ? ' on' : ''}`;
    amountField.textContent = d.amount ? money(Number(d.amount), { dp: 0 }) : d.dir ? '0' : '';

    fill(dirs, 
      ...(d.dir && d.step === 'amount'
        ? [el('button.done', { text: `Write the line  ✓`, disabled: !(Number(d.amount) > 0), onclick: save })]
        : [
          el(`button.in${d.dir === 'in' ? '.on' : ''}`, { text: 'in', onclick: () => pickDir('in') }),
          el(`button.out${d.dir === 'out' ? '.on' : ''}`, { text: 'out', onclick: () => pickDir('out') }),
        ]));

    fill(extras, 
      el(`button${d.dir === 'air' ? '.on' : ''}`, { text: 'airtime', onclick: () => pickDir('air') }),
      el(`button${d.dir === 'bdl' ? '.on' : ''}`, { text: 'bundle', onclick: () => pickDir('bdl') }),
      net ? el('button', { text: `network: ${WALLET_LABEL[net]}`, onclick: cycleNet }) : null,
      d.number || d.amount || d.dir ? el('button', { text: 'clear', onclick: reset }) : null);

    fill(keys, 
      ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => el('button', { text: k, onclick: () => push(k) })),
      el('button', { text: '⌫', onclick: back }),
      el('button', { text: '0', onclick: () => push('0') }),
      d.dir
        ? el('button.ok', { text: '✓', disabled: !(Number(d.amount) > 0), onclick: save })
        : el('button', { text: '00', onclick: () => push('00') }));
  }

  const push = (k) => {
    if (d.step === 'number') { d.number = (d.number + k).slice(0, NUMBER_LENGTH); }
    else if ((d.amount + k).replace(/^0+(?=\d)/, '').length <= 9) {
      d.amount = (d.amount + k).replace(/^0+(?=\d)/, '');
    }
    paint();
  };
  const back = () => {
    if (d.step === 'amount') {
      if (d.amount) d.amount = d.amount.slice(0, -1);
      else { d.step = 'number'; d.dir = null; }
    } else d.number = d.number.slice(0, -1);
    paint();
  };
  const pickDir = (dir) => {
    d.dir = dir;
    d.step = 'amount';
    if (!d.wallet) d.wallet = guess();
    paint();
  };
  const cycleNet = () => {
    const order = ['MTN', 'TELECEL', 'AT'];
    const cur = d.wallet || guess() || 'MTN';
    d.wallet = order[(order.indexOf(cur) + 1) % order.length];
    paint();
  };
  const reset = () => { d.number = ''; d.amount = ''; d.dir = null; d.wallet = null; d.step = 'number'; paint(); };

  async function save() {
    const amount = Number(d.amount || 0);
    if (!(amount > 0)) return toast('Write the amount', { error: true });
    if (d.number && !isCompleteNumber(d.number)) {
      return toast(`A Ghana number is ${NUMBER_LENGTH} digits — this one has ${d.number.length}`, { error: true });
    }
    const wallet = d.wallet || guess();
    if (!wallet) { toast('Which network? Tap "network"', { error: true }); return cycleNet(); }
    await store.addTx({
      day: ctx.date, type: TYPE_OF[d.dir], wallet, amount,
      customer_number: d.number, agent: ctx.agent || null,
    });
    reset();
    ctx.refresh({ flash: true });
  }

  bindKeyboard({
    push, back, reset, net: cycleNet,
    dir: (v) => pickDir(v),
    enter: () => { if (d.dir && Number(d.amount) > 0) save(); else if (d.step === 'number' && d.number) pickDir('in'); },
  });

  paint();
  return bar;
}

export const emptyDraft = () => ({ number: '', dir: null, amount: '', wallet: null, step: 'number' });

/* ── the physical keyboard, for the agent who works on a PC ──
   digits type, i / o choose the direction, Enter writes the line, Esc clears.
   Nothing is captured while a form field or a sheet has the focus.           */
let keyHandler = null;
function bindKeyboard(handlers) {
  if (keyHandler) removeEventListener('keydown', keyHandler);
  keyHandler = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector('.sheet-bg')) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const k = e.key;
    if (/^[0-9]$/.test(k)) handlers.push(k);
    else if (k === 'Backspace') handlers.back();
    else if (k === 'Enter' || k === 'Return') handlers.enter();
    else if (k === 'Escape') handlers.reset();
    else if (k === 'i' || k === 'I' || k === '+') handlers.dir('in');
    else if (k === 'o' || k === 'O' || k === '-') handlers.dir('out');
    else if (k === 'a' || k === 'A') handlers.dir('air');
    else if (k === 'b' || k === 'B') handlers.dir('bdl');
    else if (k === 'n' || k === 'N') handlers.net();
    else return;
    e.preventDefault();
  };
  addEventListener('keydown', keyHandler);
}
export function unbindKeyboard() {
  if (keyHandler) removeEventListener('keydown', keyHandler);
  keyHandler = null;
}
