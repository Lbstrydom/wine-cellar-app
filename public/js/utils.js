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

/**
 * Show a confirmation dialog.
 * @param {Object} options - Dialog options
 * @param {string} options.title - Dialog title
 * @param {string} options.message - Dialog message
 * @param {string} [options.confirmText='Confirm'] - Confirm button text
 * @param {string} [options.cancelText='Cancel'] - Cancel button text
 * @returns {Promise<boolean>} True if confirmed, false if cancelled
 */
export function showConfirmDialog({ title, message, confirmText = 'Confirm', cancelText = 'Cancel' }) {
  return new Promise((resolve) => {
    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'confirm-dialog-overlay';

    // Create dialog
    const dialog = document.createElement('div');
    dialog.className = 'confirm-dialog';
    dialog.innerHTML = `
      <h3 class="confirm-dialog-title">${escapeHtml(title)}</h3>
      <p class="confirm-dialog-message">${escapeHtml(message).replace(/\n/g, '<br>')}</p>
      <div class="confirm-dialog-buttons">
        <button class="confirm-dialog-cancel">${escapeHtml(cancelText)}</button>
        <button class="confirm-dialog-confirm">${escapeHtml(confirmText)}</button>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // Focus confirm button
    dialog.querySelector('.confirm-dialog-confirm').focus();

    // Handle confirm
    dialog.querySelector('.confirm-dialog-confirm').addEventListener('click', () => {
      overlay.remove();
      resolve(true);
    });

    // Handle cancel
    dialog.querySelector('.confirm-dialog-cancel').addEventListener('click', () => {
      overlay.remove();
      resolve(false);
    });

    // Handle overlay click (cancel)
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve(false);
      }
    });

    // Handle escape key
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', handleEscape);
        resolve(false);
      }
    };
    document.addEventListener('keydown', handleEscape);
  });
}
