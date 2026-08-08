# CLAUDE.md

Guidance for Claude Code (and any other contributor) working in this repository.

## Purpose

**Wager** is a static single-page web app that answers one question:

> "I take home £X per month. What gross annual salary is that?"

Nearly every salary calculator goes gross → net. Wager goes the other way, which is
what you actually need when negotiating a salary against a take-home target.

It calculates using the selected jurisdiction's **income tax bands** plus
**UK-wide employee National Insurance**, and presents a full breakdown both per
month and per year. National Insurance can be switched off, so the same question
can be asked of pension income — which is not liable for it at any age. Scotland, England & Northern Ireland, and Wales are all
covered, with Scotland the default. It is an **estimate**, and the page says so
prominently.

The site is deployed to GitHub Pages from this repository.

## Read these first

This file is the **rules**. Two companion documents cover the *why* and the *how*:

- [`docs/architecture.md`](docs/architecture.md) — how the system fits together
  and the seven decisions that shape it. Read before changing anything in
  `src/lib/`.
- [`docs/updating-tax-rates.md`](docs/updating-tax-rates.md) — the procedure for
  changing a tax figure or adding a tax year, including the gross-versus-taxable
  trap that silently over-taxes people. Read before touching
  `src/lib/tax-years.js`.

## Hard constraints

These are not preferences. Breaking any of them breaks the project.

1. **Static only.** No server-side logic. All calculation happens in the browser.
2. **No build step.** The published site is the contents of `src/` copied verbatim
   (plus one generated file, see *Version injection*). No bundler, no transpiler,
   no CSS preprocessor.
3. **No runtime dependencies.** No CDN scripts, no npm packages shipped to the
   browser, no web fonts, no analytics, no network requests of any kind at runtime.
4. **No dev dependencies either.** `package.json` exists only to set
   `"type": "module"` — so the same `.js` files work as ES modules in both the
   browser and Node's test runner — and to name the test command. It has no
   `dependencies`, no `devDependencies`, and there is no lockfile. CI must never
   need `npm install`.
5. **Everything in `src/` is published publicly.** Never put anything there that
   isn't meant to be on the open internet.

## Never commit

- API keys, tokens, credentials, or secrets of any kind
- Email addresses
- Personal names (the `LICENSE` copyright line is the sole exception — it is
  conventional and legally meaningful for MIT, and predates these rules)
- Real salary figures, payslips, or anything else identifying a real person.
  Test fixtures use round synthetic numbers.

CI includes a guard step that fails the build on email-shaped strings under `src/`.
It is a safety net, not a substitute for care.

## Code rules

### Money is always integer pence

Every monetary value in the calculation engine is an **integer number of pence**.
Never use floating-point pounds internally. This avoids drift, makes the bisection
exact, and makes tests deterministic. Convert to pounds only at the formatting
boundary (`src/lib/money.js`).

### Tax data is declarative config, never literals in code

All tax rates, bands, thresholds and allowances live in `src/lib/tax-years.js` as
plain data. Calculation code in `src/lib/calculator.js` reads that config and must
contain **no tax figures at all**. Adding a future tax year must be a data-only
change.

Every tax year entry carries:

- `verifiedOn` — the date the figures were last checked against primary sources
- `sources` — links to the gov.scot / gov.uk / gov.wales pages the figures came from

Both are rendered in the UI so staleness is visible rather than assumed. When you
change any figure, re-verify against the primary source and update `verifiedOn`
in the same commit.

### Income tax bands are stored on a *taxable* basis

gov.scot publishes Scottish bands as ranges of **gross** income, while gov.uk
publishes the rest-of-UK bands as **taxable** income already. The config stores
cumulative limits on **taxable** income (gross minus the personal allowance), so
read each source's own wording rather than assuming. The advanced-rate cumulative limit is **£125,140**, not £112,570 — at
that gross the personal allowance has tapered to zero, so taxable equals gross.
Getting this wrong silently pushes people into the 48% band from about £112.5k.
`test/calculator.test.js` asserts every published gross boundary falls out of the
config; do not weaken those assertions.

### Separation of concerns

`src/app.js` does DOM wiring only and contains no arithmetic. All logic lives in
`src/lib/` so it is fully covered by Node tests without a DOM.

## Testing

```bash
npm test        # or: node --test "test/**/*.test.js"
```

