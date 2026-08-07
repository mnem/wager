/**
 * DOM wiring only.
 *
 * There is no arithmetic in this file — every figure comes from src/lib/, which
 * is fully covered by tests that need no DOM. See CLAUDE.md.
 */

import {
  parseMoneyInput,
  parsePercentInput,
  formatGBP,
  formatPercent,
  basisPointsToRate,
} from './lib/money.js';
import { salaryForMonthlyNet } from './lib/invert.js';
import { getTaxYear, listJurisdictions, DEFAULT_JURISDICTION_ID } from './lib/tax-years.js';
import { toEditable, fromEditable, isUnchanged } from './lib/editable.js';
import { validateTaxYear } from './lib/validate.js';
import { BUILD } from './version.js';

const TAX_YEAR_ID = '2026-27';

/**
 * Which jurisdiction's figures are shown, and any edits made to them.
 *
 * `year` is always the config actually being calculated with — the published
 * one, or the edited one. Everything on the page renders from it, so there is
 * no way for the tables to show one set of figures while the answer uses
 * another.
 */
const state = {
  jurisdictionId: DEFAULT_JURISDICTION_ID,
  year: getTaxYear(TAX_YEAR_ID, DEFAULT_JURISDICTION_ID),
  edits: null,
};

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
  jurisdiction: document.getElementById('jurisdiction'),
  bandsHeading: document.getElementById('bands-heading'),
  ratesNote: document.getElementById('rates-note'),
  editedNotice: document.getElementById('edited-notice'),
  resetFigures: document.getElementById('reset-figures'),
  editor: document.getElementById('editor'),
  editAllowance: document.getElementById('edit-allowance'),
  editorIncomeTax: document.querySelector('#editor-income-tax tbody'),
  editorNationalInsurance: document.querySelector('#editor-national-insurance tbody'),
  editorError: document.getElementById('editor-error'),
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

/* Jurisdiction and edited figures ------------------------------------------- */

/** Remembered like the colour scheme: which country you live in does not change. */
const JURISDICTION_STORAGE_KEY = 'wager:jurisdiction';

function storedJurisdiction() {
  try {
    const stored = localStorage.getItem(JURISDICTION_STORAGE_KEY);
    return listJurisdictions(TAX_YEAR_ID).some(({ id }) => id === stored)
      ? stored
      : DEFAULT_JURISDICTION_ID;
  } catch {
    return DEFAULT_JURISDICTION_ID;
  }
}

/**
 * Rebuild the tax year from the current jurisdiction and any edits.
 *
 * Edits are discarded when the jurisdiction changes: they were made against a
 * different set of bands, and silently carrying a Scottish starter-rate change
 * onto the Welsh table would be worse than losing it.
 *
 * @returns {string[]} problems with the edited figures, empty when they are fine
 */
function rebuildYear() {
  const published = getTaxYear(TAX_YEAR_ID, state.jurisdictionId);

  if (!state.edits || isUnchanged(state.edits, published)) {
    state.edits = null;
    state.year = published;
    return [];
  }

  const candidate = fromEditable(state.edits, published);
  const problems = validateTaxYear(candidate);

  // Keep calculating with the last good figures rather than showing nothing,
  // but say plainly that the edits are not being used.
  if (problems.length === 0) state.year = candidate;
  return problems;
}

function setUpJurisdiction() {
  el.jurisdiction.replaceChildren();
  for (const { id, label } of listJurisdictions(TAX_YEAR_ID)) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = label;
    el.jurisdiction.append(option);
  }

  state.jurisdictionId = storedJurisdiction();
  el.jurisdiction.value = state.jurisdictionId;

  el.jurisdiction.addEventListener('change', () => {
    state.jurisdictionId = el.jurisdiction.value;
    state.edits = null;
    try {
      localStorage.setItem(JURISDICTION_STORAGE_KEY, state.jurisdictionId);
    } catch {
      // Storage unavailable; the choice still applies for this visit.
    }
    // Without this the page would keep calculating with the previous
    // jurisdiction while showing the new one's name.
    rebuildYear();
    el.editorError.hidden = true;
    renderTaxYearInfo();
    renderEditor();
    update();
  });
}

/**
 * Read every editor input back into an editable tax year.
 *
 * Returns null if anything is unparseable, so a half-typed number never reaches
 * the calculator.
 *
 * @returns {import('./lib/editable.js').EditableTaxYear|null}
 */
