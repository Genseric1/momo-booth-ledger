/* Acceptance tests 7 and 8: two devices syncing, and what a bare PDF contains. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { project } from '../js/store.js';
import { buildRegister } from '../js/report.js';
import { displayNumber } from '../js/util.js';

/* A stand-in for the server: rows are keyed by vid, so re-sending is a no-op —
   the same rule PostgREST applies with `resolution=ignore-duplicates`. */
function makeServer() {
  const rows = [];
  const seen = new Set();
  return {
    push(batch) {
      for (const r of batch) {
        if (seen.has(r.vid)) continue;
        seen.add(r.vid);
        rows.push({ ...r, server_at: `2026-09-28T00:00:${String(rows.length).padStart(2, '0')}Z` });
      }
    },
    pull(since) { return rows.filter((r) => r.server_at > since); },
  };
}
function makeDevice(name) {
  return {
    name, local: [], cursor: '1970-01-01T00:00:00Z', pending: [],
    write(row) { this.local.push(row); this.pending.push(row); },
    sync(server) {
      server.push(this.pending);
      this.pending = [];
      const incoming = server.pull(this.cursor);
      const have = new Set(this.local.map((r) => r.vid));
      for (const r of incoming) if (!have.has(r.vid)) this.local.push(r);
      if (incoming.length) this.cursor = incoming[incoming.length - 1].server_at;
    },
    current() { return project(this.local, 'tx_id'); },
  };
}
const v = (vid, tx_id, rev, amount, extra = {}) =>
  ({ vid, tx_id, rev, amount, type: 'cash_in', wallet: 'MTN', day: '2026-09-28', time: rev, cancelled: false, ...extra });

test('7 — two devices write offline, then sync: no duplicates, nothing lost', () => {
  const server = makeServer();
  const a = makeDevice('phone'), b = makeDevice('tablet');

  a.write(v('v1', 'tx1', '2026-09-28T09:00:00Z', 100));
  a.write(v('v2', 'tx2', '2026-09-28T09:05:00Z', 200));
  b.write(v('v3', 'tx3', '2026-09-28T09:02:00Z', 300));

  a.sync(server); b.sync(server); a.sync(server);
  a.sync(server); b.sync(server);                       // syncing twice changes nothing

  assert.equal(a.current().size, 3);
  assert.deepEqual([...a.current().keys()].sort(), ['tx1', 'tx2', 'tx3']);
  assert.deepEqual([...a.current().keys()].sort(), [...b.current().keys()].sort());
  assert.equal(a.local.length, 3, 'a row must never be stored twice');

  /* a correction made on one device wins on both, and the old version survives */
  b.write(v('v4', 'tx1', '2026-09-28T10:00:00Z', 150, { wallet: 'TELECEL' }));
  b.sync(server); a.sync(server);
  assert.equal(a.current().get('tx1').amount, 150);
  assert.equal(a.current().get('tx1').wallet, 'TELECEL');
  assert.equal(a.local.filter((r) => r.tx_id === 'tx1').length, 2, 'history is kept');

  /* same rev on both devices: the vid breaks the tie the same way everywhere */
  a.write(v('v5', 'tx9', '2026-09-28T11:00:00Z', 10));
  b.write(v('v6', 'tx9', '2026-09-28T11:00:00Z', 20));
  a.sync(server); b.sync(server); a.sync(server);
  assert.equal(a.current().get('tx9').amount, b.current().get('tx9').amount);
});

/* Pull the visible strings out of the (uncompressed) content streams. */
function pdfText(bytes) {
  const raw = Buffer.from(bytes).toString('latin1');
  return [...raw.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g)].map((m) => m[1]).join('\n');
}

test('8 — with every box unchecked the PDF holds no balances, no statistics, masked numbers', () => {
  const number = '0244123456';
  const txs = [
    { tx_id: '1', day: '2026-09-28', time: '2026-09-28T09:05:00Z', type: 'cash_in', wallet: 'MTN', amount: 500, customer_number: number, cancelled: false },
    { tx_id: '2', day: '2026-09-28', time: '2026-09-28T09:30:00Z', type: 'cash_out', wallet: 'AT', amount: 250, cancelled: true },
  ];
  const days = new Map([['2026-09-28', {
    date: '2026-09-28', opening: { MTN: 10000, TELECEL: 10000, AT: 10000, CASH: 10000 },
    closing: { MTN: 9500, TELECEL: 10000, AT: 10000, CASH: 10530 }, estimated_extras: 30,
  }]]);
  const args = { boothName: 'PACSBI MoMo booth', range: { start: '2026-09-28', end: '2026-09-28' }, days, txs };

  const bare = pdfText(buildRegister({ ...args, options: {} }));
  assert.ok(bare.includes('500'), 'the lines themselves are always there');
  assert.ok(bare.includes('in'), 'with the direction written as in the book');
  assert.ok(!bare.includes(number), 'no full customer number');
  assert.ok(bare.includes(displayNumber(number, 'masked')), 'the masked number is printed');
  assert.ok(!/IN FIGURES/i.test(bare), 'no statistics block');
  assert.ok(!bare.includes('10,000'), 'no balances: the morning count is not printed');
  assert.ok(!/extra fees/i.test(bare), 'no extras');
  assert.ok(!bare.includes('250'), 'cancelled lines stay out unless asked for');
  assert.ok(bare.includes('customer numbers masked'), 'the footer says so');

  const full = pdfText(buildRegister({
    ...args,
    options: { balances: true, statistics: true, extras: true, cancelled: true, fullNumbers: true },
  }));
  assert.ok(full.includes(displayNumber(number, 'full')), 'the full number is printed in readable blocks');
  assert.ok(/IN FIGURES/i.test(full), 'the figures block is there when asked for');
  assert.ok(full.includes('9,500'), 'the counted balances are printed');
  assert.ok(full.includes('250'), 'cancelled line is printed when asked for');
});

test('a password-protected PDF is encrypted and declares the standard handler', () => {
  const txs = [{ tx_id: '1', day: '2026-09-28', time: '2026-09-28T09:05:00Z', type: 'cash_in', wallet: 'MTN', amount: 500, cancelled: false }];
  const bytes = buildRegister({
    boothName: 'Booth', range: { start: '2026-09-28', end: '2026-09-28' },
    days: new Map(), txs, options: {}, password: '1234',
  });
  const raw = Buffer.from(bytes).toString('latin1');
  assert.ok(raw.includes('/Filter /Standard'));
  assert.ok(raw.includes('/Encrypt'));
  assert.equal(pdfText(bytes).length, 0, 'the visible text is no longer readable in the file');
});
