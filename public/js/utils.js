/**
 * @fileoverview Shared utility functions.
 * @module utils
 */

/**
 * Show a toast notification.
 * @param {string} message - Message to display
 */
export function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');

  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

/**
 * Shorten wine name to fit in slot.
 * @param {string} name - Full wine name
 * @returns {string} Shortened name
 */
export function shortenWineName(name) {
  if (!name) return '';
  return name
    .replace(/\b(Vineyard|Selection|Reserva?|Gran|Superior[e]?)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 30);
}
