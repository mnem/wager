/**
 * Tax year data.
 *
 * This file is DATA ONLY. No calculation logic belongs here, and no tax figure
 * belongs anywhere else — see CLAUDE.md. Adding a future tax year, or another
 * jurisdiction, must be a change to this file alone.
 *
 * Every figure below was checked against the `sources` links on `verifiedOn`.
 * If you change a figure, re-check the primary source and update `verifiedOn`
 * in the same commit. Both fields are rendered in the UI so that staleness is
 * visible rather than assumed.
 *
 * ## What varies by jurisdiction, and what does not
 *
 * Income tax rates and bands are devolved — to Scotland via the Scottish rates,
 * and to Wales via the Welsh Rates of Income Tax — so they live under
 * `jurisdictions`. The personal allowance and National Insurance are reserved
 * to Westminster and identical everywhere, so they sit on the year itself
 * rather than being duplicated per jurisdiction — duplicating them would create
 * two places for the same figure to go wrong.
 *
 * Wales is listed separately from England and Northern Ireland because its tax
 * system genuinely is separate — the UK rates are reduced by 10p for Welsh
 * taxpayers and the Senedd sets a Welsh rate for each band. For 2026/27 it has
 * set 10p in every band, so the totals match England and Northern Ireland
 * exactly. That is a fact about this year's rates, not a structural one.
 *
 * Rather than copy the figures, the Welsh entry declares `ratesSameAs` and
 * `getTaxYear` resolves it. One copy of the numbers, but Wales still appears in
 * its own right — so nobody has to remember that "rest of the UK" quietly meant
 * three tax systems. When Wales diverges, replace `ratesSameAs` with its own
 * bands and nothing else changes.
 *
 * `getTaxYear()` flattens a year and a jurisdiction into a single object. That
 * flattened shape is what the calculator consumes, and it is deliberately the
 * same shape this file used before jurisdictions existed, so no calculation
 * code needed to change.
 *
 * ## Two different bases
 *
 * Income tax bands are cumulative limits on TAXABLE income — gross minus the
 * personal allowance. The two governments publish differently: gov.scot gives
 * ranges of gross income, gov.uk gives taxable income directly. `publishedBands`
 * carries each one's official table as GROSS ranges for display, and the tests
 * assert it agrees with the taxable limits.
 *
 * National Insurance ignores the personal allowance entirely, so its bands are
 * cumulative limits on GROSS income.
 *
 * ## Rates are integer basis points
 *
 * `rateBasisPoints: 1900` means 19%. Rates are stored this way, and the taper
 * as a whole-number ratio, so that no step of the calculation involves binary
 * floating point — 0.21 is not exactly representable, 2100 is.
 */

/** Cumulative band limits use this for "and everything above". */
const NO_UPPER_LIMIT = Infinity;

