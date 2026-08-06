import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeAnnual, toMonthly } from '../src/lib/calculator.js';
import { grossFromAnnualNet, grossFromMonthlyNet } from '../src/lib/invert.js';
import { getTaxYear } from '../src/lib/tax-years.js';

const YEAR = getTaxYear('2026-27');
const p = (pounds) => Math.round(pounds * 100);
const netAt = (grossPence) => computeAnnual(grossPence, YEAR).netPence;

/**
 * The whole contract, asserted at one gross figure.
 *
 * Sufficiency alone is a weak property — returning a huge number satisfies it.
 * Minimality is what actually pins the behaviour down, so both halves matter.
 */
function assertRoundTrip(grossPence, context) {
  const target = netAt(grossPence);
  const { grossPence: recovered } = grossFromAnnualNet(target, YEAR);

  assert.ok(netAt(recovered) >= target, `${context}: ${recovered} must net at least ${target}`);
  assert.ok(recovered <= grossPence, `${context}: ${recovered} must not exceed the known-good ${grossPence}`);
  if (recovered > 0) {
    assert.ok(netAt(recovered - 1) < target, `${context}: ${recovered} must be the smallest sufficient gross`);
  }
}

test('round-trips across the whole realistic salary range', () => {
  // A deliberately awkward step, so the sweep lands on unhelpful values rather
  // than tidy multiples of anything.
  let checked = 0;
  for (let gross = 0; gross <= p(400_000); gross += 13_711) {
    assertRoundTrip(gross, `gross ${gross}`);
    checked += 1;
  }
  assert.ok(checked > 2_000, `expected a broad sweep, only checked ${checked}`);
});

test('round-trips a penny either side of every band boundary', () => {
  // Boundaries are where an off-by-one in the bisection or the band arithmetic
  // would hide.
  const boundaries = [
    0, 12_570, 16_537, 16_538, 29_526, 29_527, 43_662, 43_663,
    50_270, 75_000, 75_001, 100_000, 110_000, 125_140, 125_141,
  ];

  for (const boundary of boundaries) {
    for (const offset of [-2, -1, 0, 1, 2]) {
      const gross = p(boundary) + offset;
      if (gross < 0) continue;
      assertRoundTrip(gross, `£${boundary} ${offset >= 0 ? '+' : ''}${offset}p`);
    }
  }
});

test('round-trips densely through the allowance taper', () => {
  // £100,000 to £125,140 is the hardest region: the marginal deduction is
  // 69.5%, so net pay climbs slowly and plateaus are most common.
  for (let gross = p(99_990); gross <= p(125_150); gross += 997) {
    assertRoundTrip(gross, `taper at ${gross}`);
  }
});

test('the monthly round trip returns the requested take-home pay', () => {
  // What a user actually does: type a monthly net, get a salary. Whatever
  // salary comes back must produce the monthly figure they asked for.
  for (let monthlyNet = p(500); monthlyNet <= p(12_000); monthlyNet += 1_237) {
    const result = grossFromMonthlyNet(monthlyNet, YEAR);
    const monthly = toMonthly(computeAnnual(result.grossPence, YEAR));

    assert.ok(
      monthly.netPence >= monthlyNet,
      `asked for ${monthlyNet} a month, got ${monthly.netPence}`,
    );
    assert.ok(
      monthly.netPence - monthlyNet <= 1,
      `asked for ${monthlyNet} a month, overshot to ${monthly.netPence}`,
    );
  }
});

test('net pay is non-decreasing across every band boundary, penny by penny', () => {
  // The property the whole inversion rests on. If this ever fails, bisection
  // stops being valid and the round trips above become meaningless.
  const boundaries = [0, 12_570, 16_537, 29_526, 43_662, 50_270, 75_000, 100_000, 125_140];

  for (const boundary of boundaries) {
    let previous = -1;
    for (let offset = -500; offset <= 500; offset += 1) {
      const gross = p(boundary) + offset;
      if (gross < 0) continue;
      const net = netAt(gross);
      assert.ok(net >= previous, `net fell from ${previous} to ${net} at gross ${gross}`);
      previous = net;
    }
  }
});

test('every gross in the sweep produces a self-consistent breakdown', () => {
  const sum = (rows) => rows.reduce((total, row) => total + row.taxPence, 0);

  for (let gross = 0; gross <= p(300_000); gross += 31_337) {
    const annual = computeAnnual(gross, YEAR);
    const monthly = toMonthly(annual);

    for (const [name, period] of [['annual', annual], ['monthly', monthly]]) {
      assert.equal(sum(period.incomeTax.rows), period.incomeTax.totalPence, `${name} tax rows at ${gross}`);
      assert.equal(
        sum(period.nationalInsurance.rows),
        period.nationalInsurance.totalPence,
        `${name} NI rows at ${gross}`,
      );
      assert.equal(
        period.incomeTax.totalPence + period.nationalInsurance.totalPence,
        period.totalDeductionsPence,
        `${name} deductions at ${gross}`,
      );
      assert.equal(
        period.grossPence - period.totalDeductionsPence,
        period.netPence,
        `${name} net at ${gross}`,
      );
    }

    // Twelve monthly figures must still be recognisably the annual figure.
    assert.ok(
      Math.abs(monthly.netPence * 12 - annual.netPence) <= 12,
      `monthly net at ${gross} drifts too far from the annual net`,
    );
  }
});
