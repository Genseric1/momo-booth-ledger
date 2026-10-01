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

/* The bug that kept three devices at "2 to send" although the server had the
   lines: an insert sent with `return=minimal` answers 201 with no body, and
   asking an empty answer for its JSON throws. */
test('an empty answer from the server is not an error', async () => {
  const { readBody } = await import('../js/sync.js');

  assert.equal(await readBody(new Response('', { status: 201 })), null);
  assert.equal(await readBody(new Response(null, { status: 204 })), null);
  assert.equal(await readBody(new Response('   ', { status: 200 })), null);
  assert.deepEqual(await readBody(new Response('[{"vid":"a"}]')), [{ vid: 'a' }]);
});

/* Three devices showed three different totals for the same evening. The
   wallets agreed; the debts did not. A device that had the entries but not yet
   the names dropped the nameless ones from the list — while still counting
   them in the capital. Reproduced with the real figures of 30 Sep 2026. */
test('a debt whose name has not arrived yet still counts, and still shows', async () => {
  const { openBalances, NO_NAME, dayReport } = await import('../js/calc.js');

  const day = '2026-09-30';
  const entries = [
    { entry_id: 'e1', account_id: 'a1', day, kind: 'lend', wallet: 'CASH', amount: 20571, cancelled: false },
    { entry_id: 'e2', account_id: 'a2', day, kind: 'lend', wallet: 'CASH', amount: 50000, cancelled: false },
  ];
  const accounts = [{ account_id: 'a1', name: 'Modeste' }];   // a2 has not reached this device

  const open = openBalances(entries, accounts, day);
  assert.equal(open.length, 2, 'the nameless one is not dropped');
  assert.ok(open.some((p) => p.name === NO_NAME), 'it is shown without a name');
  assert.equal(open.reduce((t, p) => t + p.net, 0), 70571);

  /* the heart of it: what the count screen adds up has to be the capital the
     day sheet works out, on every device, whatever it has received */
  const counted = { MTN: 18639, TELECEL: 7806, AT: 5401, CASH: 170406 };
  const rep = dayReport({ day: { date: day, closing: counted }, txs: [], dayDebts: entries });
  const onScreen = Object.values(counted).reduce((a, b) => a + b, 0)
    + open.reduce((t, p) => t + p.net, 0);
  assert.equal(onScreen, rep.realCapital, 'the total on the screen is the real capital');
  assert.equal(onScreen, 272823);
});

/* The bug that made a deleted debt come back on every other device: a mutation
   written as stamp({ ...currentRow, deleted: true }) inherited the old row's
   vid, so it was not a new version at all. The device overwrote its own
   predecessor; the server, which ignores a vid it already holds, dropped it in
   silence. Lines were spared only because they are rebuilt field by field. */
test('a corrected row is a new version, not the old one written over', async () => {
  const { stamp, project } = await import('../js/store.js');

  const original = {
    vid: 'c0ffee00-0000-4000-8000-000000000001', rev: '2020-01-01T10:00:00.000Z',
    entry_id: 'e1', account_id: 'a1', amount: 500, deleted: false,
    server_at: '2020-01-01T10:00:01Z', pending: 0,
  };
  const next = stamp({ ...original, deleted: true });

  assert.notEqual(next.vid, original.vid, 'a new version gets its own vid');
  assert.ok(next.rev > original.rev, 'and its own rev, or it would not win');
  assert.equal(next.server_at, undefined, 'the server stamps its own arrival time');
  assert.equal(next.pending, undefined, 'pending belongs to the device');
  assert.equal(next.deleted, true, 'the change itself is carried');
  assert.equal(next.account_id, 'a1', 'and so is everything not touched');

  const now = project([original, next], 'entry_id').get('e1');
  assert.equal(now.deleted, true, 'what the booth sees is the deletion');
  assert.equal(now.vid, next.vid);
});

/* Two devices, identical inventories, different contents. The only way: a row
   that reached the server in the same instant as another, split by a cursor
   that asks for everything strictly after a moment. Whichever fell on the
   wrong side was never read by that device again. */
test('two rows arriving in the same instant are both read', async () => {
  const { nextCursor } = await import('../js/sync.js');

  const tied = '2026-10-01T11:06:19.123Z';
  const server = [
    { vid: 'a', server_at: '2026-10-01T11:06:18.000Z' },
    { vid: 'b', server_at: tied },
    { vid: 'c', server_at: tied },          // same instant as b
  ];
  const pull = (since) => server.filter((r) => r.server_at > since);

  /* the old rule: the cursor lands exactly on the tie */
  let cursor = '1970-01-01T00:00:00Z';
  let page = pull(cursor).slice(0, 2);                 // a page that ends on b
  cursor = page[page.length - 1].server_at;            // = tied
  assert.equal(pull(cursor).length, 0, 'c is behind the cursor and gone for ever');

  /* the rule now: the cursor stays a little behind what was read */
  cursor = '1970-01-01T00:00:00Z';
  page = pull(cursor).slice(0, 2);
  cursor = nextCursor(page[page.length - 1].server_at);
  const rest = pull(cursor);
  assert.ok(rest.some((r) => r.vid === 'c'), 'c comes back');
  assert.ok(rest.some((r) => r.vid === 'b'), 'b is read again, which merging ignores');
});

/* Two spellings of one name are one person, and the booth is not asked to
   tidy that up. Every device does it on its own — so every device has to
   reach the same answer without talking to the others first. */
test('every device joins the same two names the same way round', async () => {
  const { nextMerge } = await import('../js/store.js');

  const accounts = [
    { account_id: 'b', name: 'Modeste', created_at: '2026-09-29T09:00:00Z' },
    { account_id: 'a', name: 'Modest',  created_at: '2026-09-29T08:00:00Z' },
    { account_id: 'c', name: 'Kojo',    created_at: '2026-09-29T10:00:00Z' },
  ];

  /* whatever order the rows came down in, the oldest name is the one kept */
  for (const order of [accounts, [...accounts].reverse(), [accounts[2], accounts[0], accounts[1]]]) {
    const m = nextMerge(order);
    assert.equal(m.keep.account_id, 'a', 'the oldest name survives');
    assert.equal(m.gone.account_id, 'b');
  }

  /* once joined there is nothing left to do: running it again changes nothing */
  assert.equal(nextMerge(accounts.filter((a) => a.account_id !== 'b')), null);
  assert.equal(nextMerge([]), null);

  /* and a booth that really has two different people keeps both */
  assert.equal(nextMerge([
    { account_id: 'x', name: 'Ama', created_at: '2026-01-01T00:00:00Z' },
    { account_id: 'y', name: 'Amadou', created_at: '2026-01-02T00:00:00Z' },
  ]), null);
});
