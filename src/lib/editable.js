/**
 * Turning a tax year into something a person can edit, and back again.
 *
 * This exists so the page can offer an escape hatch: if the rates change before
 * the app is updated, someone can put the new figures in themselves rather than
 * being stuck with stale ones. It is not the main path, and the UI treats it as
 * a deliberate departure from the verified figures.
 *
 * ## Editing happens in GROSS pounds, storage happens in TAXABLE pence
 *
 * The config stores income tax bands as cumulative limits on taxable income,
 * because that is what the calculator needs. Nobody thinks in those terms — the
 * published tables, and the page itself, show ranges of gross income. So the
 * editable form is gross, and this module converts.
 *
 * The conversion is the same rule the tests use to check the two
 * representations agree: subtract the personal allowance, except above the
 * point the taper has removed it entirely, where taxable income equals gross.
 * Getting this backwards is the £112,570 mistake, so it is derived here once
 * rather than left to whoever builds a form.
 *
 * National Insurance is already charged on gross income, so its limits pass
 * through untouched.
 */

import { assertPence } from './money.js';

/**
 * @typedef {object} EditableBand
 * @property {string} id
 * @property {string} label
 * @property {number} rateBasisPoints
 * @property {number|null} toPence the last pound of the band as GROSS income, null if unbounded
 */

/**
 * @typedef {object} EditableTaxYear
 * @property {number} allowancePence
 * @property {number} taperThresholdPence
 * @property {{lose: number, per: number}} withdraw
 * @property {EditableBand[]} incomeTax
 * @property {EditableBand[]} nationalInsurance
 */

/**
 * The gross income at which the personal allowance has been withdrawn entirely.
 *
 * @param {number} allowancePence
 * @param {number} taperThresholdPence
 * @param {{lose: number, per: number}} withdraw
 * @returns {number}
 */
function allowanceExhaustedAt(allowancePence, taperThresholdPence, withdraw) {
  return taperThresholdPence + (allowancePence * withdraw.per) / withdraw.lose;
}

/**
 * Present a resolved tax year as editable, gross-denominated fields.
 *
 * @param {object} year a resolved tax year, as `getTaxYear` returns
 * @returns {EditableTaxYear}
 */
export function toEditable(year) {
  const { amountPence, taper } = year.personalAllowance;
  const publishedById = Object.fromEntries(year.publishedBands.map((band) => [band.id, band]));

  return {
    allowancePence: amountPence,
    taperThresholdPence: taper.thresholdPence,
    withdraw: { ...taper.withdraw },

    // The published table already holds the gross limits, so income tax needs
    // no conversion in this direction.
    incomeTax: year.incomeTax.bands.map((band) => ({
      id: band.id,
      label: band.label,
      rateBasisPoints: band.rateBasisPoints,
      toPence: publishedById[band.id]?.toPence ?? null,
    })),

    nationalInsurance: year.nationalInsurance.bands.map((band) => ({
      id: band.id,
      label: band.label,
      rateBasisPoints: band.rateBasisPoints,
      toPence: Number.isFinite(band.upToPence) ? band.upToPence : null,
    })),
  };
}

/**
 * Build a tax year from edited, gross-denominated fields.
 *
 * The result is *not* checked here — pass it to `validateTaxYear`. Building and
 * validating are kept separate so the UI can report every problem at once
 * rather than failing on the first one.
 *
 * @param {EditableTaxYear} editable
 * @param {object} template the year being edited, for the parts that are not editable
 * @returns {object} a resolved tax year, in the shape the calculator consumes
 */
export function fromEditable(editable, template) {
  assertPence(editable.allowancePence);
  assertPence(editable.taperThresholdPence);

  const exhaustedAt = allowanceExhaustedAt(
    editable.allowancePence,
    editable.taperThresholdPence,
    editable.withdraw,
  );

  /**
   * Gross to taxable, for one limit.
   *
   * Above the point the allowance is gone, taxable income equals gross income —
   * which is why the highest bands' limits are not reduced. Subtracting the
   * allowance there is the mistake that starts the top rate too early.
   */
  const toTaxable = (grossPence) =>
    grossPence >= exhaustedAt ? grossPence : Math.max(0, grossPence - editable.allowancePence);

  const bands = (list, convert) =>
    list.map((band, index) => ({
      id: band.id,
      label: band.label,
      rateBasisPoints: band.rateBasisPoints,
      // A null limit means unbounded, which only the last band may be. If an
      // earlier band has one, validation will say so rather than this guessing.
      upToPence:
        band.toPence === null || index === list.length - 1 ? Infinity : convert(band.toPence),
    }));

  return {
    ...template,

    personalAllowance: {
      amountPence: editable.allowancePence,
      taper: {
        thresholdPence: editable.taperThresholdPence,
        withdraw: { ...editable.withdraw },
      },
    },

    incomeTax: {
      appliesTo: 'taxable',
      bands: bands(editable.incomeTax, toTaxable),
    },

    nationalInsurance: {
      ...template.nationalInsurance,
      appliesTo: 'gross',
      // Already gross, so no conversion.
      bands: bands(editable.nationalInsurance, (grossPence) => grossPence),
    },

    // Rebuild the display table from what was typed, so the band table on the
    // page shows the edited figures rather than the originals.
    publishedBands: editable.incomeTax.map((band, index) => ({
      id: band.id,
      fromPence:
        index === 0
          ? editable.allowancePence + 100
          : (editable.incomeTax[index - 1].toPence ?? 0) + 100,
      toPence: index === editable.incomeTax.length - 1 ? null : band.toPence,
    })),

    // The figures are no longer the ones that were verified, and the page must
    // stop claiming they are.
    edited: true,
    verifiedOn: null,
  };
}

/**
 * Whether an editable form still matches the year it came from.
 *
 * Used to decide whether to show the edited warning, so that opening the
 * controls and changing nothing does not look like tampering.
 *
 * @param {EditableTaxYear} editable
 * @param {object} year the original resolved tax year
 * @returns {boolean}
 */
export function isUnchanged(editable, year) {
  const original = toEditable(year);
  return JSON.stringify(editable) === JSON.stringify(original);
}
