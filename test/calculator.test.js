import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  personalAllowanceFor,
  applyBands,
  computeAnnual,
  marginalRateAt,
  toMonthly,
} from '../src/lib/calculator.js';
import { getTaxYear } from '../src/lib/tax-years.js';

const YEAR = getTaxYear('2026-27');

/** Pounds to pence, for writing test expectations in readable money. */
const p = (pounds) => Math.round(pounds * 100);

test('personal allowance is untouched below the taper threshold', () => {
  for (const gross of [0, 12_570, 50_000, 99_999, 100_000]) {
    const allowance = personalAllowanceFor(p(gross), YEAR);
    assert.equal(allowance.allowancePence, p(12_570), `at £${gross}`);
    assert.equal(allowance.taperedAwayPence, 0);
  }
});

test('personal allowance tapers by £1 for every £2 above the threshold', () => {
  assert.equal(personalAllowanceFor(p(100_002), YEAR).allowancePence, p(12_569));
  assert.equal(personalAllowanceFor(p(110_000), YEAR).allowancePence, p(7_570));
  assert.equal(personalAllowanceFor(p(120_000), YEAR).allowancePence, p(2_570));
});

test('personal allowance reaches zero at £125,140 and never goes negative', () => {
  assert.equal(personalAllowanceFor(p(125_140), YEAR).allowancePence, 0);
  assert.equal(personalAllowanceFor(p(125_140), YEAR).taperedAwayPence, p(12_570));
  assert.equal(personalAllowanceFor(p(200_000), YEAR).allowancePence, 0);
  assert.equal(personalAllowanceFor(p(1_000_000), YEAR).taperedAwayPence, p(12_570));
});

test('applyBands spreads an amount across cumulative bands', () => {
  const bands = [
    { id: 'a', label: 'A', rateBasisPoints: 1000, upToPence: 1000 },
    { id: 'b', label: 'B', rateBasisPoints: 5000, upToPence: 3000 },
    { id: 'c', label: 'C', rateBasisPoints: 2500, upToPence: Infinity },
  ];

  assert.deepEqual(applyBands(0, bands).rows.map((r) => r.amountInBandPence), [0, 0, 0]);
  assert.equal(applyBands(0, bands).chargeBasisPoints, 0);

  assert.deepEqual(applyBands(500, bands).rows.map((r) => r.amountInBandPence), [500, 0, 0]);
  assert.deepEqual(applyBands(2000, bands).rows.map((r) => r.amountInBandPence), [1000, 1000, 0]);
  assert.deepEqual(applyBands(5000, bands).rows.map((r) => r.amountInBandPence), [1000, 2000, 2000]);

  // 1000 * 0.1 + 2000 * 0.5 + 2000 * 0.25, in basis-point units
  assert.equal(applyBands(5000, bands).chargeBasisPoints, (100 + 1000 + 500) * 10_000);
});

test('applyBands charges sum to the exact total', () => {
  for (const amount of [0, 1, 999, 123_456, 5_000_000, 12_514_000, 40_000_000]) {
    for (const bands of [YEAR.incomeTax.bands, YEAR.nationalInsurance.bands]) {
      const { rows, chargeBasisPoints } = applyBands(amount, bands);
      const summed = rows.reduce((total, row) => total + row.chargeBasisPoints, 0);
      assert.equal(summed, chargeBasisPoints, `rows must sum to the total at ${amount}`);
      assert.ok(
        rows.every((row) => Number.isSafeInteger(row.chargeBasisPoints)),
        'charges must stay exact integers',
      );
    }
  }
});

test('a breakdown always adds up', () => {
  for (const gross of [0, 12_571, 30_000, 60_000, 110_000, 125_140, 500_000]) {
    const result = computeAnnual(p(gross), YEAR);
    const sum = (rows) => rows.reduce((total, row) => total + row.taxPence, 0);
    assert.equal(sum(result.incomeTax.rows), result.incomeTax.totalPence, `£${gross} tax rows`);
    assert.equal(sum(result.nationalInsurance.rows), result.nationalInsurance.totalPence, `£${gross} NI rows`);
    assert.equal(
      result.incomeTax.totalPence + result.nationalInsurance.totalPence,
      result.totalDeductionsPence,
      `£${gross} deductions`,
    );
    assert.equal(result.grossPence - result.totalDeductionsPence, result.netPence, `£${gross} net`);
  }
});

test('income tax band boundaries match the published gross figures', () => {
  // At the last pound of each published band, the band above must be empty and
  // the band itself must be full. This is what pins the config's taxable limits
  // to gov.scot's gross table.
  const expectations = [
    { gross: 16_537, full: 'starter', empty: 'basic' },
    { gross: 29_526, full: 'basic', empty: 'intermediate' },
    { gross: 43_662, full: 'intermediate', empty: 'higher' },
    { gross: 75_000, full: 'higher', empty: 'advanced' },
    { gross: 125_140, full: 'advanced', empty: 'top' },
  ];

  for (const { gross, full, empty } of expectations) {
    const rows = computeAnnual(p(gross), YEAR).incomeTax.rows;
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));

    assert.ok(byId[full].amountInBandPence > 0, `£${gross}: ${full} band should be in use`);
    assert.equal(byId[empty].amountInBandPence, 0, `£${gross}: ${empty} band should still be empty`);

    // One pound more must tip exactly £1 into the next band.
    const next = computeAnnual(p(gross) + 100, YEAR).incomeTax.rows.find((row) => row.id === empty);
    assert.equal(next.amountInBandPence, 100, `£${gross + 1}: ${empty} band should hold exactly £1`);
  }
});

