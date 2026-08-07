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
 * The conversion subtracts whatever personal allowance actually survives at
 * that income — which is the full allowance below the taper, none above it, and
 * a partial amount inside it. It delegates to `personalAllowanceFor` rather
 * than restating the rule, because a second copy of the taper is exactly how
 * the two get out of step. Getting this wrong is the £112,570 mistake, so it is
 * read from one place rather than left to whoever builds a form.
 *
 * National Insurance is already charged on gross income, so its limits pass
 * through untouched.
 */

import { assertPence } from './money.js';
import { personalAllowanceFor } from './calculator.js';

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

  // Shaped so personalAllowanceFor can read it, since that is the only place
  // the taper is implemented.
  const taperOnly = {
    personalAllowance: {
      amountPence: editable.allowancePence,
      taper: {
        thresholdPence: editable.taperThresholdPence,
        withdraw: editable.withdraw,
      },
    },
  };

  /**
   * Gross to taxable, for one limit.
   *
   * Delegates to the calculator's own taper rather than re-deriving it. An
   * earlier version used a two-branch shortcut — subtract the whole allowance
   * below the point it runs out, subtract nothing above — which is right only
   * for limits outside the taper window. A limit *inside* it needs the partial
   * allowance that survives at that income, and the shortcut was out by the
   * whole allowance there.
   *
   * That never showed up on the shipped figures, because every band boundary
   * sits well below the taper or exactly at its end. It appeared the moment
   * someone raised the allowance — which moves the end of the taper up and
   * pulls the top band's boundary inside it. Precisely the case this module
   * exists to make safe, so the taper is now read from one place rather than
   * expressed twice and kept in step by hand.
   */
  const toTaxable = (grossPence) =>
    Math.max(0, grossPence - personalAllowanceFor(grossPence, taperOnly).allowancePence);

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
