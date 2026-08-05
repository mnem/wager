import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  TAX_YEARS,
  DEFAULT_TAX_YEAR_ID,
  getTaxYear,
  listTaxYearIds,
} from '../src/lib/tax-years.js';

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
    assert.ok(taper.lossPerPound > 0 && taper.lossPerPound <= 1);
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
        assert.ok(band.rate >= 0 && band.rate < 1, `band ${band.id} rate must be a fraction below 1`);
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

  test(`${id}: total marginal deduction stays below 100%`, () => {
    // The inversion relies on net(gross) being strictly increasing. If the top
    // income tax rate plus the top NI rate plus the allowance taper ever
    // reached 100%, earning more would not increase take-home pay and there
    // would be no unique answer to invert to.
    const topTaxRate = Math.max(...year.incomeTax.bands.map((b) => b.rate));
    const topNiRate = Math.max(...year.nationalInsurance.bands.map((b) => b.rate));
    const taperMultiplier = 1 + year.personalAllowance.taper.lossPerPound;

    assert.ok(
      topTaxRate * taperMultiplier + topNiRate < 1,
      'worst-case marginal deduction must stay below 100%',
    );
  });

  test(`${id}: published gross bands agree with the taxable bands`, () => {
    // publishedBands duplicates gov.scot's official gross table for display.
    // This is the test that makes the duplication safe.
    const { bands } = year.incomeTax;
    const published = year.publishedBands;
    const allowance = year.personalAllowance.amountPence;
    const { thresholdPence, lossPerPound } = year.personalAllowance.taper;
    const allowanceGoneAtPence = thresholdPence + allowance / lossPerPound;

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
    year.incomeTax.bands.map((band) => [band.id, band.rate]),
    [
      ['starter', 0.19],
      ['basic', 0.2],
      ['intermediate', 0.21],
      ['higher', 0.42],
      ['advanced', 0.45],
      ['top', 0.48],
    ],
  );

  assert.deepEqual(
    year.nationalInsurance.bands.map((band) => [
      band.id,
      band.rate,
      band.upToPence === Infinity ? null : pounds(band.upToPence),
    ]),
    [
      ['below-pt', 0, 12_570],
      ['main', 0.08, 50_270],
      ['upper', 0.02, null],
    ],
  );
});

test('the allowance taper reaches zero exactly where the top rate begins', () => {
  // This is the relationship that makes the advanced-rate limit £125,140 rather
  // than £112,570. If it ever stops holding, the config needs rethinking rather
  // than patching.
  const year = getTaxYear('2026-27');
  const { amountPence, taper } = year.personalAllowance;
  const allowanceGoneAt = taper.thresholdPence + amountPence / taper.lossPerPound;

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