test('no income tax below the personal allowance', () => {
  for (const gross of [0, 1, 5_000, 12_569, 12_570]) {
    const result = computeAnnual(p(gross), YEAR);
    assert.equal(result.incomeTax.totalPence, 0, `at £${gross}`);
    assert.equal(result.incomeTax.taxablePence, 0);
  }
  assert.equal(computeAnnual(p(12_571), YEAR).incomeTax.totalPence, 19, '19% of the first £1');
});

test('National Insurance follows the primary threshold and upper earnings limit', () => {
  assert.equal(computeAnnual(p(12_570), YEAR).nationalInsurance.totalPence, 0);
  assert.equal(computeAnnual(p(12_571), YEAR).nationalInsurance.totalPence, 8, '8% of the first £1');

  // Everything between the thresholds at 8%.
  assert.equal(computeAnnual(p(50_270), YEAR).nationalInsurance.totalPence, p(37_700 * 0.08));

  // Above the upper earnings limit, only 2%.
  const above = computeAnnual(p(60_000), YEAR).nationalInsurance;
  assert.equal(above.totalPence, p(37_700 * 0.08) + p(9_730 * 0.02));
});

test('National Insurance ignores the personal allowance taper', () => {
  // NI is charged on gross, so losing the allowance must not change it.
  const at120k = computeAnnual(p(120_000), YEAR);
  assert.equal(at120k.personalAllowance.allowancePence, p(2_570), 'allowance is tapered');
  assert.equal(at120k.nationalInsurance.totalPence, p(37_700 * 0.08) + p(69_730 * 0.02));
});

test('known salaries produce the expected breakdown', () => {
  // Worked through by hand against the published rates. If one of these
  // changes, something in the config or the algorithm has moved.
  const cases = [
    { gross: 30_000, tax: 3_451.07, ni: 1_394.4, net: 25_154.53 },
    { gross: 60_000, tax: 13_182.05, ni: 3_210.6, net: 43_607.35 },
    { gross: 120_000, tax: 44_232.05, ni: 4_410.6, net: 71_357.35 },
  ];

  for (const { gross, tax, ni, net } of cases) {
    const result = computeAnnual(p(gross), YEAR);
    assert.equal(result.incomeTax.totalPence, p(tax), `£${gross} income tax`);
    assert.equal(result.nationalInsurance.totalPence, p(ni), `£${gross} NI`);
    assert.equal(result.netPence, p(net), `£${gross} net`);
    assert.equal(result.grossPence - result.totalDeductionsPence, result.netPence);
  }
});

test('cross-checked against an independent calculator', () => {
  // Figures read off checkmytax.uk's Scotland 2026/27 calculator on 2026-08-05.
  // The first two agree exactly. The last two do not, and the discrepancy is
  // theirs: see the test below, which reproduces their numbers exactly by
  // introducing the £112,570 error.
  const agreed = [
    { gross: 30_000, net: 25_154.53 },
    { gross: 60_000, net: 43_607.35 },
  ];

  for (const { gross, net } of agreed) {
    assert.equal(computeAnnual(p(gross), YEAR).netPence, p(net), `£${gross}`);
  }
});

test('the £112,570 error would change the answer above the taper', () => {
  // Guards the single most dangerous mistake in the config. Setting the
  // advanced-rate limit to £125,140 minus the full personal allowance — rather
  // than £125,140, where the allowance is already zero — starts the 48% top
  // rate about £12,570 of gross too early.
  //
  // These are not invented numbers: they are exactly what an independent
  // calculator produced, which is how the error was identified.
  const withError = structuredClone(YEAR);
  withError.incomeTax.bands.find((band) => band.id === 'advanced').upToPence = p(112_570);

  const cases = [
    { gross: 30_000, correct: 25_154.53, withError: 25_154.53 },
    { gross: 60_000, correct: 43_607.35, withError: 43_607.35 },
    { gross: 120_000, correct: 71_357.35, withError: 71_211.55 },
    { gross: 126_000, correct: 73_355.05, withError: 72_977.95 },
  ];

  for (const testCase of cases) {
    assert.equal(computeAnnual(p(testCase.gross), YEAR).netPence, p(testCase.correct), `£${testCase.gross} correct`);
    assert.equal(
      computeAnnual(p(testCase.gross), withError).netPence,
      p(testCase.withError),
      `£${testCase.gross} with the error`,
    );
  }

  // Below the taper the error is invisible, which is exactly why it survives.
  assert.equal(
    computeAnnual(p(60_000), YEAR).netPence,
    computeAnnual(p(60_000), withError).netPence,
  );
});

