/**
 * Working out which tax year to calculate with.
 *
 * Three separate choices land on one config, and the order they combine in is
 * not obvious:
 *
 * 1. Which jurisdiction — already resolved, and arrives here as `published`.
 * 2. Whether the figures have been edited by hand, and whether those edits are
 *    usable.
 * 3. Whether National Insurance is being deducted.
 *
 * ## Why this is not in app.js
 *
 * It looks like state wiring, and it was written there first. It is not: it is
 * the rule deciding which numbers a person is shown, and it got that wrong in a
 * way no test could catch, because `app.js` has none by design.
 *
 * The bug is worth recording. Invalid edits deliberately fall back to the last
 * good figures rather than showing nothing — and the National Insurance switch
 * was applied *inside* that fallback. So with a bad edit outstanding, flipping
 * the switch flipped the checkbox and stored the preference while the figures
 * carried on deducting National Insurance, and the page carried on saying so.
 * The control and the numbers disagreed, with only an unrelated edit warning on
 * screen.
 *
 * The fix is the shape below: the edit rule decides `figures`, and the switch is
 * applied to whatever that turned out to be. Flipping the switch can never
 * itself be invalid, so nothing about a bad edit may hold it back.
 *
 * ## Why the switch is applied last
 *
 * `fromEditable` runs first so the editor always presents the real National
 * Insurance rates as the ones in force. Zeroing them first would show a table of
 * noughts and silently discard anything typed into it.
 */

import { fromEditable } from './editable.js';
import { validateTaxYear } from './validate.js';
import { withoutNationalInsurance } from './national-insurance.js';

/**
 * @typedef {object} ResolvedChoice
 * @property {object} figures the rates and bands in force — published, or edited
 * @property {object} year `figures` plus the National Insurance choice; what to calculate with
 * @property {string[]} problems why the edits were rejected, empty when they were not
 */

/**
 * Combine the jurisdiction's published figures, any hand edits, and the
 * National Insurance choice into the one config everything else reads.
 *
 * @param {object} options
 * @param {object} options.published the resolved tax year for the chosen jurisdiction
 * @param {import('./editable.js').EditableTaxYear|null} [options.edits] hand-edited figures, or null
 * @param {boolean} [options.niCharged] whether employee National Insurance is deducted
 * @param {object} [options.lastGoodFigures] what to fall back to when the edits are unusable
 * @returns {ResolvedChoice}
 */
export function resolveTaxYear({
  published,
  edits = null,
  niCharged = true,
  lastGoodFigures = published,
}) {
  let figures = published;
  let problems = [];

  if (edits) {
    const candidate = fromEditable(edits, published);
    problems = validateTaxYear(candidate);
    // Keep calculating with the last good figures rather than showing nothing.
    // The caller says plainly that the edits are not being used.
    figures = problems.length === 0 ? candidate : lastGoodFigures;
  }

  return {
    figures,
    problems,
    year: niCharged ? figures : withoutNationalInsurance(figures),
  };
}
