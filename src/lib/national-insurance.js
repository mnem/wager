/**
 * Modelling income that National Insurance does not touch.
 *
 * Income tax and National Insurance are charged on different things. Class 1
 * employee National Insurance is a charge on *earnings*, and only on earnings
 * before State Pension age. Income tax is charged on income of almost any kind,
 * at any age. So there are two ordinary cases where the whole income tax
 * calculation still applies and National Insurance does not at all:
 *
 * - **Pension income.** A pension is not earnings, so no employee National
 *   Insurance is due on it whatever your age. Working out what pension income
 *   pays a given monthly figure is the case this was built for.
 * - **Earnings after State Pension age.** Employee contributions stop the day
 *   after you reach it. The employer's own contributions carry on, but those
 *   were never part of this calculation — it models what leaves a payslip, and
 *   the employer's share never appears on one.
 *
 * Income tax is unaffected in both cases, including the personal allowance,
 * its taper, and which jurisdiction's bands apply — so all of that is left
 * exactly as it was.
 *
 * ## Why this is a config transform rather than a mode
 *
 * The calculator could have grown a flag, and then so could the inversion, the
 * validator and the breakdown — four places to keep in step for one idea. A
 * tax year whose National Insurance is a single unbounded band at 0% is instead
 * an entirely ordinary config: it validates, it is monotonic (charging nothing
 * cannot make take-home pay fall), and every figure downstream comes out right
 * without anything else knowing this mode exists.
 *
 * `charged: false` is carried alongside purely so the page can say so in words.
 * Without it a reader sees a row of zeroes and has to work out why.
 *
 * ## Apply this last
 *
 * The transform expects a fully resolved tax year — after `getTaxYear`, and
 * after `fromEditable` if the figures have been edited by hand. Applying it
 * first would hand the editor a zeroed National Insurance table to present as
 * the figures in force, and any rate typed into it would then be discarded.
 */

/** The single band that replaces National Insurance when it is not charged. */
const NOT_CHARGED_BAND = {
  id: 'not-charged',
  label: 'Not charged',
  rateBasisPoints: 0,
  upToPence: Infinity,
};

/**
 * A copy of a tax year with employee National Insurance switched off.
 *
 * The original is not modified, so the published figures stay available to
 * switch back to.
 *
 * @param {object} year a resolved tax year, as `getTaxYear` or `fromEditable` returns
 * @returns {object} the same year with National Insurance charged at 0% throughout
 */
export function withoutNationalInsurance(year) {
  return {
    ...year,
    nationalInsurance: {
      ...year.nationalInsurance,
      charged: false,
      bands: [{ ...NOT_CHARGED_BAND }],
    },
  };
}

/**
 * Whether a tax year charges National Insurance at all.
 *
 * Absent means charged, so every config written before this existed — and every
 * one `getTaxYear` returns — reads as charging it. The default lives here so
 * that the calculator and the page cannot end up disagreeing about it.
 *
 * @param {object} year a resolved tax year, or a breakdown's `nationalInsurance`'s owner
 * @returns {boolean}
 */
export function chargesNationalInsurance(year) {
  return year?.nationalInsurance?.charged !== false;
}
