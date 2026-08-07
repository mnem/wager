/**
 * DOM wiring only.
 *
 * There is no arithmetic in this file — every figure comes from src/lib/, which
 * is fully covered by tests that need no DOM. See CLAUDE.md.
 */

import { parseMoneyInput, formatGBP, formatPercent, basisPointsToRate } from './lib/money.js';
import { salaryForMonthlyNet } from './lib/invert.js';
import { getTaxYear } from './lib/tax-years.js';
import { BUILD } from './version.js';

const YEAR = getTaxYear();

/** Long enough to skip mid-word keystrokes, short enough not to feel broken. */
const ANNOUNCE_DELAY_MS = 600;

const el = {
  form: document.getElementById('calculator'),
  input: document.getElementById('monthly-net'),
  error: document.getElementById('monthly-net-error'),
  result: document.getElementById('result'),
  liveStatus: document.getElementById('live-status'),
  headline: document.getElementById('headline-gross'),
  headlineSub: document.getElementById('headline-sub'),
  breakdown: document.getElementById('breakdown'),
  breakdownIntro: document.getElementById('breakdown-intro'),
  annualBody: document.querySelector('#table-annual tbody'),
  monthlyBody: document.querySelector('#table-monthly tbody'),
  effectiveRate: document.getElementById('effective-rate'),
  marginalRate: document.getElementById('marginal-rate'),
  marginalNote: document.getElementById('marginal-note'),
  bands: document.getElementById('bands'),
  bandsYear: document.getElementById('bands-year'),
  bandsBody: document.querySelector('#table-bands tbody'),
  niNote: document.getElementById('ni-note'),
  verifiedOn: document.getElementById('verified-on'),
  sources: document.getElementById('sources'),
  buildInfo: document.getElementById('build-info'),
  theme: document.getElementById('theme'),
};

/* Colour scheme ------------------------------------------------------------ */

/** Where the reader's choice is remembered. Nothing else is stored. */
const THEME_STORAGE_KEY = 'wager:theme';
const THEMES = ['light', 'system', 'dark'];

/**
 * Apply a colour scheme.
 *
 * "system" removes the attribute entirely rather than resolving it here, so the
 * `prefers-color-scheme` media query in the stylesheet stays in charge and keeps
 * following the system if it changes while the page is open.
 *
 * `colorScheme` is set alongside so that form controls, scrollbars and the
 * browser's own chrome match the choice, not just our own colours.
 *
 * @param {string} theme one of THEMES
 */
function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'system') {
    root.removeAttribute('data-theme');
    root.style.colorScheme = '';
  } else {
    root.setAttribute('data-theme', theme);
    root.style.colorScheme = theme;
  }
}

/**
 * Read the stored choice, tolerating storage being unavailable.
 *
 * Private browsing and blocked-storage settings make localStorage throw rather
 * than return null, and a broken theme is not worth breaking the calculator for.
 *
 * @returns {string} one of THEMES
 */
function storedTheme() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return THEMES.includes(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

function setUpTheme() {
  const theme = storedTheme();
  applyTheme(theme);

  const selected = el.theme.querySelector(`input[value="${theme}"]`);
  if (selected) selected.checked = true;

  el.theme.addEventListener('change', (event) => {
    const chosen = event.target.value;
    applyTheme(chosen);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, chosen);
    } catch {
      // Storage unavailable: the choice still applies for this visit.
    }
  });
}

/* Rendering helpers -------------------------------------------------------- */

/**
 * Append a row to a table body.
 *
 * @param {HTMLElement} body
 * @param {{label: string, amount: string, rate?: string, className?: string}} row
 */
function addRow(body, { label, amount, rate = '', className = '' }) {
  const tr = document.createElement('tr');
  if (className) tr.className = className;

  const th = document.createElement('th');
  th.scope = 'row';
  th.textContent = label;

  const amountCell = document.createElement('td');
  amountCell.className = 'numeric';
  amountCell.textContent = amount;

  const rateCell = document.createElement('td');
  rateCell.className = 'numeric';
  rateCell.textContent = rate;

  tr.append(th, amountCell, rateCell);
  body.append(tr);
}

/**
 * Render one period's breakdown into a table body.
 *
 * @param {HTMLElement} body
 * @param {import('./lib/calculator.js').Breakdown} period
 */
