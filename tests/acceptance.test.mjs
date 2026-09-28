/* The examples from section 11 of the specification, run against the real
   calculation and projection code. `npm test`                               */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayReport, debtBalances, txEffect } from '../js/calc.js';
import { project } from '../js/store.js';
import { WALLETS } from '../js/util.js';

const OPEN = { MTN: 10000, TELECEL: 10000, AT: 10000, CASH: 10000 };
const day = (extra = {}) => ({ date: '2026-09-28', opening: { ...OPEN }, ...extra });
const tx = (o) => ({ tx_id: o.tx_id || 't', time: '2026-09-28T09:00:00Z', cancelled: false, ...o });

test('1 — one cash-in of 10,000 on Telecel', () => {
  const r = dayReport({ day: day(), txs: [tx({ type: 'cash_in', wallet: 'TELECEL', amount: 10000 })] });
  assert.deepEqual(r.expected, { MTN: 10000, TELECEL: 0, AT: 10000, CASH: 20000 });
  assert.equal(r.expectedCapital, 40000);
});

test('2 — a cash-out of 500 on MTN moves float to cash, capital unchanged', () => {
  const base = dayReport({ day: day(), txs: [] });
  const r = dayReport({ day: day(), txs: [tx({ type: 'cash_out', wallet: 'MTN', amount: 500 })] });
  assert.equal(r.expected.MTN, 10500);
  assert.equal(r.expected.CASH, 9500);
  assert.equal(r.expectedCapital, base.expectedCapital);
});

test('3 — airtime 300 paid with 330 cash leaves a +30 gap', () => {
  const closing = { MTN: 9700, TELECEL: 10000, AT: 10000, CASH: 10330 };
  const r = dayReport({ day: day({ closing }), txs: [tx({ type: 'airtime', wallet: 'MTN', amount: 300 })] });
  assert.equal(r.expected.CASH, 10300);
  assert.equal(r.totalGap, 30);
  assert.equal(r.gap.CASH, 30);

  const withExtras = dayReport({ day: day({ closing, estimated_extras: 30 }), txs: [tx({ type: 'airtime', wallet: 'MTN', amount: 300 })] });
  assert.equal(withExtras.residualGap, 0);
});

test('4 — moving a 500 cash-in from MTN to Telecel shifts both by 500, cash untouched', () => {
  const before = dayReport({ day: day(), txs: [tx({ type: 'cash_in', wallet: 'MTN', amount: 500 })] });
  const after = dayReport({ day: day(), txs: [tx({ type: 'cash_in', wallet: 'TELECEL', amount: 500 })] });
  assert.equal(after.expected.MTN - before.expected.MTN, 500);
  assert.equal(after.expected.TELECEL - before.expected.TELECEL, -500);
  assert.equal(after.expected.CASH, before.expected.CASH);
});

test('5 — a cancelled line affects no balance but stays in the day', () => {
  const t = tx({ type: 'cash_in', wallet: 'MTN', amount: 700, cancelled: true });
  assert.deepEqual(txEffect(t), { MTN: 0, TELECEL: 0, AT: 0, CASH: 0 });
  const r = dayReport({ day: day(), txs: [t] });
  assert.deepEqual(r.expected, OPEN);
  assert.equal(r.txCount, 0);
  assert.equal(r.cancelledCount, 1);
});

test('6 — lending 200 cash: cash down, owed to us up, capital unchanged', () => {
  const entry = { entry_id: 'd1', day: '2026-09-28', kind: 'lend', amount: 200, wallet: 'CASH', account_id: 'a' };
  const base = dayReport({ day: day(), txs: [] });
  const r = dayReport({ day: day(), txs: [], dayDebts: [entry] });
  assert.equal(r.expected.CASH, 9800);
  assert.equal(r.owed_to_us, 200);
  assert.equal(r.expectedCapital, base.expectedCapital);

  const bal = debtBalances([entry]);
  assert.equal(bal.owed_to_us, 200);
  assert.equal(bal.perAccount.get('a').net, 200);
});
