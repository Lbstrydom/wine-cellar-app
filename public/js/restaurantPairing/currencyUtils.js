/**
 * @fileoverview Currency utilities for restaurant pairing.
 * Handles currency detection, formatting, and approximate conversion.
 * @module restaurantPairing/currencyUtils
 */

// --- Currency symbol → ISO 4217 mapping ---

const SYMBOL_TO_CODE = {
  '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY',
  'R': 'ZAR', 'Fr': 'CHF', 'kr': 'SEK',
  'A$': 'AUD', 'C$': 'CAD', 'NZ$': 'NZD',
  '₹': 'INR', '₩': 'KRW', '฿': 'THB', '₫': 'VND',
  'zł': 'PLN', 'Kč': 'CZK', '₺': 'TRY', 'R$': 'BRL',
  '₱': 'PHP', '₴': 'UAH'
};

/** Set of valid ISO 4217 codes we support */
const VALID_CODES = new Set([
  'USD', 'EUR', 'GBP', 'JPY', 'ZAR', 'CHF', 'SEK', 'NOK', 'DKK',
  'AUD', 'CAD', 'NZD', 'INR', 'KRW', 'THB', 'VND', 'PLN', 'CZK',
  'TRY', 'BRL', 'PHP', 'UAH', 'MXN', 'ARS', 'CLP', 'HUF', 'RON',
  'HRK', 'ISK', 'SGD', 'HKD', 'TWD', 'MYR', 'IDR', 'CNY', 'RUB'
]);

/**
 * Approximate exchange rates to USD (mid-market, ~Feb 2026).
 * Used for rough "home currency" conversion — NOT for financial transactions.
 */
const RATES_TO_USD = {
  USD: 1.00, EUR: 1.08, GBP: 1.27, JPY: 0.0067, ZAR: 0.055,
  CHF: 1.13, SEK: 0.095, NOK: 0.092, DKK: 0.145,
  AUD: 0.64, CAD: 0.74, NZD: 0.59, INR: 0.012, KRW: 0.00072,
  THB: 0.029, PLN: 0.25, CZK: 0.042, TRY: 0.029,
  BRL: 0.17, MXN: 0.050, HUF: 0.0027, RON: 0.22,
  SGD: 0.75, HKD: 0.13, TWD: 0.031, MYR: 0.23,
  CNY: 0.14, PHP: 0.018, IDR: 0.000063
};

/** Country code → currency code mapping */
const COUNTRY_TO_CURRENCY = {
  ZA: 'ZAR', US: 'USD', GB: 'GBP', AU: 'AUD', NZ: 'NZD',
  CA: 'CAD', CH: 'CHF', JP: 'JPY', CN: 'CNY', KR: 'KRW',
  IN: 'INR', TH: 'THB', SE: 'SEK', NO: 'NOK', DK: 'DKK',
  NL: 'EUR', DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR',
  FI: 'EUR', AT: 'EUR', BE: 'EUR', IE: 'EUR', PT: 'EUR',
  GR: 'EUR', LU: 'EUR', SK: 'EUR', SI: 'EUR', EE: 'EUR',
  LV: 'EUR', LT: 'EUR', CY: 'EUR', MT: 'EUR', HR: 'EUR',
  PL: 'PLN', CZ: 'CZK', HU: 'HUF', RO: 'RON', TR: 'TRY',
  BR: 'BRL', MX: 'MXN', SG: 'SGD', HK: 'HKD', TW: 'TWD',
  MY: 'MYR', PH: 'PHP', ID: 'IDR', VN: 'VND', UA: 'UAH'
};

/**
 * Normalize raw currency input (symbol or code) to ISO 4217 code.
 * @param {string|null} raw - Currency symbol or code (e.g., "€", "EUR", "R")
 * @returns {string|null} ISO 4217 code or null if unrecognized
 */
export function normalizeCurrencyCode(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const upper = trimmed.toUpperCase();
  if (VALID_CODES.has(upper)) return upper;
  // Try multi-char symbols first (R$, A$, C$, NZ$) before single-char
  if (SYMBOL_TO_CODE[trimmed]) return SYMBOL_TO_CODE[trimmed];
  return null;
}

/**
 * Detect user's home currency from browser locale.
 * @returns {string} ISO 4217 currency code (defaults to USD)
 */
export function getUserCurrency() {
  try {
    const locale = navigator.language || 'en-US';
    const parts = locale.split('-');
    const country = (parts.length > 1 ? parts[parts.length - 1] : parts[0]).toUpperCase();
    return COUNTRY_TO_CURRENCY[country] || 'USD';
  } catch {
    return 'USD';
  }
}

/**
 * Format a price with its currency symbol using Intl.NumberFormat.
 * @param {number|null} amount - Price amount
 * @param {string|null} currency - Currency symbol or code
 * @returns {string} Formatted price (e.g., "€15") or empty string if no amount
 */
export function formatPrice(amount, currency) {
  if (amount == null) return '';
  const code = normalizeCurrencyCode(currency);
  if (code) {
    try {
      return new Intl.NumberFormat('en', {
        style: 'currency',
        currency: code,
        currencyDisplay: 'narrowSymbol',
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
      }).format(amount);
    } catch { /* fall through to manual format */ }
  }
  // Fallback: raw symbol + amount
  const sym = currency || '';
  const formatted = Number(amount) % 1 === 0 ? String(amount) : Number(amount).toFixed(2);
  return `${sym}${formatted}`;
}

/**
 * Convert an amount between currencies using approximate rates.
 * @param {number} amount - Amount in source currency
 * @param {string} fromCode - Source ISO 4217 code
 * @param {string} toCode - Target ISO 4217 code
 * @returns {number|null} Converted amount, or null if conversion unavailable
 */
export function convertPrice(amount, fromCode, toCode) {
  if (!fromCode || !toCode || fromCode === toCode) return null;
  const fromRate = RATES_TO_USD[fromCode];
  const toRate = RATES_TO_USD[toCode];
  if (!fromRate || !toRate) return null;
  return amount * (fromRate / toRate);
}

/**
 * Format price with optional home currency conversion.
 * Shows "€15 (~R294)" when currencies differ, just "€15" when same or no conversion.
 * @param {number|null} amount - Price amount
 * @param {string|null} currency - Original currency (symbol or code)
 * @param {string|null} [homeCurrency] - User's home currency code (auto-detected if null)
 * @returns {string} Formatted price with optional conversion
 */
export function formatPriceWithConversion(amount, currency, homeCurrency) {
  if (amount == null) return '';
  const primary = formatPrice(amount, currency);

  const fromCode = normalizeCurrencyCode(currency);
  const toCode = homeCurrency || getUserCurrency();

  if (!fromCode || fromCode === toCode) return primary;

  const converted = convertPrice(amount, fromCode, toCode);
  if (converted == null) return primary;

  const convertedFormatted = formatPrice(Math.round(converted), toCode);
  return `${primary} (~${convertedFormatted})`;
}