Zero dependencies — Node's built-in test runner and `node:assert/strict`. Runs
locally and in CI identically. Requires Node 20+.

Pass a glob, not a bare `test/` directory: Node 26 no longer accepts a directory
argument to `--test` and tries to load it as a module.

The load-bearing test is the round-trip property in `test/roundtrip.test.js`:
for a sweep of gross values, compute the net, invert it, and assert the result is
both sufficient (`net(g2) >= n`) and minimal (`net(g2 - 1) < n`). The inversion
contract is *"the smallest integer gross whose net is at least the target"* —
tests must pin down minimality, not just sufficiency.

## Version injection

`src/version.js` is a committed **dev stub**. It exists so that opening the site
locally works with no build step, and it must stay a stub — never commit real
build metadata to it.

The deploy workflow regenerates `src/version.js` into the staging directory with
the real version, commit SHA and build time. The footer links to
`https://github.com/mnem/wager/tree/<full-sha>`.

## Commits, branches and PRs

- **Never push directly to `main`.** Every change lands via a pull request.
- Commits are **small and logically grouped** — one coherent change each.
- Commit subjects follow **Conventional Commits** (`feat:`, `fix:`, `chore:`,
  `ci:`, `docs:`, `test:`, `refactor:`). This is not cosmetic: **release notes are
  generated from commit subjects**, so the subject line is the changelog entry.
  Write it for someone reading the release, not for yourself.
- Branch names mirror the commit type: `feat/…`, `chore/…`, `ci/…`, `docs/…`.

### PR review loop

Every PR body **tags `@claude` and asks for a review**. After opening a PR:

1. Wait for the review.
2. Respond to each point — either fix it or explain why not.
3. Push the fixes as their own logically-grouped commits.
4. Post a follow-up comment asking `@claude` for a **re-review**.
5. Merge only once CI is green and review feedback is resolved.

The `@claude` mention must be posted by a human or by a contributor using their own
GitHub auth. A comment posted by a workflow using `GITHUB_TOKEN` will **not**
trigger the Claude workflow — GitHub does not fire workflows from `GITHUB_TOKEN`
events.

## Workflows

| File | Trigger | Does |
|---|---|---|
| `ci.yml` | every PR, push to `main`, `workflow_call` | Runs the test suite, the no-personal-info guard and the no-runtime-dependencies guard |
| `deploy.yml` | push to `main`, manual, `workflow_call` | Stages `src/` → `_site/`, generates `version.js`, deploys to Pages |
| `release.yml` | manual (`workflow_dispatch`) only | Runs CI, tags, generates notes from commit subjects, creates the release, then deploys the tag |
| `claude.yml` | `@claude` mentions on issues/PRs | Runs the Claude review |

### Releases

Releases are **manual only** — run the *Release* workflow from the Actions tab.
It will refuse to run on any branch other than `main`, and refuses to reuse an
existing tag. Given a version (or a `patch`/`minor`/`major` bump), it:

1. runs the full test suite — a red build is never tagged
2. creates and pushes an annotated `vX.Y.Z` tag
3. generates release notes from commit subjects since the previous tag
4. creates the GitHub release
5. deploys that exact tag to Pages, so the footer version matches the release

**Do not** add `on: release: [published]` to `deploy.yml` and delete the
`workflow_call` job. Releases created with `GITHUB_TOKEN` do not trigger further
workflows, so that deploy would never fire. The `workflow_call` chain is
deliberate.

The release job commits as `github-actions[bot]` — never a human identity.

## Layout

```
docs/architecture.md    how it fits together, and why
docs/updating-tax-rates.md  procedure for changing tax figures
src/index.html          the whole UI
src/styles.css
src/app.js              DOM wiring only, no arithmetic
src/version.js          committed dev stub, regenerated at deploy time
src/lib/money.js        pence <-> pounds, parsing, GBP formatting
src/lib/tax-years.js    declarative tax data — no logic
src/lib/calculator.js   gross -> net, with a full breakdown
src/lib/invert.js       net -> gross, by bisection
src/lib/national-insurance.js  the not-charged variant of a tax year
src/lib/validate.js     the invariants the calculator assumes but does not check
src/lib/editable.js     published gross figures <-> stored taxable config
test/*.test.js          node --test
```
