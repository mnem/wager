/**
 * Gross to net.
 *
 * Contains no tax figures — everything comes from the tax year config passed
 * in. See CLAUDE.md.
 *
 * ## Everything here is exact integer arithmetic
 *
 * Amounts are integer pence and rates are integer basis points, so no step
 * involves binary floating point. Charges are accumulated in basis-point units
 * (ten-thousandths of a penny) and converted to pence exactly once.
 *
 * ## Why the rounding happens where it does
 *
 * Rounding each charge to the penny independently breaks monotonicity: at a
 * gross of £12,570.18 the income tax is £0.0342 and NI is £0.0144, both of
 * which round down; one penny later they are £0.0361 and £0.0152, and both
 * round up. A 1p pay rise costs 2p in deductions and take-home pay falls.
 *
 * The net-to-gross inversion depends on net pay never falling as gross pay
 * rises, so instead the exact charges are summed, the *combined* deduction is
 * rounded once, and that single integer is distributed back across the bands by
 * largest remainder. Because the worst-case marginal deduction is well under
 * 100%, one more penny of gross can never cost more than one more penny of
 * deductions — and the breakdown still adds up exactly.
 */

import { assertPence, BASIS_POINTS, roundHalfUp, basisPointsToRate } from './money.js';
import { getTaxYear } from './tax-years.js';
import { chargesNationalInsurance } from './national-insurance.js';

const MONTHS_PER_YEAR = 12;

/**
 * @typedef {object} BandRow
 * @property {string} id
 * @property {string} label
 * @property {number} rateBasisPoints e.g. 1900 for 19%
 * @property {number} rate the same rate as a fraction, for display
 * @property {number} amountInBandPence how much income fell in this band
 * @property {number} chargeBasisPoints the exact charge, in ten-thousandths of a penny
 * @property {number} taxPence the charge in whole pence, summing to the total
 */

/**
 * Share an integer total across a set of exact fractions, giving each its floor
 * and handing the leftover units to the largest remainders.
 *
 * Both the floors and the remainders are exact integers, so the allocation is
 * deterministic and never loses or invents a penny.
 *
 * @param {number[]} numerators
 * @param {number} denominator
 * @param {number} targetTotal the already-rounded total to distribute
 * @returns {number[]} integers summing to exactly targetTotal
 */
