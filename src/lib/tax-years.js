/**
 * Tax year data.
 *
 * This file is DATA ONLY. No calculation logic belongs here, and no tax figure
 * belongs anywhere else — see CLAUDE.md. Adding a future tax year must be a
 * change to this file alone.
 *
 * Every figure below was checked against the `sources` links on `verifiedOn`.
 * If you change a figure, re-check the primary source and update `verifiedOn`
 * in the same commit. Both fields are rendered in the UI so that staleness is
 * visible rather than assumed.
 *
 * ## Two different bases
 *
 * Income tax bands are cumulative limits on TAXABLE income — gross minus the
 * personal allowance. gov.scot publishes them as ranges of gross income, so
 * `publishedBands` below carries the official gross table verbatim for display,
 * and the tests assert the two representations agree.
 *
 * National Insurance ignores the personal allowance entirely, so its bands are
 * cumulative limits on GROSS income.
 */

/** Cumulative band limits use this for "and everything above". */
const NO_UPPER_LIMIT = Infinity;

export const TAX_YEARS = {
  '2026-27': {
    id: '2026-27',
    label: '2026/27',
    startsOn: '2026-04-06',
    endsOn: '2027-04-05',
    jurisdiction: 'Scotland',
    verifiedOn: '2026-08-05',
    sources: [
      {
        label: 'Scottish Income Tax rates and bands 2026-27 (gov.scot)',
        url: 'https://www.gov.scot/publications/scottish-income-tax-rates-and-bands/pages/2026-to-2027/',
      },
      {
        label: 'Rates and thresholds for employers 2026 to 2027 (gov.uk)',
        url: 'https://www.gov.uk/guidance/rates-and-thresholds-for-employers-2026-to-2027',
      },
    ],

    personalAllowance: {
      // £12,570
      amountPence: 1_257_000,
      // Reduced by £1 for every £2 of income over £100,000, so it reaches zero
      // at £125,140 — which is exactly where the top rate begins.
      taper: {
        thresholdPence: 10_000_000,
        lossPerPound: 0.5,
      },
    },

    incomeTax: {
      appliesTo: 'taxable',
      bands: [
        { id: 'starter', label: 'Starter rate', rate: 0.19, upToPence: 396_700 },
        { id: 'basic', label: 'Basic rate', rate: 0.2, upToPence: 1_695_600 },
        { id: 'intermediate', label: 'Intermediate rate', rate: 0.21, upToPence: 3_109_200 },
        { id: 'higher', label: 'Higher rate', rate: 0.42, upToPence: 6_243_000 },
        // £125,140 of taxable income, NOT £112,570. By this point the personal
        // allowance has tapered fully away, so taxable income equals gross
        // income. Using £112,570 here would silently push people into the 48%
        // band from about £112.5k of gross.
        { id: 'advanced', label: 'Advanced rate', rate: 0.45, upToPence: 12_514_000 },
        { id: 'top', label: 'Top rate', rate: 0.48, upToPence: NO_UPPER_LIMIT },
      ],
    },

    nationalInsurance: {
      label: 'Class 1 employee (category A)',
      appliesTo: 'gross',
      bands: [
        // Below the primary threshold of £12,570.
        { id: 'below-pt', label: 'Below primary threshold', rate: 0, upToPence: 1_257_000 },
        // Primary threshold to the upper earnings limit of £50,270.
        { id: 'main', label: 'Main rate', rate: 0.08, upToPence: 5_027_000 },
        { id: 'upper', label: 'Above upper earnings limit', rate: 0.02, upToPence: NO_UPPER_LIMIT },
      ],
    },

    /**
     * The official gov.scot table, as GROSS ranges, for display only. This
     * duplicates the information in `incomeTax.bands` on purpose: the tests
     * assert the two agree, which is what catches a mistyped threshold.
     *
     * `toPence` is the last whole pound of the band; null means unbounded.
     */
    publishedBands: [
      { id: 'starter', fromPence: 1_257_100, toPence: 1_653_700 },
      { id: 'basic', fromPence: 1_653_800, toPence: 2_952_600 },
      { id: 'intermediate', fromPence: 2_952_700, toPence: 4_366_200 },
      { id: 'higher', fromPence: 4_366_300, toPence: 7_500_000 },
      { id: 'advanced', fromPence: 7_500_100, toPence: 12_514_000 },
      { id: 'top', fromPence: 12_514_100, toPence: null },
    ],
  },
};

export const DEFAULT_TAX_YEAR_ID = '2026-27';

/**
 * Look up a tax year by id.
 *
 * @param {string} [id]
 * @returns {object} the tax year config
 * @throws {RangeError} if the id is not configured
 */
export function getTaxYear(id = DEFAULT_TAX_YEAR_ID) {
  const year = TAX_YEARS[id];
  if (!year) {
    throw new RangeError(`Unknown tax year: ${JSON.stringify(id)}. Known: ${listTaxYearIds().join(', ')}`);
  }
  return year;
}

/**
 * All configured tax year ids, most recent first.
 *
 * @returns {string[]}
 */
export function listTaxYearIds() {
  return Object.keys(TAX_YEARS).sort().reverse();
}
