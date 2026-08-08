import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveTaxYear } from '../src/lib/resolve-year.js';
import { getTaxYear } from '../src/lib/tax-years.js';
import { toEditable } from '../src/lib/editable.js';
import { chargesNationalInsurance } from '../src/lib/national-insurance.js';
import { computeAnnual } from '../src/lib/calculator.js';

const p = (pounds) => Math.round(pounds * 100);

const PUBLISHED = getTaxYear('2026-27', 'scotland');

/** Edits that parse but cannot be used: a rate above 100%. */
function unusableEdits() {
  const editable = toEditable(PUBLISHED);
  editable.incomeTax[0].rateBasisPoints = 15_000;
  return editable;
}

/** Edits that are perfectly usable: the starter rate goes up. */
function usableEdits() {
  const editable = toEditable(PUBLISHED);
  editable.incomeTax[0].rateBasisPoints = 2500;
  return editable;
}

test('with no edits, the published figures are what is used', () => {
  const { figures, year, problems } = resolveTaxYear({ published: PUBLISHED });

  assert.deepEqual(problems, []);
  assert.equal(figures, PUBLISHED);
  assert.equal(year, PUBLISHED);
});

test('usable edits are used, and reported as no problem', () => {
  const { figures, year, problems } = resolveTaxYear({
    published: PUBLISHED,
    edits: usableEdits(),
  });

  assert.deepEqual(problems, []);
  assert.equal(figures.incomeTax.bands[0].rateBasisPoints, 2500);
  assert.equal(year.edited, true);
});

test('unusable edits fall back to the last good figures, and say why', () => {
  const lastGood = resolveTaxYear({ published: PUBLISHED, edits: usableEdits() }).figures;

  const { figures, problems } = resolveTaxYear({
    published: PUBLISHED,
    edits: unusableEdits(),
    lastGoodFigures: lastGood,
  });

  assert.ok(problems.length > 0, 'the reason must be reported, not swallowed');
  assert.match(problems[0], /rate between 0% and 100%/);
  assert.equal(figures, lastGood, 'showing nothing would be worse than showing the last good set');
});

test('the National Insurance switch applies to published figures', () => {
  const { year } = resolveTaxYear({ published: PUBLISHED, niCharged: false });

  assert.equal(chargesNationalInsurance(year), false);
  assert.equal(computeAnnual(p(30_000), year).nationalInsurance.totalPence, 0);
});

test('the National Insurance switch applies to edited figures too', () => {
  const { year } = resolveTaxYear({
    published: PUBLISHED,
    edits: usableEdits(),
    niCharged: false,
  });

  assert.equal(chargesNationalInsurance(year), false);
  assert.equal(year.incomeTax.bands[0].rateBasisPoints, 2500, 'the edit survives the switch');
  assert.equal(year.edited, true, 'and the page still knows the figures were changed by hand');
});

test('an unusable edit cannot hold the National Insurance switch stale', () => {
  // The regression. The switch used to be applied inside the "edits are valid"
  // branch, so with a bad edit outstanding the checkbox flipped and the
  // preference was stored while the figures carried on deducting National
  // Insurance — and every line of copy on the page carried on saying so. The
  // control and the numbers disagreed, with only an unrelated edit warning
  // visible to hint at it.
  //
  // Flipping the switch can never itself be invalid, so a rejected edit must
  // not be able to pin it.
  const off = resolveTaxYear({
    published: PUBLISHED,
    edits: unusableEdits(),
    niCharged: false,
    lastGoodFigures: PUBLISHED,
  });

  assert.ok(off.problems.length > 0, 'the edit is still rejected');
  assert.equal(chargesNationalInsurance(off.year), false, 'and the switch still took effect');
  assert.equal(computeAnnual(p(30_000), off.year).nationalInsurance.totalPence, 0);

  // And back again, with the same bad edit still outstanding.
  const on = resolveTaxYear({
    published: PUBLISHED,
    edits: unusableEdits(),
    niCharged: true,
    lastGoodFigures: PUBLISHED,
  });

  assert.ok(on.problems.length > 0);
  assert.equal(chargesNationalInsurance(on.year), true);
  assert.ok(computeAnnual(p(30_000), on.year).nationalInsurance.totalPence > 0);
});

test('the rejected edit is never what the switch is applied to', () => {
  // The other half of the same rule: falling back to the last good figures must
  // not quietly become "use the broken ones, minus National Insurance".
  const { year } = resolveTaxYear({
    published: PUBLISHED,
    edits: unusableEdits(),
    niCharged: false,
    lastGoodFigures: PUBLISHED,
  });

  assert.equal(
    year.incomeTax.bands[0].rateBasisPoints,
    PUBLISHED.incomeTax.bands[0].rateBasisPoints,
    'the 150% rate must not reach the calculator by any route',
  );
});

test('figures and year differ in National Insurance and nothing else', () => {
  // What the band table renders from and what the answer is calculated with
  // must never be two different sets of numbers.
  //
  // National Insurance is the single exception, so it is asserted rather than
  // left out — a partial-equality check reads as an oversight otherwise, and
  // the exception is the whole point of the pair existing.
  for (const niCharged of [true, false]) {
    for (const edits of [null, usableEdits()]) {
      const { figures, year } = resolveTaxYear({ published: PUBLISHED, edits, niCharged });
      const where = `niCharged=${niCharged}, edits=${Boolean(edits)}`;

      assert.deepEqual(year.incomeTax, figures.incomeTax, where);
      assert.deepEqual(year.personalAllowance, figures.personalAllowance, where);
      assert.deepEqual(year.publishedBands, figures.publishedBands, where);
      assert.equal(year.jurisdiction, figures.jurisdiction, where);

      if (niCharged) {
        assert.deepEqual(year.nationalInsurance, figures.nationalInsurance, where);
      } else {
        assert.notDeepEqual(year.nationalInsurance, figures.nationalInsurance, where);
        assert.equal(chargesNationalInsurance(figures), true, `${where}: figures keep the real rates`);
        assert.equal(chargesNationalInsurance(year), false, where);
      }
    }
  }
});

test('switching jurisdiction changes every figure that should change', () => {
  // app.js discards edits on a jurisdiction change, so this is the shape it
  // passes: fresh published figures, no edits, whatever the switch was set to.
  const wales = getTaxYear('2026-27', 'wales');
  const { year } = resolveTaxYear({ published: wales, edits: null, niCharged: false });

  assert.equal(year.jurisdictionId, 'wales');
  assert.equal(chargesNationalInsurance(year), false);
  assert.equal(year.verifiedOn, wales.verifiedOn, 'unedited figures still claim verification');
});
