/**
 * @fileoverview Shared utility functions.
 * @module utils
 */

/**
 * Major wine producing countries (alphabetically sorted).
 * Used for country dropdown selections.
 */
export const WINE_COUNTRIES = [
  'Argentina',
  'Australia',
  'Austria',
  'Chile',
  'France',
  'Germany',
  'Greece',
  'Italy',
  'New Zealand',
  'Portugal',
  'South Africa',
  'Spain',
  'USA'
];

/**
 * Show a toast notification.
 * @param {string} message - Message to display
 * @param {number} [duration=3000] - Duration in milliseconds
 */
export function showToast(message, duration = 3000) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');

  setTimeout(() => {
    toast.classList.remove('show');
  }, duration);
}

/**
 * Shorten wine name to fit in slot.
 * @param {string} name - Full wine name
 * @returns {string} Shortened name
 */
export function shortenWineName(name) {
  if (!name) return '';
  return name
    // Remove common filler words and designations
    .replace(/\b(Vineyard|Vineyards|Selection|Reserva?|Gran|Superior[e]?|Estate|Winery|Cellars?|Family|Single|Premium|Special|Limited|Edition|Classic)\b/gi, '')
    // Remove year patterns that might be in the name (vintage is shown separately)
    .replace(/\b(19|20)\d{2}\b/g, '')
    // Clean up multiple spaces
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 25);
}

/**
 * Escape HTML special characters to prevent XSS.
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
export function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
