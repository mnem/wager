import { test } from 'node:test';
import assert from 'node:assert/strict';

import { toEditable, fromEditable, isUnchanged } from '../src/lib/editable.js';
import { getTaxYear, listJurisdictions } from '../src/lib/tax-years.js';
import { validateTaxYear } from '../src/lib/validate.js';
import { computeAnnual, personalAllowanceFor } from '../src/lib/calculator.js';

const p = (pounds) => Math.round(pounds * 100);

test('an untouched round trip reproduces the original exactly', () => {
  // The property everything else rests on: opening the editor and changing
  // nothing must not change a single figure. If this drifts, someone who opens
  // the controls out of curiosity gets different answers afterwards.
  for (const { id } of listJurisdictions('2026-27')) {
    const year = getTaxYear('2026-27', id);
    const rebuilt = fromEditable(toEditable(year), year);

    assert.deepEqual(rebuilt.incomeTax.bands, year.incomeTax.bands, `${id} income tax`);
    assert.deepEqual(rebuilt.nationalInsurance.bands, year.nationalInsurance.bands, `${id} NI`);
    assert.deepEqual(rebuilt.personalAllowance, year.personalAllowance, `${id} allowance`);
    assert.deepEqual(rebuilt.publishedBands, year.publishedBands, `${id} published bands`);
  }
});

test('an untouched round trip gives identical answers', () => {
  for (const { id } of listJurisdictions('2026-27')) {
    const year = getTaxYear('2026-27', id);
    const rebuilt = fromEditable(toEditable(year), year);

    for (const gross of [p(30_000), p(60_000), p(110_000), p(130_000)]) {
      assert.equal(
        computeAnnual(gross, rebuilt).netPence,
        computeAnnual(gross, year).netPence,
        `${id} at ${gross}`,
      );
    }
  }
});

test('the editable form is gross, because that is what people read', () => {
  const year = getTaxYear('2026-27', 'scotland');
  const editable = toEditable(year);

  // Starter rate ends at £16,537 GROSS, which is £3,967 taxable. The form shows
  // the former.
  const starter = editable.incomeTax.find((band) => band.id === 'starter');
  assert.equal(starter.toPence, p(16_537));
  assert.equal(year.incomeTax.bands[0].upToPence, p(3_967));

  // National Insurance is charged on gross, so it passes through unchanged.
  const main = editable.nationalInsurance.find((band) => band.id === 'main');
  assert.equal(main.toPence, p(50_270));
});

test('gross converts to taxable correctly, including above the taper', () => {
  // The £112,570 mistake, guarded at the point where a form would introduce it.
  const year = getTaxYear('2026-27', 'scotland');
  const editable = toEditable(year);
  const rebuilt = fromEditable(editable, year);

  const byId = Object.fromEntries(rebuilt.incomeTax.bands.map((band) => [band.id, band]));

  // Below the taper: gross minus the allowance.
  assert.equal(byId.starter.upToPence, p(16_537) - p(12_570));
  assert.equal(byId.higher.upToPence, p(75_000) - p(12_570));

  // At £125,140 the allowance is already zero, so taxable equals gross. This is
  // the one that must NOT have the allowance subtracted.
  assert.equal(byId.advanced.upToPence, p(125_140));
  assert.notEqual(byId.advanced.upToPence, p(125_140) - p(12_570));
});

test('a raised allowance moves the taxable limits with it', () => {
  // The realistic escape-hatch edit: the Chancellor raises the allowance and
  // the app has not caught up. Every taxable limit below the taper should shift.
  const year = getTaxYear('2026-27', 'scotland');
  const editable = toEditable(year);
  editable.allowancePence = p(13_000);

  const rebuilt = fromEditable(editable, year);
  const byId = Object.fromEntries(rebuilt.incomeTax.bands.map((band) => [band.id, band]));

  assert.equal(byId.starter.upToPence, p(16_537) - p(13_000));
  assert.deepEqual(validateTaxYear(rebuilt, { monotonicity: 'sampled' }), []);

  // And a bigger allowance means more take-home pay.
  assert.ok(computeAnnual(p(30_000), rebuilt).netPence > computeAnnual(p(30_000), year).netPence);
});

