import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  TAX_YEARS,
  DEFAULT_TAX_YEAR_ID,
  DEFAULT_JURISDICTION_ID,
  getTaxYear,
  listTaxYearIds,
  listJurisdictions,
} from '../src/lib/tax-years.js';
import { validateTaxYear } from '../src/lib/validate.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whether a jurisdiction points its rates at another rather than declaring its
 * own. Proving monotonicity again for an identical set of bands would cost two
 * seconds to learn nothing; a separate test asserts the two really do resolve
 * to the same figures, which is the claim that matters.
 */
const mirrorsAnother = (year) =>
  Boolean(TAX_YEARS[year.id].jurisdictions[year.jurisdictionId]?.ratesSameAs);

/**
 * Every (tax year, jurisdiction) pair, resolved through `getTaxYear` — which is
 * also the only shape the calculator ever sees. Testing the resolved form means
 * the invariants below cover the flattening as well as the data.
 */
const ALL_CONFIGS = Object.keys(TAX_YEARS).flatMap((yearId) =>
  listJurisdictions(yearId).map(({ id }) => ({
    name: `${yearId}/${id}`,
    config: getTaxYear(yearId, id),
  })),
);

/**
 * Structural invariants. These run over every configured year and jurisdiction,
 * so adding a malformed one in future is a CI failure rather than a wrong
 * answer.
 */
for (const { name, config: year } of ALL_CONFIGS) {
  test(`${name}: identity and provenance`, () => {
    assert.match(year.startsOn, ISO_DATE);
    assert.match(year.endsOn, ISO_DATE);
    assert.ok(year.endsOn > year.startsOn);
    assert.match(year.label, /^\d{4}\/\d{2}$/);

    assert.ok(year.jurisdictionId, 'a resolved year names its jurisdiction');
    assert.ok(year.jurisdiction, 'and carries a human-readable label');
    assert.ok(year.appliesTo, 'and says who it applies to, so people can check');

    assert.match(year.verifiedOn, ISO_DATE, 'verifiedOn is required — see CLAUDE.md');
    assert.ok(Array.isArray(year.sources) && year.sources.length > 0, 'sources are required');
    for (const source of year.sources) {
      assert.ok(source.label, 'every source needs a label');
      assert.match(source.url, /^https:\/\/(www\.)?gov\.(uk|scot|wales)\//, 'sources must be primary');
    }
  });

  test(`${name}: is a usable tax year`, { skip: mirrorsAnother(year) && 'rates mirror another jurisdiction, proved there' }, () => {
    // The structural invariants and the monotonicity property live in
    // src/lib/validate.js rather than here, so that the tests and the UI check
    // exactly the same things. Duplicating them would let the two drift, and
    // the UI's copy is the one a person can break.
    //
    // Exhaustive rather than sampled: for a committed config this is a proof,
    // and it is what earns the right to ship a sampled check at runtime.
    assert.deepEqual(validateTaxYear(year, { monotonicity: 'exhaustive' }), []);
  });

  test(`${name}: published gross bands agree with the taxable bands`, () => {
    // publishedBands is the official table as GROSS ranges. This is the test
    // that makes carrying both representations safe.
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
        `${band.id}: the published gross limit and the configured taxable limit disagree`,
      );
    });
  });
}

/* Figures, pinned ---------------------------------------------------------- */

test('2026-27 Scotland matches the figures published by gov.scot', () => {
  // Spelled out in pounds so a mistyped threshold is obvious on review, and so
  // this test can be checked against the source page by eye.
  const year = getTaxYear('2026-27', 'scotland');
  const pounds = (pence) => pence / 100;

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
});

test('Wales resolves to exactly the same rates as England and Northern Ireland', () => {
  // Wales sets its own rates; for 2026/27 the Senedd chose figures identical to
  // England and Northern Ireland. The config points at them rather than copying
  // them, so this asserts the indirection resolves rather than that someone
  // transcribed the numbers twice correctly.
  const wales = getTaxYear('2026-27', 'wales');
  const englandNi = getTaxYear('2026-27', 'england-ni');

  assert.deepEqual(wales.incomeTax, englandNi.incomeTax);
  assert.deepEqual(wales.publishedBands, englandNi.publishedBands);

  // But it is still its own jurisdiction, with its own sources and its own
  // explanation of why the figures currently coincide.
  assert.equal(wales.jurisdictionId, 'wales');
  assert.equal(wales.jurisdiction, 'Wales');
  assert.notDeepEqual(wales.sources, englandNi.sources);
  assert.match(wales.sources[0].url, /gov\.wales/);
  assert.ok(wales.ratesNote, 'Wales must explain that its rates merely match, rather than looking coincidental');
  assert.equal(englandNi.ratesNote, null, 'a jurisdiction setting its own rates needs no such note');
});

