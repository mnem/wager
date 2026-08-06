/**
 * Money handling.
 *
 * Every monetary value in this project is an integer number of pence. Pounds
 * exist only at the two boundaries handled here: parsing what a person typed,
 * and formatting what they read back. See CLAUDE.md.
 */

export const PENCE_PER_POUND = 100;

/**
 * Tax rates are stored as integer basis points — 1900 rather than 0.19 — so
 * that every step of the calculation is exact integer arithmetic.
 *
 * JavaScript has no decimal type, and a rate like 0.21 is not exactly
 * representable in binary floating point. Multiplying pence by basis points and
 * dividing once at the end keeps the whole calculation free of floats. The
 * largest product involved (about £1m of income at the top rate) is roughly
 * 4.8e11, comfortably inside Number.MAX_SAFE_INTEGER, so BigInt is unnecessary.
 */
export const BASIS_POINTS = 10_000;

/**
 * Integer division rounding halves away from zero, for non-negative integers.
 *
 * Written as (2n + d) / 2d so the half never has to be represented as a
 * fraction.
 *
 * @param {number} numerator
 * @param {number} denominator
 * @returns {number}
 */
export function roundHalfUp(numerator, denominator) {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new TypeError(`roundHalfUp needs integers and a positive denominator, got ${numerator}/${denominator}`);
  }
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

/**
 * Round up to the next whole pound.
 *
 * @param {number} pence
 * @returns {number} integer pence, a multiple of 100
 */
export function ceilToPound(pence) {
  assertPence(pence);
  return Math.ceil(pence / PENCE_PER_POUND) * PENCE_PER_POUND;
}

/**
 * Convert integer basis points to a fraction, for display only.
 *
 * @param {number} basisPoints e.g. 1900
 * @returns {number} e.g. 0.19
 */
export function basisPointsToRate(basisPoints) {
  return basisPoints / BASIS_POINTS;
}

/** Matches a plain decimal, or one with correctly-grouped thousands separators. */
const MONEY_SHAPE = /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.(\d+))?$/;

/**
 * Convert a decimal pounds string to integer pence, rounding half-up at the
 * third decimal place.
 *
 * Done on the string rather than with arithmetic because `1234.56 * 100` is
 * 123455.99999999999 in binary floating point, and rounding errors in a money
 * calculator are exactly the sort of thing nobody notices until it matters.
 *
 * @param {string} decimal a bare decimal, e.g. "1234.56" — no symbols or separators
 * @returns {number|null} integer pence, or null if the value is out of safe range
 */
function decimalStringToPence(decimal) {
  const [whole, fraction = ''] = decimal.split('.');

  const wholePence = Number(whole) * PENCE_PER_POUND;
  if (!Number.isSafeInteger(wholePence)) return null;

  // Pad to three digits so the third can drive half-up rounding.
  const digits = (fraction + '000').slice(0, 3);
  const fractionPence = Number(digits.slice(0, 2)) + (Number(digits[2]) >= 5 ? 1 : 0);

  const pence = wholePence + fractionPence;
  return Number.isSafeInteger(pence) ? pence : null;
}

/**
 * Parse something a person typed into integer pence.
 *
 * Accepts an optional leading £, thousands separators, surrounding whitespace
 * and any number of decimal places (rounded to the nearest penny). Rejects
 * negatives, junk, and empty input.
 *
 * @param {string|number} raw
 * @returns {number|null} integer pence, or null if it isn't a valid amount
 */
export function parseMoneyInput(raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  if (typeof raw === 'number' && !Number.isFinite(raw)) return null;

  const cleaned = String(raw)
    .trim()
    .replace(/^£/, '')
    .replace(/\s/g, '');

  if (!MONEY_SHAPE.test(cleaned)) return null;

  return decimalStringToPence(cleaned.replace(/,/g, ''));
}

/**
 * Convert pounds to integer pence.
 *
 * @param {string|number} value
 * @returns {number} integer pence
 * @throws {TypeError} if the value is not a valid non-negative amount
 */
export function poundsToPence(value) {
  const pence = parseMoneyInput(value);
  if (pence === null) throw new TypeError(`Not a valid amount in pounds: ${JSON.stringify(value)}`);
  return pence;
}

/**
 * Convert integer pence to pounds. Lossy by nature — for display only.
 *
 * @param {number} pence
 * @returns {number}
 */
export function penceToPounds(pence) {
  assertPence(pence);
  return pence / PENCE_PER_POUND;
}

/**
 * Format integer pence as sterling, e.g. "£3,214.58".
 *
 * @param {number} pence
 * @param {{decimals?: number}} [options] decimal places; 0 gives "£3,215"
 * @returns {string}
 */
export function formatGBP(pence, { decimals = 2 } = {}) {
  assertPence(pence);
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(pence / PENCE_PER_POUND);
}

/**
 * Format a rate as a percentage, e.g. 0.42 -> "42%", 0.695 -> "69.5%".
 *
 * @param {number} rate a fraction, not a percentage
 * @param {{decimals?: number}} [options]
 * @returns {string}
 */
export function formatPercent(rate, { decimals = 1 } = {}) {
  if (!Number.isFinite(rate)) throw new TypeError(`Not a finite rate: ${rate}`);
  return new Intl.NumberFormat('en-GB', {
    style: 'percent',
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(rate);
}

/**
 * Guard for values that must already be integer pence.
 *
 * @param {number} pence
 * @throws {TypeError}
 */
export function assertPence(pence) {
  if (!Number.isSafeInteger(pence)) {
    throw new TypeError(`Expected an integer number of pence, got ${JSON.stringify(pence)}`);
  }
}