function renderBreakdown(body, period) {
  body.replaceChildren();

  addRow(body, { label: 'Gross pay', amount: formatGBP(period.grossPence) });

  // When the allowance has been tapered, show what it started as, what was
  // taken away, and what is left — in that order, so the arithmetic reads
  // forwards rather than presenting the result before its cause.
  const { basePence, allowancePence, taperedAwayPence } = period.personalAllowance;
  if (taperedAwayPence > 0) {
    addRow(body, {
      label: 'Personal allowance',
      amount: formatGBP(basePence),
      className: 'is-band',
    });
    addRow(body, {
      label: 'Withdrawn above the taper threshold',
      amount: `−${formatGBP(taperedAwayPence)}`,
      className: 'is-band is-deduction',
    });
    addRow(body, {
      label: 'Allowance left',
      amount: formatGBP(allowancePence),
      className: 'is-band',
    });
  } else {
    addRow(body, {
      label: 'Personal allowance',
      amount: formatGBP(allowancePence),
      className: 'is-band',
    });
  }
  addRow(body, {
    label: 'Taxable income',
    amount: formatGBP(period.incomeTax.taxablePence),
    className: 'is-band',
  });

  for (const row of period.incomeTax.rows) {
    if (row.amountInBandPence === 0) continue;
    addRow(body, {
      label: `${row.label} on ${formatGBP(row.amountInBandPence, { decimals: 0 })}`,
      amount: formatGBP(row.taxPence),
      rate: formatPercent(row.rate),
      className: 'is-band is-deduction',
    });
  }
  addRow(body, {
    label: 'Income tax',
    amount: formatGBP(period.incomeTax.totalPence),
    className: 'is-subtotal is-deduction',
  });

  for (const row of period.nationalInsurance.rows) {
    if (row.amountInBandPence === 0 || row.rate === 0) continue;
    addRow(body, {
      label: `${row.label} on ${formatGBP(row.amountInBandPence, { decimals: 0 })}`,
      amount: formatGBP(row.taxPence),
      rate: formatPercent(row.rate),
      className: 'is-band is-deduction',
    });
  }
  addRow(body, {
    label: 'National Insurance',
    amount: formatGBP(period.nationalInsurance.totalPence),
    className: 'is-subtotal is-deduction',
  });

  addRow(body, {
    label: 'Total deductions',
    amount: formatGBP(period.totalDeductionsPence),
    className: 'is-subtotal is-deduction',
  });
  addRow(body, {
    label: 'Take-home pay',
    amount: formatGBP(period.netPence),
    className: 'is-total',
  });
}

/* Static content ----------------------------------------------------------- */

function renderTaxYearInfo() {
  el.bandsYear.textContent = YEAR.label;

  const byId = Object.fromEntries(YEAR.incomeTax.bands.map((band) => [band.id, band]));
  el.bandsBody.replaceChildren();
  YEAR.publishedBands.forEach((published, index) => {
    const band = byId[published.id];
    // The unbounded band is phrased against where the previous one ended, so it
    // reads "Over £125,140" exactly as gov.scot writes it, rather than
    // "Over £125,141" — the same boundary, but not the published wording.
    const previous = YEAR.publishedBands[index - 1];
    const range =
      published.toPence === null
        ? `Over ${formatGBP(previous.toPence, { decimals: 0 })}`
        : `${formatGBP(published.fromPence, { decimals: 0 })} – ${formatGBP(published.toPence, { decimals: 0 })}`;
    // Config bands carry integer basis points; only calculated rows carry a rate.
    addRow(el.bandsBody, {
      label: band.label,
      amount: range,
      rate: formatPercent(basisPointsToRate(band.rateBasisPoints)),
    });
  });
  // The band table's middle column is a range, not a number.
  for (const cell of el.bandsBody.querySelectorAll('td.numeric:first-of-type')) {
    cell.classList.remove('numeric');
  }

  const ni = YEAR.nationalInsurance.bands.filter((band) => band.rateBasisPoints > 0);
  el.niNote.textContent = `National Insurance is UK-wide and applies on top: ${ni
    .map(
      (band) =>
        `${formatPercent(basisPointsToRate(band.rateBasisPoints))} ${band.label.toLowerCase()}`,
    )
    .join(', ')}.`;

  el.verifiedOn.textContent = `Rates and thresholds for ${YEAR.label}, last checked against the primary sources on ${YEAR.verifiedOn}.`;

  el.sources.replaceChildren();
  for (const source of YEAR.sources) {
    const li = document.createElement('li');
    const link = document.createElement('a');
    link.href = source.url;
    link.textContent = source.label;
    link.rel = 'noreferrer';
    li.append(link);
    el.sources.append(li);
  }
  el.bands.hidden = false;
}

