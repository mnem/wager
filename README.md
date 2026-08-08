# wager

**What gross salary do I need to take home £X a month?**

A small static web app that works backwards from a monthly net (take-home) wage to
the equivalent gross annual salary, using the **income tax bands where you live**
and UK-wide employee **National Insurance**.

Covers **Scotland**, **England & Northern Ireland**, and **Wales** — listed
separately because Wales sets its own rates, even in years like this one where
it chooses figures identical to England's.

Most salary calculators go gross → net. This one goes the other way — which is what
you need when you're negotiating against a take-home target.

👉 **<https://mnem.github.io/wager/>**

## What it does

- Enter a monthly net wage, get the gross annual salary that produces it
- Pick the jurisdiction you live in — the bands differ across the UK
- Switch National Insurance off to work out what a **pension** needs to pay.
  Pension income isn't liable for it, and nor are earnings after State Pension
  age — but income tax still applies to both
- Full breakdown of the calculation, shown both **per month** and **per year**:
  personal allowance (including the taper above £100,000), every income tax band
  used, National Insurance, total deductions and net pay
- Effective and marginal deduction rates
- Light, dark or system colour scheme
- An escape hatch: if the rates change before this app is updated, you can enter
  the new figures yourself. The page says loudly when you have, and a reload
  restores the published ones.

## Important

This is an **estimate**. It uses the income tax rates and bands of whichever
jurisdiction you select, which apply to earned income based on where your main
home is.

It deliberately does **not** model pension contributions, salary sacrifice, student
or postgraduate loans, benefits in kind, non-standard tax codes, the marriage or
blind person's allowance, or savings and dividend income (which is taxed at
UK-wide rates even for Scottish taxpayers). While National Insurance is being
deducted it is calculated annually, whereas real payroll calculates it per pay
period, so a real payslip may differ slightly.

Don't use it for anything that matters without checking the numbers yourself. The
page links to the official sources the figures come from — gov.scot, gov.uk or
gov.wales, depending on which jurisdiction you pick — and shows the date they
were last verified.

## Development

No build step, no dependencies. Open `src/index.html` in a browser, or serve the
folder:

```bash
python3 -m http.server -d src 8000
```

Run the tests (Node 20+, nothing to install):

```bash
npm test
```

## Documentation

| | |
|---|---|
| [CLAUDE.md](CLAUDE.md) | The rules: hard constraints, code standards, commit and release process |
| [docs/architecture.md](docs/architecture.md) | How it fits together, and the reasoning behind each design decision |
| [docs/updating-tax-rates.md](docs/updating-tax-rates.md) | How to change a tax figure or add a tax year, and how to verify you got it right |

**If you are here to update the tax rates**, go straight to
[docs/updating-tax-rates.md](docs/updating-tax-rates.md) — there is one
conversion that is easy to get wrong and silently over-taxes anyone earning
over about £112,500.

## Licence

MIT — see [LICENSE](LICENSE).
