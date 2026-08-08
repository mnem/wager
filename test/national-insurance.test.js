import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  withoutNationalInsurance,
  chargesNationalInsurance,
} from '../src/lib/national-insurance.js';
import { getTaxYear, listJurisdictions } from '../src/lib/tax-years.js';
import { computeAnnual, toMonthly, marginalRateAt } from '../src/lib/calculator.js';
import { salaryForMonthlyNet, grossFromAnnualNet } from '../src/lib/invert.js';
import { validateTaxYear } from '../src/lib/validate.js';
import { toEditable, fromEditable } from '../src/lib/editable.js';

const p = (pounds) => Math.round(pounds * 100);

const YEAR = getTaxYear('2026-27', 'scotland');
const NO_NI = withoutNationalInsurance(YEAR);

/** Salaries either side of every threshold that matters to National Insurance. */
const SALARIES = [
  p(0),
  p(10_000),
  p(12_570),
  p(12_571),
  p(30_000),
  p(50_270),
  p(50_271),
  p(75_000),
  p(110_000),
  p(125_140),
  p(200_000),
];

test('a year without National Insurance is an ordinary, valid config', () => {
  // The whole design rests on this: nothing downstream needs to know about the
  // switch, because what it produces is a config like any other. Proved
  // exhaustively for every jurisdiction, exactly as the shipped ones are.
  for (const { id } of listJurisdictions('2026-27')) {
    assert.deepEqual(
      validateTaxYear(withoutNationalInsurance(getTaxYear('2026-27', id)), {
        monotonicity: 'exhaustive',
      }),
      [],
      `${id} without National Insurance should be valid`,
    );
  }
});

test('no National Insurance is charged, at any salary', () => {
  for (const gross of SALARIES) {
    const breakdown = computeAnnual(gross, NO_NI);
    assert.equal(breakdown.nationalInsurance.totalPence, 0, `at ${gross}`);
    assert.equal(breakdown.nationalInsurance.charged, false, `at ${gross}`);
    assert.ok(
      breakdown.nationalInsurance.rows.every((row) => row.taxPence === 0),
      `at ${gross} every National Insurance row should be zero`,
    );
  }
});

test('income tax is untouched — only National Insurance goes', () => {
  // The claim the feature makes to the reader: turn this off and your income
  // tax is exactly what it was. Asserted band by band, not just on the total,
  // so a change that quietly reallocated pennies between bands would fail.
  for (const gross of SALARIES) {
    const withNI = computeAnnual(gross, YEAR);
    const without = computeAnnual(gross, NO_NI);

    assert.deepEqual(without.incomeTax.rows, withNI.incomeTax.rows, `bands at ${gross}`);
    assert.equal(without.incomeTax.totalPence, withNI.incomeTax.totalPence, `tax at ${gross}`);
    assert.deepEqual(
      without.personalAllowance,
      withNI.personalAllowance,
      `allowance at ${gross}`,
    );

    // And with nothing else deducted, take-home pay is gross minus income tax.
    assert.equal(without.totalDeductionsPence, without.incomeTax.totalPence, `total at ${gross}`);
    assert.equal(without.netPence, gross - without.incomeTax.totalPence, `net at ${gross}`);
  }
});

test('take-home pay is higher by exactly the National Insurance that was charged', () => {
  for (const gross of SALARIES) {
    const withNI = computeAnnual(gross, YEAR);
    const without = computeAnnual(gross, NO_NI);
    assert.equal(
      without.netPence - withNI.netPence,
      withNI.nationalInsurance.totalPence,
      `at ${gross}`,
    );
  }
});

test('the marginal rate drops by the National Insurance rate that applied', () => {
  // £30,000 is in the 8% main rate, £75,000 is above the upper earnings limit
  // at 2%, and £110,000 is inside the allowance taper — where the tax side is
  // scaled and the National Insurance side is not, so a naive implementation
  // that subtracted the wrong thing would show up here.
  const cases = [
    { gross: p(30_000), niRate: 0.08 },
    { gross: p(75_000), niRate: 0.02 },
    { gross: p(110_000), niRate: 0.02 },
    { gross: p(10_000), niRate: 0 },
  ];

  for (const { gross, niRate } of cases) {
    const dropped = marginalRateAt(gross, YEAR) - marginalRateAt(gross, NO_NI);
    assert.ok(
      Math.abs(dropped - niRate) < 1e-9,
      `at ${gross} expected the marginal rate to fall by ${niRate}, it fell by ${dropped}`,
    );
  }
});