export const TAX_YEARS = {
  '2026-27': {
    id: '2026-27',
    label: '2026/27',
    startsOn: '2026-04-06',
    endsOn: '2027-04-05',
    verifiedOn: '2026-08-07',

    /** Reserved to Westminster, so the same in every jurisdiction. */
    ukSources: [
      {
        label: 'Rates and thresholds for employers 2026 to 2027 (gov.uk)',
        url: 'https://www.gov.uk/guidance/rates-and-thresholds-for-employers-2026-to-2027',
      },
    ],

    personalAllowance: {
      // £12,570
      amountPence: 1_257_000,
      // Reduced by £1 for every £2 of income over £100,000, so it reaches zero
      // at £125,140 — which is exactly where the highest band begins, in both
      // jurisdictions. Expressed as a whole-number ratio rather than 0.5 so the
      // taper stays exact integer arithmetic.
      taper: {
        thresholdPence: 10_000_000,
        withdraw: { lose: 1, per: 2 },
      },
    },

    nationalInsurance: {
      label: 'Class 1 employee (category A)',
      appliesTo: 'gross',
      bands: [
        // Below the primary threshold of £12,570.
        { id: 'below-pt', label: 'Below primary threshold', rateBasisPoints: 0, upToPence: 1_257_000 },
        // Primary threshold to the upper earnings limit of £50,270.
        { id: 'main', label: 'Main rate', rateBasisPoints: 800, upToPence: 5_027_000 },
        { id: 'upper', label: 'Above upper earnings limit', rateBasisPoints: 200, upToPence: NO_UPPER_LIMIT },
      ],
    },

    jurisdictions: {
      scotland: {
        id: 'scotland',
        label: 'Scotland',
        // Shown on the page so someone can check they are in the right one.
        appliesTo: 'people whose main home is in Scotland',
        sources: [
          {
            label: 'Scottish Income Tax rates and bands 2026-27 (gov.scot)',
            url: 'https://www.gov.scot/publications/scottish-income-tax-rates-and-bands/pages/2026-to-2027/',
          },
        ],

        incomeTax: {
          appliesTo: 'taxable',
          bands: [
            { id: 'starter', label: 'Starter rate', rateBasisPoints: 1900, upToPence: 396_700 },
            { id: 'basic', label: 'Basic rate', rateBasisPoints: 2000, upToPence: 1_695_600 },
            { id: 'intermediate', label: 'Intermediate rate', rateBasisPoints: 2100, upToPence: 3_109_200 },
            { id: 'higher', label: 'Higher rate', rateBasisPoints: 4200, upToPence: 6_243_000 },
            // £125,140 of taxable income, NOT £112,570. By this point the
            // personal allowance has tapered fully away, so taxable income
            // equals gross income. Using £112,570 here would silently push
            // people into the 48% band from about £112.5k of gross.
            { id: 'advanced', label: 'Advanced rate', rateBasisPoints: 4500, upToPence: 12_514_000 },
            { id: 'top', label: 'Top rate', rateBasisPoints: 4800, upToPence: NO_UPPER_LIMIT },
          ],
        },

        // gov.scot publishes GROSS ranges, so this is a transcription of its
        // table. The tests assert it agrees with the taxable limits above.
        publishedBands: [
          { id: 'starter', fromPence: 1_257_100, toPence: 1_653_700 },
          { id: 'basic', fromPence: 1_653_800, toPence: 2_952_600 },
          { id: 'intermediate', fromPence: 2_952_700, toPence: 4_366_200 },
          { id: 'higher', fromPence: 4_366_300, toPence: 7_500_000 },
          { id: 'advanced', fromPence: 7_500_100, toPence: 12_514_000 },
          { id: 'top', fromPence: 12_514_100, toPence: null },
        ],
      },

      'england-ni': {
        id: 'england-ni',
        label: 'England & Northern Ireland',
        appliesTo: 'people whose main home is in England or Northern Ireland',
        sources: [
          {
            label: 'Income Tax rates and allowances (gov.uk)',
            url: 'https://www.gov.uk/government/publications/rates-and-allowances-income-tax/income-tax-rates-and-allowances-current-and-past',
          },
        ],

        incomeTax: {
          appliesTo: 'taxable',
          // gov.uk publishes these as taxable income already, so unlike the
          // Scottish figures these need no conversion — £37,700 is the number
          // printed on the page.
          bands: [
            { id: 'basic', label: 'Basic rate', rateBasisPoints: 2000, upToPence: 3_770_000 },
            { id: 'higher', label: 'Higher rate', rateBasisPoints: 4000, upToPence: 12_514_000 },
            { id: 'additional', label: 'Additional rate', rateBasisPoints: 4500, upToPence: NO_UPPER_LIMIT },
          ],
        },

        // Derived from the taxable bands for display, since gov.uk does not
        // publish a gross table. The tests check the two agree either way.
        publishedBands: [
          { id: 'basic', fromPence: 1_257_100, toPence: 5_027_000 },
          { id: 'higher', fromPence: 5_027_100, toPence: 12_514_000 },
          { id: 'additional', fromPence: 12_514_100, toPence: null },
        ],
      },

      wales: {
        id: 'wales',
        label: 'Wales',
        appliesTo: 'people whose main home is in Wales',
        sources: [
          {
            label: 'Welsh rates of Income Tax (gov.wales)',
            url: 'https://www.gov.wales/welsh-rates-income-tax',
          },
          {
            label: 'Income Tax in Wales (gov.uk)',
            url: 'https://www.gov.uk/welsh-income-tax',
          },
        ],

        // Wales sets its own rates: the UK rates are reduced by 10p for Welsh
        // taxpayers, and the Senedd sets a Welsh rate for each band. For
        // 2026/27 it set 10p in every band, so the totals come out identical to
        // England and Northern Ireland.
        //
        // Pointing at that entry rather than copying its numbers keeps one
        // source of truth while still listing Wales in its own right. Replace
        // this with an `incomeTax` and `publishedBands` of its own the year the
        // Senedd chooses differently.
        ratesSameAs: 'england-ni',
        ratesNote:
          'Wales sets its own income tax rates. For 2026/27 the Senedd set them to match England and Northern Ireland exactly.',
      },
    },
  },
};