function allocateByLargestRemainder(numerators, denominator, targetTotal) {
  const allocated = numerators.map((numerator) => Math.floor(numerator / denominator));
  let leftover = targetTotal - allocated.reduce((total, value) => total + value, 0);

  // Largest remainder first; index breaks ties so the result is stable.
  const byRemainder = numerators
    .map((numerator, index) => ({ index, remainder: numerator % denominator }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);

  for (let i = 0; leftover > 0 && i < byRemainder.length; i += 1) {
    allocated[byRemainder[i].index] += 1;
    leftover -= 1;
  }

  // Defensive: only reachable if a caller passes a total below the floors.
  for (let i = byRemainder.length - 1; leftover < 0 && i >= 0; i -= 1) {
    const { index } = byRemainder[i];
    if (allocated[index] > 0) {
      allocated[index] -= 1;
      leftover += 1;
    }
  }

  return allocated;
}

/**
 * Work out the personal allowance at a given gross income, applying the taper
 * that removes it above the taper threshold.
 *
 * @param {number} grossPence
 * @param {object} year tax year config
 * @returns {{basePence: number, taperedAwayPence: number, allowancePence: number}}
 */
export function personalAllowanceFor(grossPence, year) {
  assertPence(grossPence);
  const { amountPence, taper } = year.personalAllowance;

  if (grossPence <= taper.thresholdPence) {
    return { basePence: amountPence, taperedAwayPence: 0, allowancePence: amountPence };
  }

  const overThreshold = grossPence - taper.thresholdPence;
  const { lose, per } = taper.withdraw;

  // Flooring is deliberate, not incidental. HMRC works the taper in whole
  // pounds — adjusted net income, the allowance and tax codes are all
  // whole-pound quantities — so there is no penny-level convention to follow
  // and this app is already finer-grained than the real system. Flooring
  // favours the taxpayer by at most a fraction of a penny and never shows up in
  // the displayed total.
  //
  // It does mean the allowance falls in whole-penny steps rather than smoothly,
  // so on the pennies where it drops, taxable income rises by 2p for 1p of
  // gross. test/tax-years.test.js asserts the deduction bound against that
  // discrete worst case rather than the 1.5x average.
  const taperedAwayPence = Math.min(amountPence, Math.floor((overThreshold * lose) / per));

  return {
    basePence: amountPence,
    taperedAwayPence,
    allowancePence: amountPence - taperedAwayPence,
  };
}

/**
 * Spread an amount across a set of cumulative bands.
 *
 * Each band's `upToPence` is a cumulative limit, so a band's width is the gap
 * between its own limit and the previous one. The final band must be unbounded.
 *
 * Charges come back in basis-point units and unrounded — see the note at the
 * top of this file for why rounding is deferred to the caller.
 *
 * @param {number} amountPence
 * @param {Array<{id: string, label: string, rateBasisPoints: number, upToPence: number}>} bands
 * @returns {{rows: BandRow[], chargeBasisPoints: number}}
 */
export function applyBands(amountPence, bands) {
  assertPence(amountPence);

  const amount = Math.max(0, amountPence);
  const rows = [];
  let chargeBasisPoints = 0;
  let bandStartsAt = 0;

  for (const band of bands) {
    const bandWidth = band.upToPence - bandStartsAt;
    const amountInBandPence = Math.max(0, Math.min(amount - bandStartsAt, bandWidth));
    const bandCharge = amountInBandPence * band.rateBasisPoints;

    rows.push({
      id: band.id,
      label: band.label,
      rateBasisPoints: band.rateBasisPoints,
      rate: basisPointsToRate(band.rateBasisPoints),
      amountInBandPence,
      chargeBasisPoints: bandCharge,
      taxPence: 0, // replaced once the combined total is known
    });

    chargeBasisPoints += bandCharge;
    bandStartsAt = band.upToPence;
  }

  return { rows, chargeBasisPoints };
}

/**
 * The rate that would apply to the next pound of a given amount, in basis
 * points.
 *
 * Uses the first band whose limit is strictly above the amount, so an amount
 * sitting exactly on a band boundary gets the rate of the band above it — which
 * is where the next pound actually lands.
 *
 * @param {number} amountPence
 * @param {Array<{rateBasisPoints: number, upToPence: number}>} bands
 * @returns {number}
 */
function rateForNextPound(amountPence, bands) {
  const band = bands.find((candidate) => candidate.upToPence > amountPence);
  return (band ?? bands.at(-1)).rateBasisPoints;
}

/**
 * @typedef {object} Breakdown
 * @property {number} grossPence
 * @property {{basePence: number, taperedAwayPence: number, allowancePence: number}} personalAllowance
 * @property {{taxablePence: number, rows: BandRow[], totalPence: number}} incomeTax
 * @property {{label: string, charged: boolean, rows: BandRow[], totalPence: number}} nationalInsurance
 * @property {number} totalDeductionsPence
 * @property {number} netPence
 * @property {number} effectiveDeductionRate
 * @property {number} marginalRate
 * @property {string} taxYearId
 * @property {number} periodsPerYear 1 for annual, 12 for monthly
 */

/**
 * Calculate a full annual breakdown for a gross salary.
 *
 * @param {number} grossPence
 * @param {object} [year] tax year config; defaults to the current year
 * @returns {Breakdown}
 */
export function computeAnnual(grossPence, year = getTaxYear()) {
  assertPence(grossPence);
  if (grossPence < 0) {
    throw new RangeError(`Gross pay cannot be negative, got ${grossPence}`);
  }

  const personalAllowance = personalAllowanceFor(grossPence, year);
  const taxablePence = Math.max(0, grossPence - personalAllowance.allowancePence);

  const tax = applyBands(taxablePence, year.incomeTax.bands);

  // National Insurance ignores the personal allowance, so it is charged on
  // gross rather than taxable income.
  const niBasePence = year.nationalInsurance.appliesTo === 'gross' ? grossPence : taxablePence;
  const ni = applyBands(niBasePence, year.nationalInsurance.bands);

  // Round the combined deduction exactly once, then share it out.
  const totalDeductionsPence = roundHalfUp(tax.chargeBasisPoints + ni.chargeBasisPoints, BASIS_POINTS);
  const allRows = [...tax.rows, ...ni.rows];
  const allocated = allocateByLargestRemainder(
    allRows.map((row) => row.chargeBasisPoints),
    BASIS_POINTS,
    totalDeductionsPence,
  );
  allRows.forEach((row, index) => {
    row.taxPence = allocated[index];
  });

  const sumCharges = (rows) => rows.reduce((total, row) => total + row.taxPence, 0);

  return {
    grossPence,
    personalAllowance,
    incomeTax: {
      taxablePence,
      rows: tax.rows,
      totalPence: sumCharges(tax.rows),
    },
    nationalInsurance: {
      label: year.nationalInsurance.label,
      // Carried through so the page can say National Insurance is not charged
      // rather than presenting a row of zeroes and leaving it to be inferred.
      // The arithmetic needs no flag: a 0% band charges nothing on its own.
      charged: chargesNationalInsurance(year),
      rows: ni.rows,
      totalPence: sumCharges(ni.rows),
    },
    totalDeductionsPence,
    netPence: grossPence - totalDeductionsPence,
    effectiveDeductionRate: grossPence === 0 ? 0 : totalDeductionsPence / grossPence,
    marginalRate: marginalRateAt(grossPence, year),
    taxYearId: year.id,
    periodsPerYear: 1,
  };
}

/**
 * The proportion of the next pound of gross pay that would be deducted.
 *
 * Derived from the config rather than by differencing two calculations, so it
 * is exact at band boundaries and free of per-penny rounding artefacts. Inside
 * the allowance taper each extra pound of gross adds more than a pound of
 * taxable income, which is why the tax rate is scaled by the taper ratio.
 *
 * @param {number} grossPence
 * @param {object} [year]
 * @returns {number} a fraction, e.g. 0.695
 */
export function marginalRateAt(grossPence, year = getTaxYear()) {
  assertPence(grossPence);

  const { allowancePence } = personalAllowanceFor(grossPence, year);
  const taxablePence = Math.max(0, grossPence - allowancePence);

  const { taper } = year.personalAllowance;
  const { lose, per } = taper.withdraw;
  const inTaper = grossPence >= taper.thresholdPence && allowancePence > 0;

  // Below the allowance the next pound is not taxed at all.
  const taxBasisPoints =
    grossPence >= allowancePence ? rateForNextPound(taxablePence, year.incomeTax.bands) : 0;
  // In the taper, one extra pound of gross adds (per + lose) / per of taxable income.
  const effectiveTaxBasisPoints = inTaper
    ? (taxBasisPoints * (per + lose)) / per
    : taxBasisPoints;

  const niBasePence = year.nationalInsurance.appliesTo === 'gross' ? grossPence : taxablePence;
  const niBasisPoints = rateForNextPound(niBasePence, year.nationalInsurance.bands);

  return basisPointsToRate(effectiveTaxBasisPoints + niBasisPoints);
}

/**
 * Convert an annual breakdown to a monthly one.
 *
 * The monthly deduction total is a twelfth of the annual one, rounded once and
 * then shared across the bands the same way — so the monthly table adds up too.
 * A real payslip differs slightly because payroll calculates each pay period
 * separately rather than dividing an annual figure.
 *
 * @param {Breakdown} annual
 * @returns {Breakdown}
 */
export function toMonthly(annual) {
  const perMonth = (pence) => roundHalfUp(pence, MONTHS_PER_YEAR);

  const allRows = [...annual.incomeTax.rows, ...annual.nationalInsurance.rows];
  const totalDeductionsPence = perMonth(annual.totalDeductionsPence);
  const allocated = allocateByLargestRemainder(
    allRows.map((row) => row.taxPence),
    MONTHS_PER_YEAR,
    totalDeductionsPence,
  );

  const monthlyRows = (rows, offset) =>
    rows.map((row, index) => ({
      ...row,
      amountInBandPence: perMonth(row.amountInBandPence),
      chargeBasisPoints: row.chargeBasisPoints / MONTHS_PER_YEAR,
      taxPence: allocated[offset + index],
    }));

  const incomeTaxRows = monthlyRows(annual.incomeTax.rows, 0);
  const niRows = monthlyRows(annual.nationalInsurance.rows, annual.incomeTax.rows.length);
  const sumCharges = (rows) => rows.reduce((total, row) => total + row.taxPence, 0);
  const grossPence = perMonth(annual.grossPence);

  return {
    grossPence,
    personalAllowance: {
      basePence: perMonth(annual.personalAllowance.basePence),
      taperedAwayPence: perMonth(annual.personalAllowance.taperedAwayPence),
      allowancePence: perMonth(annual.personalAllowance.allowancePence),
    },
    incomeTax: {
      taxablePence: perMonth(annual.incomeTax.taxablePence),
      rows: incomeTaxRows,
      totalPence: sumCharges(incomeTaxRows),
    },
    nationalInsurance: {
      label: annual.nationalInsurance.label,
      charged: annual.nationalInsurance.charged,
      rows: niRows,
      totalPence: sumCharges(niRows),
    },
    totalDeductionsPence,
    netPence: grossPence - totalDeductionsPence,
    // Rates are proportions, so they are the same whatever the period.
    effectiveDeductionRate: annual.effectiveDeductionRate,
    marginalRate: annual.marginalRate,
    taxYearId: annual.taxYearId,
    periodsPerYear: MONTHS_PER_YEAR,
  };
}