test('a band limit inside the taper uses the allowance that survives there', () => {
  // The case that caught out an earlier version of this module, and the reason
  // it now delegates to personalAllowanceFor instead of re-deriving the taper.
  //
  // Raising the allowance to £20,000 moves the point it runs out from £125,140
  // to £140,000 — which pulls the advanced band's £125,140 boundary INSIDE the
  // taper. Inside it, neither shortcut applies: the allowance is neither whole
  // nor gone, it is partial.
  //
  //   over threshold  = 125,140 - 100,000 = 25,140
  //   withdrawn       = floor(25,140 / 2)  = 12,570
  //   allowance left  = 20,000 - 12,570    =  7,430
  //   taxable         = 125,140 - 7,430    = 117,710
  //
  // The old two-branch version subtracted the whole £20,000 and produced
  // £105,140 — out by the entire allowance, which would have moved the top rate
  // roughly £8,400 of gross income lower than the figure the user typed.
  const year = getTaxYear('2026-27', 'scotland');
  const editable = toEditable(year);
  editable.allowancePence = p(20_000);

  const rebuilt = fromEditable(editable, year);
  const byId = Object.fromEntries(rebuilt.incomeTax.bands.map((band) => [band.id, band]));

  assert.equal(byId.advanced.upToPence, p(117_710));
  assert.notEqual(byId.advanced.upToPence, p(125_140) - p(20_000));

  // Bands below the taper are unaffected, so the fix is not a blanket change.
  assert.equal(byId.starter.upToPence, p(16_537) - p(20_000) < 0 ? 0 : p(16_537) - p(20_000));
});

test('the conversion agrees with the calculator at every band boundary', () => {
  // The general statement of the above: whatever allowance the calculator says
  // applies at a given gross income is the allowance the conversion subtracts.
  // Asserted across allowances that put boundaries below, inside and above the
  // taper, so no single shortcut could pass.
  const year = getTaxYear('2026-27', 'scotland');

  for (const allowance of [p(0), p(12_570), p(15_000), p(20_000), p(30_000)]) {
    const editable = toEditable(year);
    editable.allowancePence = allowance;
    const rebuilt = fromEditable(editable, year);

    rebuilt.incomeTax.bands.forEach((band, index) => {
      if (!Number.isFinite(band.upToPence)) return;
      const grossLimit = editable.incomeTax[index].toPence;
      const surviving = personalAllowanceFor(grossLimit, rebuilt).allowancePence;
      assert.equal(
        band.upToPence,
        Math.max(0, grossLimit - surviving),
        `allowance ${allowance}, band ${band.id}`,
      );
    });
  }
});

test('an edited year is marked as edited and stops claiming verification', () => {
  const year = getTaxYear('2026-27', 'scotland');
  assert.ok(year.verifiedOn, 'the shipped figures carry a verification date');

  const rebuilt = fromEditable(toEditable(year), year);
  assert.equal(rebuilt.edited, true);
  assert.equal(rebuilt.verifiedOn, null, 'edited figures must not claim to have been verified');
});

test('edits that break the rules are reported, not silently used', () => {
  const year = getTaxYear('2026-27', 'scotland');

  const cases = [
    {
      what: 'a rate above 100%',
      edit: (editable) => {
        editable.incomeTax[0].rateBasisPoints = 12_000;
      },
    },
    {
      what: 'bands out of order',
      edit: (editable) => {
        editable.incomeTax[1].toPence = p(1_000);
      },
    },
    {
      what: 'a band name cleared',
      edit: (editable) => {
        editable.incomeTax[0].label = '';
      },
    },
    {
      what: 'a negative allowance',
      edit: (editable) => {
        editable.allowancePence = -100;
      },
    },
  ];

  for (const { what, edit } of cases) {
    const editable = toEditable(year);
    edit(editable);
    const problems = validateTaxYear(fromEditable(editable, year), { monotonicity: 'skip' });
    assert.ok(problems.length > 0, `${what} should be reported`);
  }
});

test('isUnchanged distinguishes looking from touching', () => {
  const year = getTaxYear('2026-27', 'scotland');

  assert.equal(isUnchanged(toEditable(year), year), true, 'opening the editor changes nothing');

  const edited = toEditable(year);
  edited.incomeTax[0].rateBasisPoints += 1;
  assert.equal(isUnchanged(edited, year), false, 'a single basis point counts as changed');

  const relabelled = toEditable(year);
  relabelled.incomeTax[0].label = 'Starter';
  assert.equal(isUnchanged(relabelled, year), false, 'so does renaming a band');
});

test('the last band stays unbounded however it is edited', () => {
  // A bounded final band would leave the highest incomes untaxed, which the
  // validator catches — but the form should not be able to produce one at all.
  const year = getTaxYear('2026-27', 'scotland');
  const editable = toEditable(year);
  editable.incomeTax.at(-1).toPence = p(200_000);
  editable.nationalInsurance.at(-1).toPence = p(200_000);

  const rebuilt = fromEditable(editable, year);
  assert.equal(rebuilt.incomeTax.bands.at(-1).upToPence, Infinity);
  assert.equal(rebuilt.nationalInsurance.bands.at(-1).upToPence, Infinity);
});

test('an edited year still works end to end', () => {
  const year = getTaxYear('2026-27', 'scotland');
  const editable = toEditable(year);

  // A plausible future change: the starter rate goes up a penny.
  editable.incomeTax[0].rateBasisPoints = 2000;

  const rebuilt = fromEditable(editable, year);
  assert.deepEqual(validateTaxYear(rebuilt, { monotonicity: 'sampled' }), []);
  assert.ok(computeAnnual(p(30_000), rebuilt).netPence < computeAnnual(p(30_000), year).netPence);
});
