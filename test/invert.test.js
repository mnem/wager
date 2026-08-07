import { test } from 'node:test';
import assert from 'node:assert/strict';

import { grossFromAnnualNet, grossFromMonthlyNet } from '../src/lib/invert.js';
import { computeAnnual } from '../src/lib/calculator.js';
import { getTaxYear } from '../src/lib/tax-years.js';

const YEAR = getTaxYear('2026-27');
const p = (pounds) => Math.round(pounds * 100);
const netAt = (grossPence) => computeAnnual(grossPence, YEAR).netPence;

test('below the personal allowance, gross equals net', () => {
  for (const net of [0, 1, 100, 5_000_00, 12_570_00]) {
    const result = grossFromAnnualNet(net, YEAR);
    assert.equal(result.grossPence, net, `net ${net} should need no more gross`);
    assert.ok(result.exact);
    assert.equal(result.overshootPence, 0);
  }
});

test('inverts the known salaries', () => {
  // The same figures the calculator tests assert in the forward direction.
  //
  // The answer can land a penny or two below the round salary, because the
  // contract asks for the SMALLEST gross that nets at least the target and
  // there are plateaus where consecutive gross figures net the same amount.
  // At £120,000 exactly, £119,999.99 nets the identical £71,357.35, so that
  // is the correct answer.
  const cases = [
    { gross: 30_000, net: 25_154.53 },
    { gross: 60_000, net: 43_607.35 },
    { gross: 120_000, net: 71_357.35 },
  ];

  for (const { gross, net } of cases) {
    const result = grossFromAnnualNet(p(net), YEAR);
    assert.ok(result.exact, `net £${net} should be hit exactly`);
    assert.equal(result.netPence, p(net));
    assert.ok(
      p(gross) - result.grossPence >= 0 && p(gross) - result.grossPence <= 2,
      `net £${net} should come from about £${gross}, got ${result.grossPence}`,
    );
    assert.ok(netAt(result.grossPence - 1) < p(net), 'and it should be the smallest such gross');
  }
});

test('plateaus mean the smallest sufficient gross can sit just under a round salary', () => {
  // Documented rather than worked around: deductions are rounded to the penny,
  // so net pay is a step function and several gross figures can share a net.
  // The UI should present a sensibly rounded salary rather than £119,999.99.
  assert.equal(netAt(p(119_999.99)), netAt(p(120_000)), 'a genuine plateau');

  const result = grossFromAnnualNet(netAt(p(120_000)), YEAR);
  assert.equal(result.grossPence, p(119_999.99));
  assert.ok(result.exact);
});

test('the answer is always sufficient and minimal', () => {
  // The contract in one assertion pair: the result nets at least the target,
  // and one penny less does not. Minimality is the half that actually pins the
  // behaviour down — without it, "return a huge number" would pass.
  const targets = [
    0, 1, 999, p(10_000), p(12_570), p(20_000), p(25_154.53), p(30_000),
    p(43_607.35), p(50_000), p(71_357.35), p(80_000), p(100_000), p(250_000),
  ];

  for (const target of targets) {
    const { grossPence } = grossFromAnnualNet(target, YEAR);
    assert.ok(netAt(grossPence) >= target, `${grossPence} should net at least ${target}`);
    if (grossPence > 0) {
      assert.ok(netAt(grossPence - 1) < target, `${grossPence} should be the smallest such gross`);
    }
  }
});

test('handles targets that straddle every band boundary', () => {
  const boundaries = [12_570, 16_537, 29_526, 43_662, 50_270, 75_000, 100_000, 125_140];

  for (const boundary of boundaries) {
    for (const offset of [-200, -1, 0, 1, 200]) {
      const gross = p(boundary) + offset;
      const target = netAt(gross);
      const { grossPence } = grossFromAnnualNet(target, YEAR);

      assert.ok(netAt(grossPence) >= target, `gross ${gross}: result must be sufficient`);
      assert.ok(grossPence <= gross, `gross ${gross}: result must not exceed a known-good gross`);
      assert.ok(netAt(grossPence - 1) < target, `gross ${gross}: result must be minimal`);
    }
  }
});

test('survives the allowance taper, where the marginal rate is worst', () => {
  // Between £100,000 and £125,140 the marginal deduction is 69.5%, so a large
  // gross increase buys a small net increase. This is where a naive bracket or
  // a bad monotonicity assumption would break.
  for (const gross of [p(100_000), p(105_000), p(110_000), p(120_000), p(125_140)]) {
    const target = netAt(gross);
    const { grossPence } = grossFromAnnualNet(target, YEAR);
    assert.ok(netAt(grossPence) >= target);
    assert.ok(netAt(grossPence - 1) < target);
  }
});

test('brackets very large targets without running away', () => {
  const result = grossFromAnnualNet(p(500_000), YEAR);
  assert.ok(result.grossPence > p(500_000));
  assert.ok(netAt(result.grossPence) >= p(500_000));
  assert.ok(netAt(result.grossPence - 1) < p(500_000));
  assert.ok(result.iterations < 80, 'bisection should converge in well under eighty steps');
});