function renderBuildInfo() {
  const link = document.createElement('a');
  if (BUILD.commit) {
    link.href = `https://github.com/${BUILD.repo}/tree/${BUILD.commit}`;
    link.textContent = `${BUILD.version} · ${BUILD.commitShort}`;
  } else {
    link.href = `https://github.com/${BUILD.repo}/tree/main`;
    link.textContent = 'dev build';
  }
  el.buildInfo.replaceChildren('Version ', link);
  if (BUILD.builtAt) el.buildInfo.append(` · built ${BUILD.builtAt}`);
}

/* Interaction -------------------------------------------------------------- */

/**
 * Announce the outcome to assistive technology, once typing has settled.
 *
 * The visible result updates on every keystroke, which is right for sighted
 * users and wrong for a screen reader — it would announce a partial figure per
 * character. This is the only live region on the page, it carries a one-line
 * summary rather than the whole breakdown, and it waits for a pause in typing.
 */
let announceTimer = null;
function announce(message) {
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => {
    el.liveStatus.textContent = message;
  }, ANNOUNCE_DELAY_MS);
}

function clearResult(message) {
  el.result.hidden = true;
  el.breakdown.hidden = true;
  el.error.hidden = !message;
  el.error.textContent = message ?? '';
  // The error itself is role="alert", so it announces on its own.
  announce('');
}

function update() {
  const raw = el.input.value;

  if (raw.trim() === '') {
    clearResult(null);
    return;
  }

  const monthlyNetPence = parseMoneyInput(raw);
  if (monthlyNetPence === null) {
    clearResult('Enter an amount, like 2500 or 2,500.00');
    return;
  }

  let suggestion;
  try {
    suggestion = salaryForMonthlyNet(monthlyNetPence, YEAR);
  } catch {
    clearResult('That figure is larger than this calculator handles.');
    return;
  }

  el.error.hidden = true;
  el.headline.textContent = formatGBP(suggestion.grossPence, { decimals: 0 });
  el.headlineSub.textContent = `That's ${formatGBP(
    suggestion.monthly.grossPence,
  )} a month before deductions, taking home ${formatGBP(suggestion.monthly.netPence)}.`;

  el.breakdownIntro.textContent = `Based on Scottish income tax bands for ${YEAR.label}. Figures may differ by a penny from a payslip, because payroll rounds each pay period separately.`;

  renderBreakdown(el.annualBody, suggestion.annual);
  renderBreakdown(el.monthlyBody, suggestion.monthly);

  el.effectiveRate.textContent = formatPercent(suggestion.annual.effectiveDeductionRate);
  el.marginalRate.textContent = formatPercent(suggestion.annual.marginalRate);

  // Worth calling out: between £100,000 and £125,140 the personal allowance is
  // being withdrawn, so the marginal rate is higher than at any salary above it.
  const inTaper = suggestion.annual.personalAllowance.taperedAwayPence > 0;
  el.marginalNote.hidden = !inTaper;
  if (inTaper) {
    el.marginalNote.textContent =
      'This salary sits in the range where the personal allowance is being withdrawn, so each extra pound is taxed more heavily here than it would be on a much larger salary.';
  }

  el.result.hidden = false;
  el.breakdown.hidden = false;

  announce(
    `Gross salary ${formatGBP(suggestion.grossPence, { decimals: 0 })} a year, ` +
      `taking home ${formatGBP(suggestion.monthly.netPence)} a month.`,
  );
}

el.form.addEventListener('submit', (event) => event.preventDefault());
el.input.addEventListener('input', update);

setUpTheme();
renderTaxYearInfo();
renderBuildInfo();
update();