test('marginal rate is exact at every band boundary', () => {
  // marginalRateAt(g) is the rate on the NEXT pound after g. So at the last
  // pound of a band it reports the band above, which is where that next pound
  // actually lands. Each case below is phrased as "the pound after £g".
  const cases = [
    { gross: 0, rate: 0, why: 'inside the personal allowance' },
    { gross: 12_569, rate: 0, why: 'the last pound of the allowance' },
    { gross: 12_570, rate: 0.19 + 0.08, why: 'allowance and NI primary threshold coincide exactly' },
    { gross: 16_537, rate: 0.2 + 0.08, why: 'starter band is full, so the next pound is basic rate' },
    { gross: 16_538, rate: 0.2 + 0.08, why: 'well inside basic rate' },
    { gross: 29_526, rate: 0.21 + 0.08, why: 'basic band is full, next pound is intermediate' },
    { gross: 43_662, rate: 0.42 + 0.08, why: 'intermediate band is full, next pound is higher' },
    { gross: 43_663, rate: 0.42 + 0.08, why: 'well inside higher rate' },
    { gross: 50_270, rate: 0.42 + 0.02, why: 'NI drops to 2% above the upper earnings limit' },
    // 45% on £1.50 of taxable income per £1 of gross, plus 2% NI.
    { gross: 110_000, rate: 0.695, why: 'inside the allowance taper' },
    { gross: 125_139, rate: 0.695, why: 'the last pound of the taper' },
    { gross: 125_140, rate: 0.48 + 0.02, why: 'taper finished, next pound is top rate' },
    { gross: 200_000, rate: 0.5, why: 'top rate plus NI' },
  ];

  for (const { gross, rate, why } of cases) {
    assert.equal(
      Number(marginalRateAt(p(gross), YEAR).toFixed(6)),
      rate,
      `£${gross}: ${why}`,
    );
  }
});

test('the allowance taper makes £100k-£125k cost more at the margin than £200k', () => {
  // Counter-intuitive but correct, and worth surfacing in the UI.
  assert.ok(marginalRateAt(p(110_000), YEAR) > marginalRateAt(p(200_000), YEAR));
});

test('net pay never decreases as gross pay rises', () => {
  // The inversion in the next module depends on this. Step through every band
  // boundary a penny at a time.
  const boundaries = [0, 12_570, 16_537, 29_526, 43_662, 50_270, 75_000, 100_000, 125_140];
  for (const boundary of boundaries) {
    let previousNet = -1;
    for (let offset = -200; offset <= 200; offset += 1) {
      const gross = p(boundary) + offset;
      if (gross < 0) continue;
      const { netPence } = computeAnnual(gross, YEAR);
      assert.ok(netPence >= previousNet, `net fell at gross ${gross}`);
      previousNet = netPence;
    }
  }
});

test('computeAnnual rejects impossible input', () => {
  assert.throws(() => computeAnnual(p(-1), YEAR), RangeError);
  assert.throws(() => computeAnnual(1.5, YEAR), TypeError);
  assert.throws(() => computeAnnual('30000', YEAR), TypeError);
});

test('toMonthly divides by twelve and stays internally consistent', () => {
  for (const gross of [0, 12_570, 30_000, 60_000, 110_000, 125_140, 250_000]) {
    const annual = computeAnnual(p(gross), YEAR);
    const monthly = toMonthly(annual);

    assert.equal(monthly.periodsPerYear, 12);
    assert.equal(monthly.grossPence, Math.round(annual.grossPence / 12), `£${gross} gross`);

    // The table must add up, or it looks broken to whoever is reading it.
    const sum = (rows) => rows.reduce((total, row) => total + row.taxPence, 0);
    assert.equal(sum(monthly.incomeTax.rows), monthly.incomeTax.totalPence);
    assert.equal(sum(monthly.nationalInsurance.rows), monthly.nationalInsurance.totalPence);
    assert.equal(
      monthly.incomeTax.totalPence + monthly.nationalInsurance.totalPence,
      monthly.totalDeductionsPence,
    );
    assert.equal(monthly.grossPence - monthly.totalDeductionsPence, monthly.netPence);

    // And it must still be recognisably a twelfth of the annual figure.
    assert.ok(
      Math.abs(monthly.netPence * 12 - annual.netPence) <= 12,
      `£${gross}: monthly net should be within a penny a month of the annual net`,
    );
  }
});

test('rates are unchanged by switching to a monthly view', () => {
  const annual = computeAnnual(p(110_000), YEAR);
  const monthly = toMonthly(annual);
  assert.equal(monthly.marginalRate, annual.marginalRate);
  assert.equal(monthly.effectiveDeductionRate, annual.effectiveDeductionRate);
  assert.equal(monthly.taxYearId, annual.taxYearId);
});

test('effective rate is deductions over gross', () => {
  const result = computeAnnual(p(60_000), YEAR);
  assert.equal(result.effectiveDeductionRate, result.totalDeductionsPence / result.grossPence);
  assert.equal(computeAnnual(0, YEAR).effectiveDeductionRate, 0, 'no division by zero at £0');
});
