/* The booth's own rule: a customer number is ten digits and starts with 0. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptNumberInput, isCompleteNumber, formatNumber, maskNumber, walletFromNumber } from '../js/util.js';

test('a number is accepted only as 0 plus nine digits', () => {
  assert.ok(isCompleteNumber('0244123456'));
  assert.ok(!isCompleteNumber('024412345'), 'nine digits is not a number');
  assert.ok(!isCompleteNumber('02441234567'), 'eleven digits is not a number');
  assert.ok(!isCompleteNumber('2441234567'), 'ten digits that do not start with 0 is not a number');
});

test('what is typed is cleaned, and a first digit other than 0 is refused', () => {
  assert.deepEqual(acceptNumberInput('0244123456'), { value: '0244123456', error: null });
  assert.deepEqual(acceptNumberInput('024 412 3456'), { value: '0244123456', error: null });
  assert.deepEqual(acceptNumberInput('+233244123456'), { value: '0244123456', error: null });
  assert.deepEqual(acceptNumberInput('233244123456'), { value: '0244123456', error: null });

  /* said without its leading zero, the way people read a number out loud */
  assert.deepEqual(acceptNumberInput('244123456'), { value: '0244123456', error: null });

  /* a wrong first digit keeps what was already there and says why */
  const typo = acceptNumberInput('5', '024412');
  assert.equal(typo.value, '024412', 'the digits already typed survive');
  assert.match(typo.error, /starts with 0/);

  assert.deepEqual(acceptNumberInput(''), { value: '', error: null }, 'an empty field stays empty');
  assert.equal(acceptNumberInput('02441234567890').value, '0244123456', 'never longer than ten');
});

test('the number drives the display and the network guess', () => {
  assert.equal(formatNumber('0244123456'), '024 412 3456');
  assert.equal(maskNumber('0244123456'), '024 *** 3456', 'the middle block goes, the groups stay whole');
  assert.equal(walletFromNumber('0244123456'), 'MTN');
  assert.equal(walletFromNumber('0201112222'), 'TELECEL');
  assert.equal(walletFromNumber('0271112222'), 'AT');
  /* every block MTN holds, so a 053 is not left asking "network?" */
  for (const p of ['024', '025', '053', '054', '055', '059']) {
    assert.equal(walletFromNumber(`${p}1112222`), 'MTN', p);
  }
  for (const p of ['020', '050']) assert.equal(walletFromNumber(`${p}1112222`), 'TELECEL', p);
  for (const p of ['026', '027', '056', '057']) assert.equal(walletFromNumber(`${p}1112222`), 'AT', p);
  assert.equal(walletFromNumber('0991112222'), null, 'an unknown prefix guesses nothing');
});