export const DEFAULT_TAX_YEAR_ID = '2026-27';
export const DEFAULT_JURISDICTION_ID = 'scotland';

/**
 * Look up a tax year for a jurisdiction, flattened into the shape the
 * calculator consumes.
 *
 * The flattening is the point: `calculator.js` and `invert.js` never learn that
 * jurisdictions exist. They receive the same object shape they always have.
 *
 * @param {string} [yearId]
 * @param {string} [jurisdictionId]
 * @returns {object} the resolved tax year config
 * @throws {RangeError} if either id is not configured
 */
export function getTaxYear(yearId = DEFAULT_TAX_YEAR_ID, jurisdictionId = DEFAULT_JURISDICTION_ID) {
  const year = TAX_YEARS[yearId];
  if (!year) {
    throw new RangeError(
      `Unknown tax year: ${JSON.stringify(yearId)}. Known: ${listTaxYearIds().join(', ')}`,
    );
  }

  const jurisdiction = year.jurisdictions[jurisdictionId];
  if (!jurisdiction) {
    throw new RangeError(
      `Unknown jurisdiction: ${JSON.stringify(jurisdictionId)}. Known: ${Object.keys(year.jurisdictions).join(', ')}`,
    );
  }

  // A jurisdiction whose rates currently match another's points at it rather
  // than duplicating the figures. Only one level of indirection is allowed: a
  // chain would make it hard to see which numbers actually apply.
  const rates = jurisdiction.ratesSameAs
    ? year.jurisdictions[jurisdiction.ratesSameAs]
    : jurisdiction;
  if (!rates) {
    throw new RangeError(
      `Jurisdiction ${JSON.stringify(jurisdictionId)} points its rates at ${JSON.stringify(jurisdiction.ratesSameAs)}, which does not exist`,
    );
  }
  if (rates.ratesSameAs) {
    throw new RangeError(
      `Jurisdiction ${JSON.stringify(jurisdictionId)} points its rates at ${JSON.stringify(jurisdiction.ratesSameAs)}, which points somewhere else again`,
    );
  }

  return {
    id: year.id,
    label: year.label,
    startsOn: year.startsOn,
    endsOn: year.endsOn,
    verifiedOn: year.verifiedOn,

    jurisdictionId: jurisdiction.id,
    jurisdiction: jurisdiction.label,
    appliesTo: jurisdiction.appliesTo,
    // Present only where a jurisdiction's rates currently match another's, so
    // the UI can say so rather than leaving it to look like a coincidence.
    ratesNote: jurisdiction.ratesNote ?? null,

    // The jurisdiction's own sources first, then the UK-wide ones, so the most
    // specific reference is the one a reader sees first.
    sources: [...jurisdiction.sources, ...year.ukSources],

    personalAllowance: year.personalAllowance,
    nationalInsurance: year.nationalInsurance,
    incomeTax: rates.incomeTax,
    publishedBands: rates.publishedBands,
  };
}

/**
 * All configured tax year ids, most recent first.
 *
 * @returns {string[]}
 */
export function listTaxYearIds() {
  return Object.keys(TAX_YEARS).sort().reverse();
}

/**
 * The jurisdictions available for a tax year, in display order.
 *
 * @param {string} [yearId]
 * @returns {Array<{id: string, label: string}>}
 */
export function listJurisdictions(yearId = DEFAULT_TAX_YEAR_ID) {
  const year = TAX_YEARS[yearId];
  if (!year) {
    throw new RangeError(`Unknown tax year: ${JSON.stringify(yearId)}`);
  }
  return Object.values(year.jurisdictions).map(({ id, label }) => ({ id, label }));
}
