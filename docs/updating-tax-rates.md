# Updating tax rates

Every tax figure lives in [`src/lib/tax-years.js`](../src/lib/tax-years.js).
Nothing else needs to change — not the calculator, not the UI, not the tests'
structure. If you find yourself editing a figure anywhere else, stop: that is a
bug, not a task.

Read [architecture.md](architecture.md) first if you haven't. The one thing you
must understand before touching a threshold is [the gross-versus-taxable
distinction](#the-trap-gross-versus-taxable).

---

## The trap: gross versus taxable

**gov.scot publishes bands as ranges of gross income. The config stores
cumulative limits on taxable income.** Taxable income is gross minus the
personal allowance.

For most bands the conversion is simply *subtract the personal allowance*:

```
starter rate ends at £16,537 gross
              £16,537 − £12,570 = £3,967 taxable   →   upToPence: 396_700
```

**But not for the top two.** Above £100,000 the personal allowance is withdrawn
by £1 for every £2 of income, so it reaches zero at:

```
£100,000 + (£12,570 × 2) = £125,140
```

At £125,140 the allowance is *already zero*, so **taxable income equals gross
income**. The advanced-rate cumulative limit is therefore **£125,140**, not
£112,570.

> Writing £112,570 here is the single most damaging mistake you can make in this
> file. It silently starts the 48% top rate about £12,570 of gross too early, so
> anyone earning over ~£112.5k is over-deducted. It is invisible below that
> income, which is exactly why it survives — a well-known third-party calculator
> has this bug today, and `test/calculator.test.js` reproduces its figures
> exactly by injecting the error.

## Where the figures come from

Only primary sources. A test enforces that every `sources` URL is on `gov.uk`,
`gov.scot` or `gov.wales`.

| What | Where |
|---|---|
| Scottish income tax rates and bands | <https://www.gov.scot/publications/scottish-income-tax-rates-and-bands/> |
| Personal allowance, NI thresholds and rates | <https://www.gov.uk/guidance/rates-and-thresholds-for-employers-2026-to-2027> (change the year in the URL) |
| England and Northern Ireland income tax | <https://www.gov.uk/government/publications/rates-and-allowances-income-tax/income-tax-rates-and-allowances-current-and-past> |
| Welsh rates of income tax | <https://www.gov.wales/welsh-rates-income-tax> |

Note the sources publish on **different bases**: gov.scot gives gross ranges,
gov.uk gives taxable ranges already. Read the page's own wording each time
rather than assuming — this is the single most likely place to introduce a
wrong figure.

---

## Procedure: correcting a figure in an existing year

Use this when a rate was mistyped, or a threshold changed after the fact.

1. **Open the primary source and read the figure off it.** Don't trust the
   existing comment in the file, and don't trust a third-party calculator.
2. **Convert gross to taxable** if it is an income tax band — see
   [the trap](#the-trap-gross-versus-taxable). Multiply by 100 for pence.
3. **Update both representations.** `incomeTax.bands[].upToPence` (taxable) and
   the matching `publishedBands[]` entry (gross). They are cross-checked by a
   test, so changing only one fails CI — that is the point of the duplication.

   If the figure is one of the bands in [the worked example](#worked-example--the-202627-scottish-bands)
   below, update that table too. A CI step checks it against `tax-years.js`, so
   a stale example fails the build rather than misleading the next reader.
4. **Update `verifiedOn`** to today's date, in the same commit. Never change a
   figure without doing this.
5. **Run the tests**, and read [what the failures mean](#what-the-test-failures-mean).
6. **Mutation-test your change** — see [below](#mutation-testing).
7. Commit as `fix:` with the source in the message, and open a PR as usual.

## Procedure: adding a new tax year

Adding a year is a **data-only change**. If it isn't, something has gone wrong.

1. Copy the most recent entry in `TAX_YEARS` and change its key, `id`, `label`,
   `startsOn` and `endsOn`.
2. Work through the **year-level** figures, which are reserved to Westminster
   and therefore the same in every jurisdiction:
   - personal allowance amount and taper threshold
   - each NI band's rate and cumulative **gross** limit
3. Then, for **each jurisdiction** under `jurisdictions`:
   - each income tax band's rate (**basis points**: 19% is `1900`) and
     cumulative **taxable** limit
   - `publishedBands` — the official gross table, for display
   - that jurisdiction's own `sources`
4. Set `verifiedOn` and `ukSources`.
5. Update `DEFAULT_TAX_YEAR_ID` if this is now the current year.
6. Run the tests. The structural invariants run over *every* configured year and
   jurisdiction, so a malformed new entry fails CI rather than producing wrong
   answers.
7. Mutation-test, cross-check, commit, PR.

> **Do not duplicate the personal allowance or National Insurance per
> jurisdiction.** They are reserved to Westminster and identical everywhere, so
> they live on the year itself. A test asserts every jurisdiction resolves to
> the same values — duplicating them would create two places for one figure to
> go wrong.

> **Check Wales separately each year.** Wales sets its own rates: the UK rates
> are reduced by 10p for Welsh taxpayers and the Senedd sets a Welsh rate for
> each band. It is listed as its own jurisdiction for that reason, even in years
> like 2026/27 where it picks figures identical to England and Northern Ireland.
>
> While they match, the Welsh entry carries `ratesSameAs: 'england-ni'` instead
> of a copy of the bands, so there is one set of numbers to keep right. **The
> year Wales diverges, replace `ratesSameAs` with its own `incomeTax` and
> `publishedBands`** — and update `ratesNote`, which is shown on the page to
> explain why the figures currently coincide.

### Worked example — the 2026/27 Scottish bands

What gov.scot publishes, and what goes in the file:

| Band | Rate | Published gross range | `rateBasisPoints` | `upToPence` (taxable) |
|---|---|---|---|---|
| Starter | 19% | £12,571 – £16,537 | `1900` | `396_700` |
| Basic | 20% | £16,538 – £29,526 | `2000` | `1_695_600` |
| Intermediate | 21% | £29,527 – £43,662 | `2100` | `3_109_200` |
| Higher | 42% | £43,663 – £75,000 | `4200` | `6_243_000` |
| Advanced | 45% | £75,001 – £125,140 | `4500` | `12_514_000` |
| Top | 48% | Over £125,140 | `4800` | `Infinity` |

> The advanced row is the one to double-check: **`12_514_000`, not `11_257_000`.**
> See [the trap](#the-trap-gross-versus-taxable).

This table is checked against `src/lib/tax-years.js` by CI, so it cannot quietly
go stale — but that check is only as good as the config it compares against, so
it is not a substitute for reading the source pages.

The arithmetic for each:

```
16,537 − 12,570 =  3,967  → 396_700
29,526 − 12,570 = 16,956  → 1_695_600
43,662 − 12,570 = 31,092  → 3_109_200
75,000 − 12,570 = 62,430  → 6_243_000
125,140                   → 12_514_000   allowance is already zero here
```

National Insurance, charged on gross, so no conversion:

| Band | Rate | `rateBasisPoints` | `upToPence` (gross) |
|---|---|---|---|
| Below primary threshold | 0% | `0` | `1_257_000` (£12,570) |
| Main rate | 8% | `800` | `5_027_000` (£50,270) |
| Above upper earnings limit | 2% | `200` | `Infinity` |

---

## Verifying your change

### Run the tests

```bash
npm test
```

### What the test failures mean

| Failure | What you got wrong |
|---|---|
| `published gross bands agree with the taxable bands` | The gross table and the taxable limits disagree — you updated one and not the other, or converted wrongly |
| `the allowance taper reaches zero exactly where the top rate begins` | The advanced limit no longer equals `threshold + allowance × 2`. Usually the £112,570 mistake |
| `matches the figures published by gov.scot and gov.uk` | A figure differs from the pinned expectation. Update the test **only** after confirming against the source |
| `income tax band boundaries match the published gross figures` | A boundary no longer falls where the published table says |
| `bands are well formed` | Limits out of order, a rate outside 0–100%, a non-integer, or the last band is not `Infinity` |
| `one more penny of gross never costs more than one penny` | **Stop.** A rate combination breaks monotonicity, so net pay can fall as gross rises and the whole inversion is invalid. See below |
| `known salaries produce the expected breakdown` | Expected — the answers changed. Recompute by hand and update |
| round-trip failures | Almost always downstream of the monotonicity failure. Fix that first |

### If the monotonicity guard fails

This is the serious one. It means some penny of gross costs 2p or more in
deductions, so take-home pay *falls* as pay rises — and the net→gross inversion
has no unique answer.

It happens when a marginal rate combination reaches 100%. Remember the allowance
taper multiplies the effective rate: inside the taper, one pound of gross adds
**two** pence of taxable income per penny on the pennies where the allowance
steps down, so a 49.5% band plus 2% NI is already over the line.

If a genuine published rate ever triggers this, the config schema needs
rethinking — do not weaken the test.

### Mutation testing

Confirm your figures are actually *load-bearing*. Temporarily break each one and
check a test fails:

```bash
cp src/lib/tax-years.js /tmp/backup.js

# The classic error: the advanced limit as £112,570
perl -i -pe "s/upToPence: 12_514_000/upToPence: 11_257_000/" src/lib/tax-years.js
npm test   # must fail

cp /tmp/backup.js src/lib/tax-years.js && npm test   # must pass again
```

If a figure can be changed without any test failing, it isn't covered — add an
assertion before you commit.

### Cross-check against an independent calculator

Take three salaries spanning the bands — one below £43,662, one between there
and £100,000, and one **above £125,140** — and compare against a reputable
calculator. Record the comparison in the PR.

Expect the high one to disagree. When we did this, the third-party calculator
was wrong, not us. Work out *which* by injecting the suspected error into a
cloned config and seeing whether it reproduces their figure exactly:

```js
const withError = structuredClone(YEAR);
withError.incomeTax.bands.find((b) => b.id === 'advanced').upToPence = 11_257_000;
computeAnnual(p(126_000), withError).netPence; // matched theirs to the penny
```

Never change our figures to match a third party without establishing which is
right from the primary source.

---

## Checklist before opening the PR

- [ ] Every figure read off a `gov.uk`, `gov.scot` or `gov.wales` page, today
- [ ] Gross → taxable conversion done, and the advanced limit is the point where
      the allowance hits zero
- [ ] `incomeTax.bands` **and** `publishedBands` both updated
- [ ] `verifiedOn` updated in the same commit
- [ ] `sources` links point at the pages you actually read
- [ ] `npm test` passes
- [ ] Each changed figure mutation-tested
- [ ] Cross-checked against an independent calculator, with the comparison in the
      PR body
- [ ] No tax figures added outside `src/lib/tax-years.js`

Then open the PR, tag `@claude`, and ask specifically for the figures to be
verified against the linked sources rather than against your table.