test('the monthly breakdown carries the switch through', () => {
  const monthly = toMonthly(computeAnnual(p(60_000), NO_NI));
  assert.equal(monthly.nationalInsurance.charged, false);
  assert.equal(monthly.nationalInsurance.totalPence, 0);
  assert.equal(monthly.netPence, monthly.grossPence - monthly.incomeTax.totalPence);
});

test('the inversion still answers, and answers with a lower salary', () => {
  // The question the app exists to answer, asked of the new config. A given
  // take-home target needs less gross when National Insurance is not charged.
  for (const monthlyNet of [p(1_000), p(2_500), p(4_000), p(8_000)]) {
    const without = salaryForMonthlyNet(monthlyNet, NO_NI);
    const withNI = salaryForMonthlyNet(monthlyNet, YEAR);

    assert.ok(without.monthly.netPence >= monthlyNet, `sufficient at ${monthlyNet}`);
    assert.equal(without.grossPence % 100, 0, `whole pounds at ${monthlyNet}`);
    assert.ok(
      without.grossPence <= withNI.grossPence,
      `${monthlyNet} should need no more gross without National Insurance`,
    );
  }
});

test('the inversion contract still holds: smallest sufficient gross', () => {
  // Minimality, not just sufficiency — the same property test/roundtrip.test.js
  // pins down for the shipped config, re-run against this one.
  const netAt = (gross) => computeAnnual(gross, NO_NI).netPence;

  for (const gross of SALARIES) {
    if (gross === 0) continue;
    const target = netAt(gross);
    const found = grossFromAnnualNet(target, NO_NI).grossPence;

    assert.ok(netAt(found) >= target, `sufficient for ${gross}`);
    assert.ok(netAt(found - 1) < target, `minimal for ${gross}`);
  }
});

test('below the personal allowance, take-home pay is the whole salary', () => {
  // Nothing is deducted at all, so the inversion is the identity. Worth
  // pinning: it is the one case where net equals gross exactly.
  const suggestion = salaryForMonthlyNet(p(800), NO_NI);
  assert.equal(suggestion.annual.totalDeductionsPence, 0);
  assert.equal(suggestion.annual.netPence, suggestion.grossPence);
});

test('the original year is left alone', () => {
  // The page switches back and forth, so the published figures have to survive
  // being transformed. A shared-reference bug here would empty the real bands.
  const before = JSON.stringify(YEAR, (key, value) =>
    value === Infinity ? 'Infinity' : value,
  );
  withoutNationalInsurance(YEAR);
  const after = JSON.stringify(YEAR, (key, value) => (value === Infinity ? 'Infinity' : value));

  assert.equal(after, before);
  assert.equal(chargesNationalInsurance(YEAR), true);
});

test('it composes with hand-edited figures, and is applied after them', () => {
  // Both escape hatches at once. The edit has to survive the switch — and the
  // income tax rate typed in has to be the one actually used.
  const editable = toEditable(YEAR);
  editable.incomeTax[0].rateBasisPoints = 2500;
  const edited = fromEditable(editable, YEAR);
  const editedNoNI = withoutNationalInsurance(edited);

  assert.deepEqual(validateTaxYear(editedNoNI, { monotonicity: 'sampled' }), []);
  assert.equal(editedNoNI.incomeTax.bands[0].rateBasisPoints, 2500);
  assert.equal(editedNoNI.edited, true, 'still says the figures were changed by hand');
  assert.equal(editedNoNI.verifiedOn, null);
  assert.equal(computeAnnual(p(30_000), editedNoNI).nationalInsurance.totalPence, 0);
});

test('everything about the jurisdiction survives', () => {
  // National Insurance is UK-wide, so switching it off says nothing about where
  // someone lives. The page reads all of this back out.
  for (const { id } of listJurisdictions('2026-27')) {
    const year = getTaxYear('2026-27', id);
    const without = withoutNationalInsurance(year);

    assert.equal(without.jurisdictionId, year.jurisdictionId);
    assert.equal(without.jurisdiction, year.jurisdiction);
    assert.equal(without.appliesTo, year.appliesTo);
    assert.equal(without.verifiedOn, year.verifiedOn);
    assert.deepEqual(without.sources, year.sources);
    assert.deepEqual(without.publishedBands, year.publishedBands);
    assert.deepEqual(without.incomeTax, year.incomeTax);
  }
});

test('chargesNationalInsurance treats an absent flag as charged', () => {
  // Every config written before this feature existed, and everything getTaxYear
  // returns, has no flag at all. Reading that as "not charged" would silently
  // stop deducting National Insurance for everyone.
  assert.equal(chargesNationalInsurance(getTaxYear('2026-27', 'scotland')), true);
  assert.equal(chargesNationalInsurance({ nationalInsurance: {} }), true);
  assert.equal(chargesNationalInsurance(NO_NI), false);
});
