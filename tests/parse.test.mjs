/* Every file the browser loads has to parse.

   The tests import calc, store, report and sync — never a screen. So a screen
   could be broken through a whole deploy with the suite green and nothing said
   anywhere; only opening the app in a browser would show it. That happened.   */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

test('every file of the app parses', () => {
  const files = [
    'sw.js', 'serve.mjs',
    ...readdirSync(root + 'js').filter((f) => f.endsWith('.js')).map((f) => 'js/' + f),
    ...readdirSync(root + 'js/screens').map((f) => 'js/screens/' + f),
  ];
  assert.ok(files.length > 20, 'the list is not empty by accident');

  const broken = [];
  for (const f of files) {
    try { execFileSync(process.execPath, ['--check', root + f], { stdio: 'pipe' }); }
    catch (e) { broken.push(`${f}: ${String(e.stderr).split('\n').find((l) => /Error/.test(l))}`); }
  }
  assert.deepEqual(broken, [], 'these do not parse');
});