function readEditor() {
  const published = getTaxYear(TAX_YEAR_ID, state.jurisdictionId);
  const editable = toEditable(published);

  const allowance = parseMoneyInput(el.editAllowance.value);
  if (allowance === null) return null;
  editable.allowancePence = allowance;

  const readRows = (body, bands) =>
    [...body.querySelectorAll('tr')].every((row, index) => {
      const band = bands[index];
      if (!band) return false;

      const rate = parsePercentInput(row.querySelector('.editor-rate').value);
      if (rate === null) return false;
      band.rateBasisPoints = rate;

      const limitInput = row.querySelector('.editor-limit');
      // The final band is unbounded and has no input to read.
      if (!limitInput) return true;

      const limit = parseMoneyInput(limitInput.value);
      if (limit === null) return false;
      band.toPence = limit;
      return true;
    });

  if (!readRows(el.editorIncomeTax, editable.incomeTax)) return null;
  if (!readRows(el.editorNationalInsurance, editable.nationalInsurance)) return null;

  return editable;
}

/** Build one editable row. The last band has no limit — it is unbounded. */
function editorRow(band, isLast) {
  const tr = document.createElement('tr');

  const th = document.createElement('th');
  th.scope = 'row';
  th.textContent = band.label;

  const rateCell = document.createElement('td');
  const rate = document.createElement('input');
  rate.type = 'text';
  rate.inputMode = 'decimal';
  rate.autocomplete = 'off';
  rate.className = 'editor-rate';
  rate.value = String(band.rateBasisPoints / 100);
  rate.setAttribute('aria-label', `${band.label} rate, per cent`);
  rateCell.append(rate);

  const limitCell = document.createElement('td');
  if (isLast) {
    limitCell.textContent = 'and above';
    limitCell.className = 'editor-unbounded';
  } else {
    const limit = document.createElement('input');
    limit.type = 'text';
    limit.inputMode = 'decimal';
    limit.autocomplete = 'off';
    limit.className = 'editor-limit';
    limit.value = String((band.toPence ?? 0) / 100);
    limit.setAttribute('aria-label', `${band.label} upper limit, gross pounds`);
    limitCell.append(limit);
  }

  tr.append(th, rateCell, limitCell);
  return tr;
}

function renderEditor() {
  const editable = state.edits ?? toEditable(getTaxYear(TAX_YEAR_ID, state.jurisdictionId));

  el.editAllowance.value = String(editable.allowancePence / 100);

  const fill = (body, bands) => {
    body.replaceChildren();
    bands.forEach((band, index) => body.append(editorRow(band, index === bands.length - 1)));
  };
  fill(el.editorIncomeTax, editable.incomeTax);
  fill(el.editorNationalInsurance, editable.nationalInsurance);
}

function onEdit() {
  const editable = readEditor();

  if (editable === null) {
    el.editorError.hidden = false;
    el.editorError.textContent = 'Some of these figures cannot be read. Rates are percentages, limits are pounds.';
    return;
  }

  state.edits = editable;
  const problems = rebuildYear();

  el.editorError.hidden = problems.length === 0;
  if (problems.length > 0) {
    el.editorError.textContent = `Not using these figures: ${problems[0]}`;
  }

  renderTaxYearInfo();
  update();
}

function resetFigures() {
  state.edits = null;
  rebuildYear();
  el.editorError.hidden = true;
  renderEditor();
  renderTaxYearInfo();
  update();
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
  const YEAR = state.year;

  el.bandsHeading.textContent = `${YEAR.jurisdiction} income tax bands, ${YEAR.label}`;

  // The edited warning replaces the verification claim rather than sitting
  // alongside it, so the page never says "verified" about figures it was handed.
  el.editedNotice.hidden = !YEAR.edited;

  el.ratesNote.hidden = !YEAR.ratesNote || Boolean(YEAR.edited);
  if (YEAR.ratesNote) el.ratesNote.textContent = YEAR.ratesNote;

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

  el.verifiedOn.textContent = YEAR.verifiedOn
    ? `Rates and thresholds for ${YEAR.jurisdiction}, ${YEAR.label}, last checked against the primary sources on ${YEAR.verifiedOn}.`
    : 'These figures have been changed by hand and no longer match the sources below.';

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
  const YEAR = state.year;
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

  el.breakdownIntro.textContent = YEAR.edited
    ? `Based on figures you changed by hand, not the published rates for ${YEAR.label}.`
    : `Based on ${YEAR.jurisdiction} income tax bands for ${YEAR.label}. Figures may differ by a penny from a payslip, because payroll rounds each pay period separately.`;

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
setUpJurisdiction();
rebuildYear();
renderEditor();
el.editor.addEventListener('input', onEdit);
el.resetFigures.addEventListener('click', resetFigures);
renderTaxYearInfo();
renderBuildInfo();
update();
