/**
 * Net to gross — the question this app exists to answer.
 *
 * ## The contract
 *
 * `grossFromAnnualNet(target)` returns **the smallest integer gross whose net is
 * at least the target**.
 *
 * That wording is deliberate. Net pay is a non-decreasing step function of gross
 * pay, not a strictly increasing one: because deductions are rounded to the
 * penny, there are short plateaus where one more penny of gross buys no extra
 * take-home pay at all. So a given net figure can correspond to several gross
 * figures, or to none exactly. Picking the smallest sufficient gross makes the
 * answer unique and never leaves someone short of what they asked for.
 *
 * ## Why bisection
 *
 * `computeAnnual` guarantees net pay never falls as gross rises (see the
 * rounding note in calculator.js), so binary search is valid. It is about
 * forty iterations, needs no algebra, and — unlike inverting each band by hand
 * — stays correct if the tax year config gains a band, changes a taper rule, or
 * adds a whole new deduction.
 */

import { assertPence } from './money.js';
import { getTaxYear } from './tax-years.js';
import { computeAnnual, toMonthly } from './calculator.js';

const MONTHS_PER_YEAR = 12;

/**
 * Hard ceiling on the gross salary the search will consider: £100,000,000.
 *
 * This is not just a sanity limit, it is what keeps the arithmetic exact. The
 * calculator multiplies pence by basis points, so a gross of £100m produces
 * charges around 4.8e14 — still comfortably inside Number.MAX_SAFE_INTEGER.
 * Letting the bracket double freely would overflow that and fail with a
 * confusing type error from deep inside the calculator instead of a clear one
 * from here.
 */
const MAX_GROSS_PENCE = 100_000_000_00;

/**
 * @typedef {object} InversionResult
 * @property {number} grossPence the smallest gross that nets at least the target
 * @property {number} netPence what that gross actually nets
 * @property {number} targetNetPence what was asked for
 * @property {number} overshootPence netPence - targetNetPence, usually 0
 * @property {boolean} exact whether the target was hit precisely
 * @property {number} iterations bisection steps taken, for diagnostics
 * @property {import('./calculator.js').Breakdown} annual
 * @property {import('./calculator.js').Breakdown} monthly
 */

/**
 * Find the smallest gross annual salary whose net is at least the target.
 *
 * @param {number} targetNetPence
 * @param {object} [year] tax year config; defaults to the current year
 * @returns {InversionResult}
 */
export function grossFromAnnualNet(targetNetPence, year = getTaxYear()) {
  assertPence(targetNetPence);
  if (targetNetPence < 0) {
    throw new RangeError(`Net pay cannot be negative, got ${targetNetPence}`);
  }

  const netAt = (grossPence) => computeAnnual(grossPence, year).netPence;

  // Gross can never be below net, so the target is a valid lower bound.
  let low = targetNetPence;
  if (netAt(low) >= targetNetPence) {
    return describe(low, targetNetPence, 0, year);
  }

  // Grow an upper bound until it is definitely sufficient. The ceiling is
  // checked before each calculation, not after, so an unreachable target fails
  // here with a clear message rather than overflowing inside the calculator.
  let high = Math.max(low * 2, 100_00);
  for (;;) {
    if (high > MAX_GROSS_PENCE) {
      throw new RangeError(
        `No gross salary up to £${MAX_GROSS_PENCE / 100} nets ${targetNetPence}p. ` +
          'Either the figure is beyond what this calculator handles, or the tax year config deducts everything at the margin.',
      );
    }
    if (netAt(high) >= targetNetPence) break;
    high *= 2;
  }

  // Invariant: netAt(low) < target <= netAt(high). Narrow until they touch.
  let iterations = 0;
  while (high - low > 1) {
    const middle = low + Math.floor((high - low) / 2);
    if (netAt(middle) >= targetNetPence) {
      high = middle;
    } else {
      low = middle;
    }
    iterations += 1;
  }

  return describe(high, targetNetPence, iterations, year);
}

/**
 * Find the smallest gross annual salary whose net is at least twelve times the
 * target monthly figure.
 *
 * @param {number} monthlyNetPence
 * @param {object} [year]
 * @returns {InversionResult}
 */
export function grossFromMonthlyNet(monthlyNetPence, year = getTaxYear()) {
  assertPence(monthlyNetPence);
  return grossFromAnnualNet(monthlyNetPence * MONTHS_PER_YEAR, year);
}

/**
 * Build the full result for a gross figure already known to be the answer.
 *
 * @param {number} grossPence
 * @param {number} targetNetPence
 * @param {number} iterations
 * @param {object} year
 * @returns {InversionResult}
 */
function describe(grossPence, targetNetPence, iterations, year) {
  const annual = computeAnnual(grossPence, year);
  return {
    grossPence,
    netPence: annual.netPence,
    targetNetPence,
    overshootPence: annual.netPence - targetNetPence,
    exact: annual.netPence === targetNetPence,
    iterations,
    annual,
    monthly: toMonthly(annual),
  };
}
