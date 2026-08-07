/**
 * Tax year validation.
 *
 * The calculator trusts its config completely. Give it bands out of order, a
 * bounded final band, or a negative rate, and it returns a plausible-looking
 * number rather than an error — which is the worst possible behaviour for a
 * tool people use to decide what salary to ask for.
 *
 * That was tolerable while every config was committed and covered by tests. It
 * stops being tolerable the moment someone can edit the figures in the browser,
 * so these invariants live here rather than in the test file, and the tests and
 * the UI check exactly the same things.
 *
 * ## Two depths of monotonicity check
 *
 * The property the net-to-gross inversion depends on — that one more penny of
 * gross never costs more than one more penny of deductions — can only be
 * *proved* by checking every penny. That takes a couple of seconds, which is
 * right for CI and far too slow for something that runs on every keystroke.
 *
 * So there are two depths, and the difference is deliberate and documented:
 *
 * - `'exhaustive'` sweeps every penny of the taper. A proof. Used by the tests.
 * - `'sampled'` checks a window around every rate change plus a stride through
 *   the taper. A few milliseconds. Used by the UI.
 *
 * A sampled pass is **not a guarantee**, and nothing here should be read as
 * claiming otherwise. It checks the places a violation is most likely — the
 * pennies either side of a rate change — and samples the rest. A config it
 * passes may still be broken somewhere between two samples, so the code that
 * calls it must treat a failure from the inversion itself as possible rather
 * than unreachable.
 */

import { computeAnnual } from './calculator.js';

const BASIS_POINTS_PER_UNIT = 10_000;

/** Pennies either side of a rate change to check. */
const RATE_CHANGE_WINDOW = 300;

/** Stride through the taper when sampling rather than proving. */
const TAPER_SAMPLE_STRIDE = 997;

/**
 * Check one set of cumulative bands.
 *
 * @param {object} scheme the `incomeTax` or `nationalInsurance` object
 * @param {string} name for the problem messages
 * @returns {string[]} problems, empty if the scheme is well formed
 */
function bandProblems(scheme, name) {
  const problems = [];

  if (!scheme || typeof scheme !== 'object') {
    return [`${name} is missing`];
  }
  if (!['taxable', 'gross'].includes(scheme.appliesTo)) {
    problems.push(`${name} must apply to 'taxable' or 'gross' income, got ${JSON.stringify(scheme.appliesTo)}`);
  }
  if (!Array.isArray(scheme.bands) || scheme.bands.length === 0) {
    return [...problems, `${name} needs at least one band`];
  }

  const seen = new Set();
  let previousLimit = 0;

  for (const band of scheme.bands) {
    const label = band?.id ? `${name} band '${band.id}'` : `${name} band`;

    if (typeof band?.label !== 'string' || band.label.trim() === '') {
      // Not a wrong number, but it renders as a blank row in the breakdown,
      // which is the same class of "validates and still misbehaves".
      problems.push(`${label} needs a name, or it shows as a blank row`);
    }

    if (!band?.id) {
      problems.push(`${name} has a band with no id`);
    } else if (seen.has(band.id)) {
      problems.push(`${name} has two bands called '${band.id}'`);
    } else {
      seen.add(band.id);
    }

    if (
      !Number.isSafeInteger(band?.rateBasisPoints) ||
      band.rateBasisPoints < 0 ||
      band.rateBasisPoints >= BASIS_POINTS_PER_UNIT
    ) {
      problems.push(`${label} needs a rate between 0% and 100%, got ${JSON.stringify(band?.rateBasisPoints)}`);
    }

    if (!(band?.upToPence > previousLimit)) {
      problems.push(
        `${label} must end above the band before it — bands are cumulative, so they cannot overlap or leave gaps`,
      );
    } else if (Number.isFinite(band.upToPence) && !Number.isSafeInteger(band.upToPence)) {
      problems.push(`${label} must end on a whole number of pence`);
    }

    previousLimit = band?.upToPence ?? previousLimit;
  }

  if (scheme.bands.at(-1)?.upToPence !== Infinity) {
    problems.push(`the last ${name} band must be unbounded, or income above it would be untaxed`);
  }

  return problems;
}

/**
 * Check the personal allowance and its taper.
 *
 * @param {object} allowance
 * @returns {string[]}
 */
function allowanceProblems(allowance) {
  if (!allowance || typeof allowance !== 'object') return ['the personal allowance is missing'];

  const problems = [];
  if (!Number.isSafeInteger(allowance.amountPence) || allowance.amountPence < 0) {
    problems.push('the personal allowance must be a whole number of pence, and not negative');
  }

  const taper = allowance.taper;
  if (!taper || typeof taper !== 'object') return [...problems, 'the allowance taper is missing'];

  if (!Number.isSafeInteger(taper.thresholdPence) || taper.thresholdPence <= 0) {
    problems.push('the taper threshold must be a positive whole number of pence');
  }
  const { lose, per } = taper.withdraw ?? {};
  if (!Number.isSafeInteger(lose) || lose <= 0 || !Number.isSafeInteger(per) || per <= 0) {
    problems.push('the taper must withdraw a whole number of pounds per whole number of pounds');
  } else if (lose > per) {
    problems.push('the taper cannot withdraw allowance faster than income rises');
  }

  return problems;
}