test('a jurisdiction cannot point its rates at a missing or chained target', () => {
  // One level of indirection only. A chain would make it hard to see which
  // figures actually apply, which is the problem the pointer exists to avoid.
  const jurisdictions = TAX_YEARS['2026-27'].jurisdictions;

  jurisdictions['test-dangling'] = { id: 'test-dangling', label: 'x', appliesTo: 'x', sources: [], ratesSameAs: 'narnia' };
  jurisdictions['test-chained'] = { id: 'test-chained', label: 'x', appliesTo: 'x', sources: [], ratesSameAs: 'wales' };

  try {
    assert.throws(() => getTaxYear('2026-27', 'test-dangling'), /does not exist/);
    assert.throws(() => getTaxYear('2026-27', 'test-chained'), /points somewhere else again/);
  } finally {
    delete jurisdictions['test-dangling'];
    delete jurisdictions['test-chained'];
  }
});

test('2026-27 England and Northern Ireland match the figures published by gov.uk', () => {
  // gov.uk publishes these as TAXABLE income, so unlike the Scottish table
  // these numbers need no conversion — £37,700 is printed on the page.
  const year = getTaxYear('2026-27', 'england-ni');
  const pounds = (pence) => pence / 100;

  assert.deepEqual(
    year.incomeTax.bands.map((band) => [
      band.id,
      band.rateBasisPoints,
      band.upToPence === Infinity ? null : pounds(band.upToPence),
    ]),
    [
      ['basic', 2000, 37_700],
      ['higher', 4000, 125_140],
      ['additional', 4500, null],
    ],
  );

  assert.deepEqual(
    year.publishedBands.map((band) => [
      band.id,
      pounds(band.fromPence),
      band.toPence === null ? null : pounds(band.toPence),
    ]),
    [
      ['basic', 12_571, 50_270],
      ['higher', 50_271, 125_140],
      ['additional', 125_141, null],
    ],
  );
});

test('the personal allowance and National Insurance are identical everywhere', () => {
  // Both are reserved to Westminster. Storing them once on the year rather than
  // per jurisdiction is what guarantees this, so the test is really asserting
  // that the flattening does not accidentally diverge them.
  const [first, ...rest] = ALL_CONFIGS.map(({ config }) => config);
  for (const other of rest) {
    assert.deepEqual(other.personalAllowance, first.personalAllowance);
    assert.deepEqual(other.nationalInsurance, first.nationalInsurance);
  }

  const pounds = (pence) => pence / 100;
  assert.equal(pounds(first.personalAllowance.amountPence), 12_570);
  assert.equal(pounds(first.personalAllowance.taper.thresholdPence), 100_000);
  assert.deepEqual(
    first.nationalInsurance.bands.map((band) => [
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

test('the allowance taper reaches zero exactly where the highest band begins', () => {
  // This is the relationship that makes the Scottish advanced limit £125,140
  // rather than £112,570 — and the same relationship puts the rest-of-UK higher
  // band's limit at £125,140 too.
  for (const { name, config: year } of ALL_CONFIGS) {
    const { amountPence, taper } = year.personalAllowance;
    const allowanceGoneAt =
      taper.thresholdPence + (amountPence * taper.withdraw.per) / taper.withdraw.lose;

    assert.equal(allowanceGoneAt, 12_514_000, `${name}: the allowance is exhausted at £125,140`);

    const penultimate = year.incomeTax.bands.at(-2);
    assert.equal(
      penultimate.upToPence,
      allowanceGoneAt,
      `${name}: ${penultimate.id} must end where the allowance runs out, so taxable equals gross there`,
    );
  }
});

/* Lookup ------------------------------------------------------------------- */

test('getTaxYear defaults to Scotland and rejects unknown ids', () => {
  assert.equal(getTaxYear().id, DEFAULT_TAX_YEAR_ID);
  assert.equal(getTaxYear().jurisdictionId, DEFAULT_JURISDICTION_ID);
  assert.equal(getTaxYear().jurisdiction, 'Scotland');

  assert.equal(getTaxYear('2026-27', 'england-ni').jurisdictionId, 'england-ni');

  assert.throws(() => getTaxYear('1999-00'), RangeError);
  assert.throws(() => getTaxYear('2026-27', 'narnia'), RangeError);
  assert.throws(() => getTaxYear(null), RangeError);
});

test('getTaxYear puts the jurisdiction source before the UK-wide one', () => {
  // The most specific reference should be the first a reader sees.
  const scotland = getTaxYear('2026-27', 'scotland');
  assert.match(scotland.sources[0].url, /gov\.scot/);
  assert.match(scotland.sources.at(-1).url, /gov\.uk/);
  assert.equal(scotland.sources.length, 2);
});

test('listJurisdictions describes what is available', () => {
  assert.deepEqual(listJurisdictions('2026-27'), [
    { id: 'scotland', label: 'Scotland' },
    { id: 'england-ni', label: 'England & Northern Ireland' },
    { id: 'wales', label: 'Wales' },
  ]);
  assert.throws(() => listJurisdictions('1999-00'), RangeError);
});

test('the default tax year is configured', () => {
  assert.ok(TAX_YEARS[DEFAULT_TAX_YEAR_ID], 'DEFAULT_TAX_YEAR_ID must name a real year');
  assert.deepEqual(listTaxYearIds(), Object.keys(TAX_YEARS).sort().reverse());
  assert.equal(listTaxYearIds()[0], DEFAULT_TAX_YEAR_ID, 'the default should be the most recent year');
});
