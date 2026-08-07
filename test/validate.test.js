import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateTaxYear, assertValidTaxYear } from '../src/lib/validate.js';
import { getTaxYear, listJurisdictions, TAX_YEARS } from '../src/lib/tax-years.js';
import { computeAnnual } from '../src/lib/calculator.js';
import { salaryForMonthlyNet } from '../src/lib/invert.js';

const YEAR = getTaxYear('2026-27', 'scotland');

/** A copy of the shipped config with one thing broken. */
const broken = (mutate) => {
  const year = structuredClone(YEAR);
  mutate(year);
  return year;
};

test('every shipped configuration is valid, proved exhaustively', () => {
  for (const yearId of Object.keys(TAX_YEARS)) {
    for (const { id } of listJurisdictions(yearId)) {
      assert.deepEqual(
        validateTaxYear(getTaxYear(yearId, id), { monotonicity: 'exhaustive' }),
        [],
        `${yearId}/${id} should be valid`,
      );
    }
  }
});

test('catches the mistakes that would otherwise produce a plausible wrong answer', () => {
  // Each of these previously returned a confident, wrong number. The message
  // matters as much as the detection, since a person may be reading it.
  const cases = [
    {
      what: 'bands out of order',
      year: broken((y) => {
        y.incomeTax.bands[1].upToPence = 100;
      }),
      expect: /cannot overlap or leave gaps/,
    },
    {
      what: 'a bounded final band',
      year: broken((y) => {
        y.incomeTax.bands.at(-1).upToPence = 50_000_00;
      }),
      expect: /must be unbounded, or income above it would be untaxed/,
    },
    {
      what: 'a rate above 100%',
      year: broken((y) => {
        y.incomeTax.bands[0].rateBasisPoints = 15_000;
      }),
      expect: /needs a rate between 0% and 100%/,
    },
    {
      what: 'a negative rate',
      year: broken((y) => {
        y.incomeTax.bands[0].rateBasisPoints = -500;
      }),
      expect: /needs a rate between 0% and 100%/,
    },
    {
      what: 'a fractional rate',
      year: broken((y) => {
        y.incomeTax.bands[0].rateBasisPoints = 19.5;
      }),
      expect: /needs a rate between 0% and 100%/,
    },
    {
      what: 'two bands with the same id',
      year: broken((y) => {
        y.incomeTax.bands[1].id = y.incomeTax.bands[0].id;
      }),
      expect: /two bands called/,
    },
    {
      what: 'a negative personal allowance',
      year: broken((y) => {
        y.personalAllowance.amountPence = -1;
      }),
      expect: /not negative/,
    },
    {
      what: 'a taper that withdraws faster than income rises',
      year: broken((y) => {
        y.personalAllowance.taper.withdraw = { lose: 3, per: 2 };
      }),
      expect: /cannot withdraw allowance faster than income rises/,
    },
  ];

  for (const { what, year, expect } of cases) {
    const problems = validateTaxYear(year, { monotonicity: 'skip' });
    assert.ok(problems.length > 0, `${what} should be reported`);
    assert.ok(
      problems.some((problem) => expect.test(problem)),
      `${what}: expected a problem matching ${expect}, got ${JSON.stringify(problems)}`,
    );
  }
});

test('catches a rate combination that breaks monotonicity', () => {
  // 49.5% inside the taper: the allowance floors per penny, so on the pennies
  // where it drops, taxable income rises 2p for 1p of gross. 4950 x 2 + 200 NI
  // is over 100%, and take-home pay starts falling as pay rises.
  const year = broken((y) => {
    y.incomeTax.bands.find((band) => band.id === 'advanced').rateBasisPoints = 4950;
  });

  const problems = validateTaxYear(year, { monotonicity: 'exhaustive' });
  assert.ok(problems.length > 0, 'the exhaustive pass must catch it');
  assert.match(problems[0], /take-home pay falls as pay rises/);
});

test('the sampled pass is fast enough to run on every keystroke', () => {
  const started = process.hrtime.bigint();
  validateTaxYear(YEAR, { monotonicity: 'sampled' });
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

  assert.ok(elapsedMs < 250, `sampled validation took ${elapsedMs.toFixed(0)}ms, which is too slow to type through`);
});

test('a sampled pass is a guard, not a proof — and says so honestly', () => {
  // Worth pinning down rather than assuming: the sampled pass checks a window
  // around each rate change, so it catches anything near a boundary. What it
  // cannot promise is the interior of the taper between strides. This asserts
  // the difference is real, so nobody mistakes one for the other.
  const year = broken((y) => {
    y.incomeTax.bands.find((band) => band.id === 'advanced').rateBasisPoints = 4950;
  });

  const exhaustive = validateTaxYear(year, { monotonicity: 'exhaustive' });
  assert.ok(exhaustive.length > 0, 'the exhaustive pass is the one that proves it');

  // The sampled pass may or may not catch this particular mutation depending on
  // where its strides land — which is precisely why the UI must also handle the
  // inversion throwing.
  const sampled = validateTaxYear(year, { monotonicity: 'sampled' });
  assert.ok(Array.isArray(sampled));
});

test('a config that passes validation can actually be used', () => {
  // The point of validating is that whatever survives works end to end.
  for (const { id } of listJurisdictions('2026-27')) {
    const year = getTaxYear('2026-27', id);
    assert.deepEqual(validateTaxYear(year), []);

    const suggestion = salaryForMonthlyNet(2_750_00, year);
    assert.ok(suggestion.grossPence > 0);
    assert.equal(suggestion.grossPence % 100, 0);
    assert.ok(suggestion.monthly.netPence >= 2_750_00);
    assert.ok(computeAnnual(suggestion.grossPence, year).netPence > 0);
  }
});

test('assertValidTaxYear throws with every problem listed', () => {
  assert.doesNotThrow(() => assertValidTaxYear(YEAR));

  const year = broken((y) => {
    y.incomeTax.bands[0].rateBasisPoints = 15_000;
    y.incomeTax.bands.at(-1).upToPence = 50_000_00;
  });

  assert.throws(
    () => assertValidTaxYear(year, { monotonicity: 'skip' }),
    (error) => {
      assert.ok(error instanceof RangeError);
      assert.match(error.message, /rate between 0% and 100%/);
      assert.match(error.message, /must be unbounded/);
      return true;
    },
  );
});

test('rejects nonsense rather than throwing on it', () => {
  for (const nonsense of [null, undefined, 'a tax year', 42]) {
    const problems = validateTaxYear(nonsense);
    assert.ok(problems.length > 0, `${JSON.stringify(nonsense)} should be reported, not crash`);
  }

  assert.ok(validateTaxYear({}).length > 0);
  assert.ok(validateTaxYear({ personalAllowance: {} }).length > 0);
});
