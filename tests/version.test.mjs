/* The version on the About screen and the one the service worker caches under
   have to be the same, or the page tells the reader it is running something it
   is not. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VERSION } from '../js/config.js';

test('the version shown is the version cached', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const cache = sw.match(/const CACHE = '([^']+)'/)?.[1];
  assert.ok(cache, 'the service worker names its cache');
  assert.match(VERSION, /^v\d+$/, 'the version reads like v12');
  assert.equal(cache, `pacsbi-register-${VERSION}`,
    `Settings would show ${VERSION} while the cache says ${cache}`);
});
