/* The backup is the last copy standing. It has to be locked, it has to be
   complete, and it has to open on a machine that has nothing on it. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBackup, readBackup, backupName } from '../js/backup.js';

const day = '2026-10-29';
const fixture = {
  app: 'PACSBI Register', version: 'vTEST', madeAt: '2026-10-30T12:00:00.000Z',
  booth: { name: 'PACSBI MoMo booth', id: 'test' },
  settings: { boothName: 'PACSBI MoMo booth' },
  stores: {
    day_versions: [{ vid: 'd1', rev: '2026-10-29T08:00:00.000Z', date: day, agent: 'Kojo',
      opening: { MTN: 20000, TELECEL: 5000, AT: 5000, CASH: 98765432, debts: [{ name: 'Yaw', net: 5000 }] } }],
    tx_versions: [{ vid: 't1', rev: '2026-10-29T09:05:00.000Z', tx_id: 'A', day,
      type: 'cash_in', wallet: 'MTN', amount: 1337425, customer_number: '0244123456', agent: 'Kojo' }],
    debt_account_versions: [], debt_entry_versions: [], commission_versions: [],
  },
};

test('a backup gives nothing away to whoever holds the file', async () => {
  const html = await makeBackup('secret-de-la-boutique', fixture);

  assert.ok(!html.includes('0244123456'), 'no customer number in the clear');
  assert.ok(!html.includes('Yaw'), 'no name of anybody who owes');
  /* amounts a page of code could not hold by chance — the first version of
     this test caught "1500" inside the 150000 rounds of the key stretching */
  assert.ok(!html.includes('1337425') && !html.includes('98765432'), 'no amounts');
  assert.ok(!html.includes('secret-de-la-boutique'), 'and not the password either');
});

test('a backup opens on a machine with nothing on it', async () => {
  const html = await makeBackup('secret-de-la-boutique', fixture);

  /* it is a page, carrying its own viewer: no app, no network, no imports */
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(!/<script[^>]+src=/.test(html), 'nothing to fetch from anywhere');
  assert.ok(!/\bimport\s/.test(html), 'and nothing to import');
  assert.ok(html.includes('id="pass"'), 'it asks for the password first');
});

test('the right password gives everything back, the wrong one nothing', async () => {
  const html = await makeBackup('secret-de-la-boutique', fixture);

  const back = await readBackup(html, 'secret-de-la-boutique');
  assert.equal(back.stores.tx_versions[0].customer_number, '0244123456');
  assert.equal(back.stores.day_versions[0].opening.debts[0].net, 5000);
  assert.equal(back.booth.name, 'PACSBI MoMo booth');

  await assert.rejects(() => readBackup(html, 'secret-de-la-boutiqu'),
    /Wrong password/, 'one letter out is out');
  await assert.rejects(() => readBackup('<html>not ours</html>', 'x'), /not a PACSBI backup/);
});

test('two backups never take each other\'s place', () => {
  const name = backupName('PACSBI MoMo booth');
  assert.match(name, /^pacsbi-momo-booth-sauvegarde-\d{4}-\d{2}-\d{2}\.html$/);
  assert.ok(name.includes(new Date().toISOString().slice(0, 10)), 'the day is in the name');
});