test('overshoot is never more than a penny', () => {
  // A plateau in the net function means the exact target may be unreachable.
  // When that happens the answer should land just above it, never far above.
  for (let gross = p(10_000); gross <= p(200_000); gross += 7_919) {
    const target = netAt(gross);
    const result = grossFromAnnualNet(target, YEAR);
    assert.ok(
      result.overshootPence >= 0 && result.overshootPence <= 1,
      `overshoot of ${result.overshootPence}p at target ${target}`,
    );
  }
});

test('the monthly entry point is twelve times the annual one', () => {
  for (const monthly of [p(1_000), p(2_096.21), p(3_000), p(5_000)]) {
    assert.deepEqual(
      grossFromMonthlyNet(monthly, YEAR).grossPence,
      grossFromAnnualNet(monthly * 12, YEAR).grossPence,
    );
  }
});

test('a realistic monthly take-home gives a sensible salary', () => {
  // £2,096.21 a month is the take-home on £30,000, from the calculator tests.
  //
  // Twelve times a rounded monthly figure is not quite the annual net — here it
  // is a penny short — so the smallest sufficient gross comes out just under
  // £30,000. That is inherent to asking the question in monthly terms, and is
  // why the UI rounds the headline salary.
  const result = grossFromMonthlyNet(p(2_096.21), YEAR);

  assert.ok(
    p(30_000) - result.grossPence >= 0 && p(30_000) - result.grossPence <= 2,
    `expected about £30,000, got ${result.grossPence}`,
  );
  assert.equal(result.monthly.netPence, p(2_096.21), 'the monthly net still comes back as asked');
  assert.equal(result.monthly.grossPence, p(2_500));
});

test('results carry a full breakdown for both periods', () => {
  const result = grossFromAnnualNet(p(43_607.35), YEAR);

  assert.equal(result.annual.periodsPerYear, 1);
  assert.equal(result.monthly.periodsPerYear, 12);
  assert.equal(result.annual.grossPence, result.grossPence);
  assert.equal(result.annual.taxYearId, '2026-27');

  // Both tables must add up.
  for (const period of [result.annual, result.monthly]) {
    const sum = (rows) => rows.reduce((total, row) => total + row.taxPence, 0);
    assert.equal(sum(period.incomeTax.rows), period.incomeTax.totalPence);
    assert.equal(sum(period.nationalInsurance.rows), period.nationalInsurance.totalPence);
    assert.equal(period.grossPence - period.totalDeductionsPence, period.netPence);
  }
});

test('rejects impossible input', () => {
  assert.throws(() => grossFromAnnualNet(-1, YEAR), RangeError);
  assert.throws(() => grossFromAnnualNet(1.5, YEAR), TypeError);
  assert.throws(() => grossFromAnnualNet('30000', YEAR), TypeError);
  assert.throws(() => grossFromMonthlyNet(-1, YEAR), RangeError);
});

test('finds answers right up to the ceiling', () => {
  // Review found that doubling the bracket could overshoot MAX_GROSS_PENCE and
  // give up, rejecting targets that genuinely have an answer just below it.
  // Every target from just over half the ceiling's output up to its exact
  // maximum used to throw RangeError.
  const CEILING = 100_000_000_00;
  const highestReachable = netAt(CEILING);

  for (const target of [
    highestReachable - 1_035_505,
    highestReachable - 1_035_504,
    highestReachable - 500_000,
    highestReachable - 1,
    highestReachable,
  ]) {
    const { grossPence } = grossFromAnnualNet(target, YEAR);
    assert.ok(netAt(grossPence) >= target, `${target} must be reachable`);
    assert.ok(netAt(grossPence - 1) < target, `${target} must get the minimal gross`);
    assert.ok(grossPence <= CEILING, 'and must not exceed the ceiling');
  }
});

test('rejects unreachable targets clearly, never with an overflow', () => {
  // The other half of the same review finding: the ceiling was only enforced on
  // the upper bound, so a large target reached the calculator first, lost
  // precision past Number.MAX_SAFE_INTEGER, and surfaced as a TypeError from
  // inside roundHalfUp — the exact confusing failure the ceiling exists to
  // prevent.
  const highestReachable = netAt(100_000_000_00);

  for (const target of [highestReachable + 1, 20_000_000_000_00, 900_000_000_000_00]) {
    assert.throws(
      () => grossFromAnnualNet(target, YEAR),
      (error) => {
        assert.ok(error instanceof RangeError, `expected RangeError, got ${error.constructor.name}`);
        assert.match(error.message, /the most it can produce is/);
        return true;
      },
      `target ${target} should be rejected cleanly`,
    );
  }
});

test('gives up rather than looping forever on an impossible tax year', () => {
  // A config that deducted everything at the margin would have no answer. The
  // bracket loop must terminate rather than spin or overflow.
  const confiscatory = structuredClone(YEAR);
  confiscatory.personalAllowance.amountPence = 0;
  confiscatory.incomeTax.bands = [
    { id: 'all', label: 'All', rateBasisPoints: 10_000, upToPence: Infinity },
  ];

  assert.throws(() => grossFromAnnualNet(p(1_000), confiscatory), RangeError);
});
