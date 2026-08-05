import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PENCE_PER_POUND,
  parseMoneyInput,
  poundsToPence,
  penceToPounds,
  formatGBP,
  formatPercent,
  assertPence,
} from '../src/lib/money.js';

test('parseMoneyInput accepts plain amounts', () => {
  assert.equal(parseMoneyInput('0'), 0);
  assert.equal(parseMoneyInput('1'), 100);
  assert.equal(parseMoneyInput('3214.58'), 321_458);
  assert.equal(parseMoneyInput('3214.5'), 321_450);
  assert.equal(parseMoneyInput('0.01'), 1);
});

test('parseMoneyInput accepts currency symbols, separators and whitespace', () => {
  assert.equal(parseMoneyInput('£3214.58'), 321_458);
  assert.equal(parseMoneyInput('3,214.58'), 321_458);
  assert.equal(parseMoneyInput('£3,214.58'), 321_458);
  assert.equal(parseMoneyInput('  £3,214.58  '), 321_458);
  assert.equal(parseMoneyInput('1,234,567'), 123_456_700);
  assert.equal(parseMoneyInput('3 214.58'), 321_458);
  assert.equal(parseMoneyInput('\u00A03,214.58'), 321_458, 'non-breaking space');
});

test('parseMoneyInput accepts numbers without floating point drift', () => {
  // 1234.56 * 100 is 123455.99999999999 in binary floating point.
  assert.equal(parseMoneyInput(1234.56), 123_456);
  assert.equal(parseMoneyInput(0.07), 7);
  assert.equal(parseMoneyInput(29.29), 2929);
  assert.equal(parseMoneyInput(0), 0);
});

test('parseMoneyInput rounds half-up beyond two decimal places', () => {
  assert.equal(parseMoneyInput('1.005'), 101);
  assert.equal(parseMoneyInput('1.004'), 100);
  assert.equal(parseMoneyInput('1.999'), 200, 'rounds up into the next pound');
  assert.equal(parseMoneyInput('0.999'), 100);
  assert.equal(parseMoneyInput('1.0049999'), 100);
});

test('parseMoneyInput rejects anything that is not a non-negative amount', () => {
  for (const bad of [
    '',
    '   ',
    'abc',
    '£',
    '-1',
    '-£1.00',
    '1.2.3',
    '1,23',
    '12,3456',
    '1e5',
    '£1£',
    '£ 1 £',
    '1 234 pounds',
    '+1',
    '.5',
    null,
    undefined,
    NaN,
    Infinity,
    {},
    [],
    true,
  ]) {
    assert.equal(parseMoneyInput(bad), null, `expected ${JSON.stringify(bad)} to be rejected`);
  }
});

test('parseMoneyInput rejects amounts beyond safe integer pence', () => {
  assert.equal(parseMoneyInput('999999999999999999999'), null);
});

test('poundsToPence throws where parseMoneyInput returns null', () => {
  assert.equal(poundsToPence('£1,000'), 100_000);
  assert.throws(() => poundsToPence('nope'), TypeError);
  assert.throws(() => poundsToPence('-1'), TypeError);
});

test('penceToPounds converts back', () => {
  assert.equal(penceToPounds(321_458), 3214.58);
  assert.equal(penceToPounds(0), 0);
  assert.throws(() => penceToPounds(1.5), TypeError);
});

test('formatGBP renders sterling with grouping', () => {
  assert.equal(formatGBP(321_458), '£3,214.58');
  assert.equal(formatGBP(0), '£0.00');
  assert.equal(formatGBP(100), '£1.00');
  assert.equal(formatGBP(123_456_700), '£1,234,567.00');
  assert.equal(formatGBP(321_458, { decimals: 0 }), '£3,215');
  assert.equal(formatGBP(-321_458), '-£3,214.58');
});

test('formatGBP round-trips through parseMoneyInput', () => {
  for (const pence of [0, 1, 99, 100, 321_458, 4_366_200, 12_514_000]) {
    assert.equal(parseMoneyInput(formatGBP(pence)), pence);
  }
});

test('formatPercent renders rates', () => {
  assert.equal(formatPercent(0.42), '42%');
  assert.equal(formatPercent(0.695), '69.5%');
  assert.equal(formatPercent(0), '0%');
  assert.equal(formatPercent(0.1234, { decimals: 2 }), '12.34%');
  assert.throws(() => formatPercent(NaN), TypeError);
});

test('assertPence guards non-integer values', () => {
  assert.doesNotThrow(() => assertPence(0));
  assert.doesNotThrow(() => assertPence(-5));
  assert.throws(() => assertPence(1.5), TypeError);
  assert.throws(() => assertPence('100'), TypeError);
  assert.throws(() => assertPence(NaN), TypeError);
});

test('PENCE_PER_POUND is the only magic number', () => {
  assert.equal(PENCE_PER_POUND, 100);
});
