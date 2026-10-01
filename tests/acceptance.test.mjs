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

/* The booth settled this one itself, against what the spec first said: a debt
   is an undertaking, not a payment out. Nothing leaves when it is written, so
   nothing may be taken off any wallet — the four figures come from the lines
   of the page and nowhere else. */
test('6 — lending 200: nothing is taken off any wallet, and 200 is owed', () => {
  const entry = { entry_id: 'd1', day: '2026-09-28', kind: 'lend', amount: 200, account_id: 'a' };
  const base = dayReport({ day: day(), txs: [] });
  const r = dayReport({ day: day(), txs: [], dayDebts: [entry] });

  for (const w of ['MTN', 'TELECEL', 'AT', 'CASH']) {
    assert.equal(r.expected[w], base.expected[w], `${w} is untouched`);
  }
  assert.equal(r.owed_to_us, 200);
  assert.equal(r.expectedCapital, base.expectedCapital + 200, 'the claim stands beside the money');

  /* and it comes back without either half being counted twice: the claim goes,
     and the cash that arrived is found by the count that evening */
  const paid = { entry_id: 'd2', day: '2026-09-28', kind: 'repay_received', amount: 200, account_id: 'a' };
  const back = dayReport({ day: day(), txs: [], dayDebts: [entry, paid] });
  assert.equal(back.owed_to_us, 0);
  assert.equal(back.expectedCapital, base.expectedCapital, 'back where it started');

  const bal = debtBalances([entry]);
  assert.equal(bal.owed_to_us, 200);
  assert.equal(bal.perAccount.get('a').net, 200);
});

/* The morning opens where the evening closed. Kojo's booth ended 30 Sep on
   202,252 and the morning of 1 Oct announced 257,000 — the difference was
   money lent out hours after that morning count was supposed to describe. */
test('the morning count carries yesterday\'s debts, not today\'s', async () => {
  const { openBalances, dayReport } = await import('../js/calc.js');

  const lentToday = [{ entry_id: 'e1', account_id: 'a1', day: '2026-10-01',
    kind: 'lend', wallet: 'CASH', amount: 70571, cancelled: false }];
  const accounts = [{ account_id: 'a1', name: 'Modeste' }];
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

  const closed = dayReport({
    day: { date: '2026-09-30', closing: { MTN: 18639, TELECEL: 7806, AT: 5401, CASH: 170406 } },
    txs: [], dayDebts: [],
  });
  assert.equal(closed.realCapital, 202252, 'what the booth was worth that evening');

  /* the morning's cut-off: the end of the day before */
  const carried = openBalances(lentToday, accounts, '2026-09-30');
  assert.equal(carried.length, 0, 'a debt made today is not in this morning');

  const opening = { MTN: 18539, TELECEL: 6806, AT: 5401, CASH: 171436 };
  const morning = sum(opening) + carried.reduce((t, p) => t + p.net, 0);
  assert.equal(morning, 202182, 'the morning is the money that is there, and nothing else');
  assert.ok(Math.abs(morning - closed.realCapital) < 100, 'it opens where the evening closed');

  /* the evening's cut-off: the day itself — tonight the debt does count */
  assert.equal(openBalances(lentToday, accounts, '2026-10-01').length, 1);
});

/* A point the booth has signed off is a photograph: it reads the same in a
   month as on the evening it was taken. Correcting a debt today must not move
   the capital of a morning closed last week — and the names a point carries
   are how the booth later asks what Modeste owed that morning, that evening,
   and the morning after. */
test('a saved count keeps the debts it was saved with', async () => {
  const { dayReport, snapshotDebts } = await import('../js/calc.js');

  const wallets = { MTN: 10000, TELECEL: 0, AT: 0, CASH: 0 };
  const morning = { ...wallets, debts: [{ account_id: 'a1', name: 'Modeste', net: 10000 },
                                        { account_id: 'a2', name: 'Séphora', net: -30000 }] };
  assert.equal(snapshotDebts(morning), -2000000, 'owed to us adds, owed by us takes away');

  /* A + B, with B a net that can be negative */
  const r = dayReport({ day: { date: '2026-10-01', opening: morning }, txs: [] });
  assert.equal(r.openingCapital, 10000 - 20000, 'A + B, and B is 10,000 - 30,000');

  /* the live list later says something else entirely; the point does not move */
  const later = dayReport({
    day: { date: '2026-10-01', opening: morning },
    txs: [],
    dayDebts: [{ entry_id: 'x', account_id: 'a1', kind: 'lend', amount: 999999 }],
  });
  assert.equal(later.openingCapital, r.openingCapital, 'the morning is acted and stays acted');

  /* and the evening is its own photograph, C + D */
  const evening = { MTN: 9000, TELECEL: 0, AT: 0, CASH: 500, debts: [{ name: 'Modeste', net: 10000 }] };
  const night = dayReport({ day: { date: '2026-10-01', opening: morning, closing: evening }, txs: [] });
  assert.equal(night.realCapital, 9500 + 10000, 'C + D');
  assert.equal(night.closingDebts, 10000);
  assert.equal(night.openingDebts, -20000, 'each point keeps its own');
});

/* One list, one total, at the bottom. The four wallets and the people are the
   same list, and everything above the line is in the figure below it. */
test('a count is one list and one total', async () => {
  const { dayReport } = await import('../js/calc.js');

  const point = {
    MTN: 10000, TELECEL: 10000, AT: 10000, CASH: 10000,
    debts: [{ name: 'Modeste', net: 50000 }, { name: 'Séphora', net: -30000 }],
  };
  const morning = dayReport({ day: { date: '2026-10-01', opening: point }, txs: [] });
  assert.equal(morning.openingCapital, 60000, '40,000 + 50,000 - 30,000');

  const evening = dayReport({ day: { date: '2026-10-01', closing: point }, txs: [] });
  assert.equal(evening.realCapital, 60000, 'the evening counts the same way');

  /* a debt written on the count is in the count, not beside it */
  const written = dayReport({
    day: { date: '2026-10-01', opening: { MTN: 18539, TELECEL: 6806, AT: 5401, CASH: 171436,
      debts: [{ name: 'Modeste', net: 100000 }] } },
    txs: [],
  });
  assert.equal(written.openingCapital, 302182, '202,182 and the 100,000 just written');
});
