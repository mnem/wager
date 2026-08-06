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

import { assertPence, ceilToPound } from './money.js';
import { getTaxYear } from './tax-years.js';
import { computeAnnual, toMonthly } from './calculator.js';

const MONTHS_PER_YEAR = 12;

/**
 * Hard ceiling on the gross salary the search will consider: £100,000,000.
 *
 * This is not just a sanity limit, it is what keeps the arithmetic exact. The
 * calculator multiplies pence by basis points, so a gross of £100m produces a
 * combined charge around 5.0e13 basis-point units — about 180x inside
 * Number.MAX_SAFE_INTEGER (9.0e15), so there is room for a future year to add
 * bands or raise rates. Letting the bracket double freely would overflow that
 * and fail with a confusing type error from deep inside the calculator instead
 * of a clear one from here.
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

  // Establish what the ceiling can deliver before doing anything else.
  //
  // This has to come first. The obvious lower bound below is the target itself,
  // so an absurd target would be handed straight to the calculator, where
  // multiplying pence by basis points silently loses precision past
  // Number.MAX_SAFE_INTEGER and surfaces as a confusing TypeError from inside
  // roundHalfUp. Checking the ceiling up front means every later calculation is
  // provably in range, because gross never needs to exceed the ceiling.
  const highestReachableNetPence = netAt(MAX_GROSS_PENCE);
  if (targetNetPence > highestReachableNetPence) {
    throw new RangeError(
      `No gross salary up to £${(MAX_GROSS_PENCE / 100).toLocaleString('en-GB')} takes home ` +
        `£${(targetNetPence / 100).toLocaleString('en-GB')} a year — the most it can produce is ` +
        `£${(highestReachableNetPence / 100).toLocaleString('en-GB')}.`,
    );
  }

  // Gross can never be below net, so the target is a valid lower bound.
  let low = targetNetPence;
  if (netAt(low) >= targetNetPence) {
    return describe(low, targetNetPence, 0, year);
  }

  // Grow an upper bound until it is sufficient, clamping to the ceiling rather
  // than giving up when doubling overshoots it. Doubling from just under half
  // the ceiling lands just over it, and the answer for those targets lies
  // between the two — bailing out there rejected salaries that genuinely exist.
  //
  // The check above guarantees the ceiling itself is sufficient, so stopping at
  // it always leaves net(high) >= target, and the loop always terminates.
  let high = Math.min(Math.max(low * 2, 100_00), MAX_GROSS_PENCE);
  while (high < MAX_GROSS_PENCE && netAt(high) < targetNetPence) {
    high = Math.min(high * 2, MAX_GROSS_PENCE);
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
 * @typedef {object} SalarySuggestion
 * @property {number} grossPence the salary to quote — a whole number of pounds
 * @property {number} targetMonthlyNetPence the monthly net that was asked for
 * @property {number} surplusPence how much more than the target this nets each month
 * @property {import('./calculator.js').Breakdown} annual
 * @property {import('./calculator.js').Breakdown} monthly
 */

/**
 * How far the whole-pound search may walk from its starting point, in pounds.
 *
 * Twelve times a monthly figure differs from the true annual net by at most a
 * few pence of rounding, so the starting estimate is never more than a pound or
 * two out. Ten is generous; the bound exists so a future change can never turn
 * this into an unbounded scan.
 */
const MAX_POUND_WALK = 10;

/**
 * Turn a monthly take-home target into a salary figure fit to quote at someone.
 *
 * ## Why this targets the monthly figure directly
 *
 * The obvious implementation — multiply by twelve and invert the annual net —
 * is subtly wrong, and visibly so. A monthly figure is rounded to the penny, so
 * twelve of them need not equal the annual net: £60,000 takes home £3,633.95 a
 * month, but twelve of those is £43,607.40, five pence more than the £43,607.35
 * that salary actually pays. Asking for £3,633.95 a month would then demand
 * more gross and answer "£60,001" — which is wrong in the way that matters,
 * because the person asking may well know that £60,000 pays exactly that.
 *
 * So the target is the monthly figure itself.
 *
 * ## Why the search works in whole pounds
 *
 * Monthly net is not monotonic in gross. It is the difference of two separately
 * rounded figures — monthly gross minus monthly deductions — so it wobbles. At
 * £45,000 the monthly net is £2,960.30, dips to £2,960.29 for the next five
 * pence of gross, then recovers. Bisecting on it, or walking down a penny at a
 * time, stops at the first dip and overshoots the answer by a pound.
 *
 * Searching in whole pounds sidesteps this entirely, and is the right
 * granularity anyway: the answer is a salary to quote at someone, and nobody
 * negotiates £119,999.99. A pound of gross moves the monthly net by several
 * pence, comfortably more than the one-penny wobble, so at this granularity the
 * function is well behaved.
 *
 * Bisection on the annual net — which *is* monotonic — gets within a pound or
 * two cheaply, then a short bounded walk settles it. The result is the smallest
 * whole-pound salary that takes home at least the requested amount each month.
 *
 * @param {number} monthlyNetPence
 * @param {object} [year]
 * @returns {SalarySuggestion}
 */
export function salaryForMonthlyNet(monthlyNetPence, year = getTaxYear()) {
  assertPence(monthlyNetPence);
  if (monthlyNetPence < 0) {
    throw new RangeError(`Net pay cannot be negative, got ${monthlyNetPence}`);
  }

  const monthlyNetAt = (grossPence) => toMonthly(computeAnnual(grossPence, year)).netPence;
  const POUND = 100;

  let grossPence = ceilToPound(grossFromMonthlyNet(monthlyNetPence, year).grossPence);
  const startedAt = grossPence;

  // Make sure it really is sufficient in monthly terms...
  while (
    monthlyNetAt(grossPence) < monthlyNetPence &&
    grossPence - startedAt < MAX_POUND_WALK * POUND
  ) {
    grossPence += POUND;
  }

  // ...then give back every pound that turns out not to be needed.
  while (
    grossPence >= POUND &&
    startedAt - grossPence < MAX_POUND_WALK * POUND &&
    monthlyNetAt(grossPence - POUND) >= monthlyNetPence
  ) {
    grossPence -= POUND;
  }

  const annual = computeAnnual(grossPence, year);
  const monthly = toMonthly(annual);

  return {
    grossPence,
    targetMonthlyNetPence: monthlyNetPence,
    surplusPence: monthly.netPence - monthlyNetPence,
    annual,
    monthly,
  };
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
