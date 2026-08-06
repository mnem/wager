import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  TAX_YEARS,
  DEFAULT_TAX_YEAR_ID,
  getTaxYear,
  listTaxYearIds,
} from '../src/lib/tax-years.js';
import { computeAnnual } from '../src/lib/calculator.js';

const ALL_YEARS = Object.entries(TAX_YEARS);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Structural invariants. These run over every configured year, so adding a
 * malformed tax year in future is a CI failure rather than a wrong answer.
 */
for (const [id, year] of ALL_YEARS) {
  test(`${id}: identity and provenance`, () => {
    assert.equal(year.id, id, 'id must match its key');
    assert.equal(year.jurisdiction, 'Scotland');
    assert.match(year.startsOn, ISO_DATE);
    assert.match(year.endsOn, ISO_DATE);
    assert.ok(year.endsOn > year.startsOn);
    assert.match(year.label, /^\d{4}\/\d{2}$/);

    assert.match(year.verifiedOn, ISO_DATE, 'verifiedOn is required — see CLAUDE.md');
    assert.ok(Array.isArray(year.sources) && year.sources.length > 0, 'sources are required');
    for (const source of year.sources) {
      assert.ok(source.label, 'every source needs a label');
      assert.match(source.url, /^https:\/\/(www\.)?gov\.(uk|scot)\//, 'sources must be primary');
    }
  });

  test(`${id}: personal allowance`, () => {
    const { amountPence, taper } = year.personalAllowance;
    assert.ok(Number.isSafeInteger(amountPence) && amountPence > 0);
    assert.ok(Number.isSafeInteger(taper.thresholdPence) && taper.thresholdPence > amountPence);
    assert.ok(Number.isSafeInteger(taper.withdraw.lose) && taper.withdraw.lose > 0);
    assert.ok(Number.isSafeInteger(taper.withdraw.per) && taper.withdraw.per >= taper.withdraw.lose);
  });

  for (const scheme of ['incomeTax', 'nationalInsurance']) {
    test(`${id}: ${scheme} bands are well formed`, () => {
      const { appliesTo, bands } = year[scheme];
      assert.ok(['taxable', 'gross'].includes(appliesTo));
      assert.ok(bands.length > 0);

      const ids = bands.map((band) => band.id);
      assert.equal(new Set(ids).size, ids.length, 'band ids must be unique');

      let previousLimit = 0;
      for (const band of bands) {
        assert.ok(band.id, 'every band needs an id');
        assert.ok(band.label, `band ${band.id} needs a label`);
        assert.ok(
          Number.isSafeInteger(band.rateBasisPoints) &&
            band.rateBasisPoints >= 0 &&
            band.rateBasisPoints < 10_000,
          `band ${band.id} rate must be integer basis points below 100%`,
        );
        assert.ok(
          band.upToPence > previousLimit,
          `band ${band.id} limit must exceed the previous one — no gaps, no overlaps`,
        );
        if (Number.isFinite(band.upToPence)) {
          assert.ok(Number.isSafeInteger(band.upToPence), `band ${band.id} limit must be integer pence`);
        }
        previousLimit = band.upToPence;
      }

      assert.equal(
        bands.at(-1).upToPence,
        Infinity,
        'the final band must be unbounded, or income above it would be untaxed',
      );
    });
  }

  test(`${id}: one more penny of gross never costs more than one penny`, () => {
    // The property the net-to-gross inversion rests on. Bisection is only valid
    // while net pay never falls as gross pay rises, which holds exactly when a
    // penny of gross costs at most a penny of deductions.
    //
    // This is asserted directly rather than through a closed-form bound on the
    // rates, because every simple bound is wrong in one direction or the other:
    //
    //   - The AVERAGE taper multiplier (per + lose) / per = 1.5 is too loose.
    //     personalAllowanceFor floors the taper, so the allowance drops in
    //     whole-penny steps rather than smoothly; on the pennies where it
    //     drops, taxable income rises by 2p for 1p of gross, not 1.5p.
    //
    //   - Taking the independent maxima of the tax and NI rates is too strict.
    //     The largest NI rate here is the 8% main rate, but that only applies
    //     below the upper earnings limit, where the top rate of income tax
    //     cannot apply. 48% and 8% never coexist, so combining them invents a
    //     failure that no income can produce.
    //
    // Checking the actual function around every rate change avoids having to
    // encode which rates can coexist, and stays correct if a future year
    // reshapes the bands entirely.
    const { amountPence, taper } = year.personalAllowance;
    const taperEndsAt = taper.thresholdPence + (amountPence * taper.withdraw.per) / taper.withdraw.lose;

    const rateChanges = new Set([0, amountPence, taper.thresholdPence, taperEndsAt]);
    for (const band of year.nationalInsurance.bands) {
      if (Number.isFinite(band.upToPence)) rateChanges.add(band.upToPence);
    }
    for (const band of year.incomeTax.bands) {
      if (!Number.isFinite(band.upToPence)) continue;
      // Income tax limits are on taxable income; the corresponding gross is the
      // limit plus whatever allowance survives, which is the full allowance
      // below the taper and nothing above it.
      rateChanges.add(band.upToPence + amountPence);
      rateChanges.add(band.upToPence);
    }

    const deductionsAt = (grossPence) => computeAnnual(grossPence, year).totalDeductionsPence;

    for (const point of rateChanges) {
      for (let gross = Math.max(0, point - 300); gross <= point + 300; gross += 1) {
        const cost = deductionsAt(gross + 1) - deductionsAt(gross);
        assert.ok(
          cost >= 0 && cost <= 1,
          `at gross ${gross} one more penny cost ${cost}p in deductions`,
        );
      }
    }

    // The taper is swept exhaustively rather than sampled.
    //
    // Review raised this: a stride is a spot check, not a proof. The pennies
    // that violate the property are those where the running charge crosses a
    // rounding boundary, and how often that happens depends on the rates. For
    // some future rate the pattern could repeat with a period longer than the
    // number of samples a fixed stride can take across a bounded range, so the
    // one bad penny could sit between two samples.
    //
    // The taper is finite — 2,514,000 pennies for this config — so there is no
    // need to sample it at all. Checking every penny costs a few seconds and
    // turns the strongest guarantee in the suite from "probably" into "always".
    // Walk once carrying the previous value, so it is one calculation per penny
    // rather than two.
    let previousDeductions = deductionsAt(taper.thresholdPence);
    for (let gross = taper.thresholdPence + 1; gross <= taperEndsAt; gross += 1) {
      const deductions = deductionsAt(gross);
      const cost = deductions - previousDeductions;
      assert.ok(
        cost >= 0 && cost <= 1,
        `in the taper, going from gross ${gross - 1} to ${gross} cost ${cost}p in deductions`,
      );
      previousDeductions = deductions;
    }
  });

  test(`${id}: published gross bands agree with the taxable bands`, () => {
    // publishedBands duplicates gov.scot's official gross table for display.
    // This is the test that makes the duplication safe.
    const { bands } = year.incomeTax;
    const published = year.publishedBands;
    const allowance = year.personalAllowance.amountPence;
    const { thresholdPence, withdraw } = year.personalAllowance.taper;
    const allowanceGoneAtPence = thresholdPence + (allowance * withdraw.per) / withdraw.lose;

    assert.deepEqual(
      published.map((b) => b.id),
      bands.map((b) => b.id),
      'published bands must cover exactly the same bands, in the same order',
    );

    assert.equal(published[0].fromPence, allowance + 100, 'the first band starts one pound above the allowance');

    published.forEach((publishedBand, index) => {
      const band = bands[index];
      const previous = published[index - 1];

      if (previous) {
        assert.equal(
          publishedBand.fromPence,
          previous.toPence + 100,
          `${band.id} must start one pound after ${previous.id} ends — no gaps`,
        );
      }

      if (publishedBand.toPence === null) {
        assert.equal(band.upToPence, Infinity, `${band.id} is unbounded in both representations`);
        return;
      }

      // Convert the published gross limit to taxable income. Below the taper
      // threshold that is simply gross minus the full allowance; at or above
      // the point the allowance is exhausted, taxable income equals gross.
      const grossLimit = publishedBand.toPence;
      const expectedTaxable =
        grossLimit >= allowanceGoneAtPence ? grossLimit : grossLimit - allowance;

      assert.equal(
        band.upToPence,
        expectedTaxable,
        `${band.id}: gov.scot's gross limit and the configured taxable limit disagree`,
      );
    });
  });
}

test('2026-27 matches the figures published by gov.scot and gov.uk', () => {
  // Spelled out in pounds so a mistyped threshold is obvious on review, and so
  // this test can be checked against the source pages by eye.
  const year = getTaxYear('2026-27');
  const pounds = (pence) => pence / 100;

  assert.equal(pounds(year.personalAllowance.amountPence), 12_570);
  assert.equal(pounds(year.personalAllowance.taper.thresholdPence), 100_000);

  assert.deepEqual(
    year.publishedBands.map((band) => [
      band.id,
      pounds(band.fromPence),
      band.toPence === null ? null : pounds(band.toPence),
    ]),
    [
      ['starter', 12_571, 16_537],
      ['basic', 16_538, 29_526],
      ['intermediate', 29_527, 43_662],
      ['higher', 43_663, 75_000],
      ['advanced', 75_001, 125_140],
      ['top', 125_141, null],
    ],
  );

  assert.deepEqual(
    year.incomeTax.bands.map((band) => [band.id, band.rateBasisPoints]),
    [
      ['starter', 1900],
      ['basic', 2000],
      ['intermediate', 2100],
      ['higher', 4200],
      ['advanced', 4500],
      ['top', 4800],
    ],
  );

  assert.deepEqual(
    year.nationalInsurance.bands.map((band) => [
      band.id,
      band.rateBasisPoints,
      band.upToPence === Infinity ? null : pounds(band.upToPence),
    ]),
    [
      ['below-pt', 0, 12_570],
      ['main', 800, 50_270],
      ['upper', 200, null],
    ],
  );
});

test('the allowance taper reaches zero exactly where the top rate begins', () => {
  // This is the relationship that makes the advanced-rate limit £125,140 rather
  // than £112,570. If it ever stops holding, the config needs rethinking rather
  // than patching.
  const year = getTaxYear('2026-27');
  const { amountPence, taper } = year.personalAllowance;
  const allowanceGoneAt =
    taper.thresholdPence + (amountPence * taper.withdraw.per) / taper.withdraw.lose;

  assert.equal(allowanceGoneAt, 12_514_000, 'the allowance is exhausted at £125,140');
  assert.equal(
    year.incomeTax.bands.find((b) => b.id === 'advanced').upToPence,
    allowanceGoneAt,
    'the advanced band ends where the allowance runs out, so taxable equals gross there',
  );
});

test('getTaxYear defaults, looks up and rejects unknown ids', () => {
  assert.equal(getTaxYear().id, DEFAULT_TAX_YEAR_ID);
  assert.equal(getTaxYear('2026-27').id, '2026-27');
  assert.throws(() => getTaxYear('1999-00'), RangeError);
  assert.throws(() => getTaxYear(null), RangeError);
});

test('the default tax year is configured', () => {
  assert.ok(TAX_YEARS[DEFAULT_TAX_YEAR_ID], 'DEFAULT_TAX_YEAR_ID must name a real year');
  assert.deepEqual(listTaxYearIds(), Object.keys(TAX_YEARS).sort().reverse());
  assert.equal(listTaxYearIds()[0], DEFAULT_TAX_YEAR_ID, 'the default should be the most recent year');
});