/**
 * The gross figures where a rate changes, and so where the deduction step is
 * most likely to misbehave.
 *
 * @param {object} year
 * @returns {number[]}
 */
function rateChangePoints(year) {
  const allowance = year.personalAllowance.amountPence;
  const { thresholdPence, withdraw } = year.personalAllowance.taper;
  const taperEndsAt = thresholdPence + (allowance * withdraw.per) / withdraw.lose;

  const points = new Set([0, allowance, thresholdPence, taperEndsAt]);

  for (const scheme of [year.incomeTax, year.nationalInsurance]) {
    for (const band of scheme.bands) {
      if (!Number.isFinite(band.upToPence)) continue;

      // A limit on gross income is already a gross figure. A limit on taxable
      // income is not: the matching gross is the limit plus whatever allowance
      // survives — the full allowance below the taper, and nothing above it.
      // Both are added, since which applies depends where in the taper you are.
      points.add(band.upToPence);
      if (scheme.appliesTo === 'taxable') points.add(band.upToPence + allowance);
    }
  }

  return [...points];
}

/**
 * Check that a penny of gross never costs more than a penny of deductions.
 *
 * @param {object} year
 * @param {'sampled'|'exhaustive'} depth
 * @returns {string[]}
 */
function monotonicityProblems(year, depth) {
  const deductionsAt = (grossPence) => computeAnnual(grossPence, year).totalDeductionsPence;
  const problems = [];

  const report = (from, cost) => {
    problems.push(
      `going from gross ${from} to ${from + 1} costs ${cost}p in deductions, so take-home pay falls as pay rises`,
    );
  };

  for (const point of rateChangePoints(year)) {
    for (let gross = Math.max(0, point - RATE_CHANGE_WINDOW); gross <= point + RATE_CHANGE_WINDOW; gross += 1) {
      const cost = deductionsAt(gross + 1) - deductionsAt(gross);
      if (cost < 0 || cost > 1) {
        report(gross, cost);
        return problems; // One is enough; the caller only needs to know it is broken.
      }
    }
  }

  const { thresholdPence, withdraw } = year.personalAllowance.taper;
  const taperEndsAt =
    thresholdPence + (year.personalAllowance.amountPence * withdraw.per) / withdraw.lose;
  const stride = depth === 'exhaustive' ? 1 : TAPER_SAMPLE_STRIDE;

  let previous = deductionsAt(thresholdPence);
  for (let gross = thresholdPence + stride; gross <= taperEndsAt; gross += stride) {
    const deductions = deductionsAt(gross);
    const cost = deductions - previous;
    // Across a stride the cost may legitimately exceed a penny, so only the
    // exhaustive pass can compare against 1. A sampled pass can still catch a
    // decrease, which is the unambiguous failure.
    if (cost < 0 || (stride === 1 && cost > 1)) {
      report(gross - stride, cost);
      return problems;
    }
    previous = deductions;
  }

  return problems;
}

/**
 * Check a resolved tax year — the flattened shape `getTaxYear` returns.
 *
 * @param {object} year
 * @param {{monotonicity?: 'sampled'|'exhaustive'|'skip'}} [options]
 * @returns {string[]} problems, empty if the config is usable
 */
export function validateTaxYear(year, { monotonicity = 'sampled' } = {}) {
  if (!year || typeof year !== 'object') return ['the tax year is missing'];

  const problems = [
    ...allowanceProblems(year.personalAllowance),
    ...bandProblems(year.incomeTax, 'income tax'),
    ...bandProblems(year.nationalInsurance, 'National Insurance'),
  ];

  // Only worth checking once the structure is sound; the monotonicity pass runs
  // the calculator, which would throw on a malformed config rather than
  // reporting it.
  if (problems.length === 0 && monotonicity !== 'skip') {
    problems.push(...monotonicityProblems(year, monotonicity));
  }

  return problems;
}

/**
 * Throw if a tax year is unusable.
 *
 * For committed configs, where a problem is a bug rather than something a
 * person can correct.
 *
 * @param {object} year
 * @param {{monotonicity?: 'sampled'|'exhaustive'|'skip'}} [options]
 * @throws {RangeError}
 */
export function assertValidTaxYear(year, options) {
  const problems = validateTaxYear(year, options);
  if (problems.length > 0) {
    throw new RangeError(`Unusable tax year:\n  - ${problems.join('\n  - ')}`);
  }
}
