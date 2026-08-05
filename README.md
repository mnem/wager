# wager

**What gross salary do I need to take home £X a month?**

A small static web app that works backwards from a monthly net (take-home) wage to
the equivalent gross annual salary, using **Scottish income tax bands** and UK-wide
employee **National Insurance**.

Most salary calculators go gross → net. This one goes the other way — which is what
you need when you're negotiating against a take-home target.

👉 **<https://mnem.github.io/wager/>**

## What it does

- Enter a monthly net wage, get the gross annual salary that produces it
- Full breakdown of the calculation, shown both **per month** and **per year**:
  personal allowance (including the taper above £100,000), every income tax band
  used, National Insurance, total deductions and net pay
- Effective and marginal deduction rates

## Important

This is an **estimate**. It uses Scottish income tax rates and bands, which apply
to earned income if your main home is in Scotland.

It deliberately does **not** model pension contributions, salary sacrifice, student
or postgraduate loans, benefits in kind, non-standard tax codes, the marriage or
blind person's allowance, or savings and dividend income (which is taxed at
UK-wide rates even for Scottish taxpayers). National Insurance is calculated
annually, whereas real payroll calculates it per pay period, so a real payslip may
differ slightly.

Don't use it for anything that matters without checking the numbers yourself. The
page links to the gov.scot and gov.uk sources the figures come from, and shows the
date they were last verified.

## Development

No build step, no dependencies. Open `src/index.html` in a browser, or serve the
folder:

```bash
python3 -m http.server -d src 8000
```

Run the tests (Node 20+, nothing to install):

```bash
node --test test/
```

Contribution rules, the release process and the project's hard constraints are in
[CLAUDE.md](CLAUDE.md).

## Licence

MIT — see [LICENSE](LICENSE).
