/**
 * @fileoverview Wine Confirmation Modal.
 * Shows Vivino search results and lets user confirm the correct wine match.
 * @module bottles/wineConfirmation
 */

import { searchVivinoWines } from '../api.js';
import { escapeHtml } from '../utils.js';

let confirmationModal = null;
let currentCallbacks = null;
let selectedQuantity = 1;

/**
 * Show confirmation modal with wine search results.
 * @param {Object} parsedWine - Wine details from form/parsing
 * @param {Function} onConfirm - Called with confirmed wine data
 * @param {Function} onSkip - Called if user skips confirmation
 */
export async function showWineConfirmation(parsedWine, onConfirm, onSkip) {
  currentCallbacks = { onConfirm, onSkip, parsedWine };
  selectedQuantity = 1; // Reset quantity

  // Create modal if it doesn't exist
  if (!confirmationModal) {
    createConfirmationModal();
  }

  // Show loading state
  renderLoadingState(parsedWine);
  confirmationModal.classList.add('active');

  try {
    // Search for matching wines
    const searchResults = await searchVivinoWines({
      wineName: parsedWine.wine_name,
      producer: extractProducer(parsedWine.wine_name),
      vintage: parsedWine.vintage,
      country: parsedWine.country,
      colour: parsedWine.colour
    });

    // Render results
    renderResults(parsedWine, searchResults.matches, searchResults.error);

  } catch (error) {
    console.error('Wine search failed:', error);
    renderError(parsedWine, 'Could not search for wines. You can still add without verification.');
  }
}

/**
 * Extract producer name from wine name.
 * @param {string} wineName - Full wine name
 * @returns {string|null}
 */
function extractProducer(wineName) {
  if (!wineName) return null;

  const grapeVarieties = new Set([
    'cabernet', 'sauvignon', 'blanc', 'merlot', 'shiraz', 'syrah', 'pinot',
    'chardonnay', 'riesling', 'chenin', 'pinotage', 'malbec', 'primitivo',
    'grenache', 'noir', 'grigio', 'verdejo', 'carmenere', 'nebbiolo'
  ]);

  const wineTypeWords = new Set([
    'red', 'white', 'rose', 'rosé', 'blend', 'reserve', 'reserva',
    'selection', 'single', 'barrel', 'limited', 'cuvee', 'brut'
  ]);

  const words = wineName.split(/\s+/);
  const producerWords = [];

  for (const word of words) {
    const cleaned = word.toLowerCase().replace(/[^a-z]/g, '');
    if (/^\d+$/.test(word)) continue;
    if (grapeVarieties.has(cleaned)) break;
    if (wineTypeWords.has(cleaned)) break;
    producerWords.push(word);
    if (producerWords.length >= 3) break;
  }

  return producerWords.length > 0 ? producerWords.join(' ') : null;
}

/**
 * Create the confirmation modal element.
 */
function createConfirmationModal() {
  confirmationModal = document.createElement('div');
  confirmationModal.id = 'wine-confirmation-modal';
  confirmationModal.className = 'modal-overlay';
  confirmationModal.innerHTML = `
    <div class="modal wine-confirmation-modal">
      <button class="modal-close" id="confirmation-close-btn">&times;</button>
      <div class="modal-content" id="confirmation-content"></div>
    </div>
  `;
  document.body.appendChild(confirmationModal);

  // Close button handler
  confirmationModal.querySelector('#confirmation-close-btn').addEventListener('click', closeConfirmation);

  // Backdrop click to close
  confirmationModal.addEventListener('click', (e) => {
    if (e.target === confirmationModal) {
      closeConfirmation();
    }
  });
}

/**
 * Render loading state.
 * @param {Object} parsedWine - Parsed wine data
 */
function renderLoadingState(parsedWine) {
  const content = confirmationModal.querySelector('#confirmation-content');
  content.innerHTML = `
    <div class="confirmation-loading">
      <div class="spinner"></div>
      <p>Searching for "${escapeHtml(parsedWine.wine_name)}"...</p>
    </div>
  `;
}

/**
 * Render search results.
 * @param {Object} parsedWine - Parsed wine data
 * @param {Array} matches - Vivino search matches
 * @param {string|null} error - Error message if any
 */
function renderResults(parsedWine, matches, error) {
  const content = confirmationModal.querySelector('#confirmation-content');

  // If there's an error but no matches, show error
  if (error && (!matches || matches.length === 0)) {
    renderError(parsedWine, error);
    return;
  }

  content.innerHTML = `
    <div class="confirmation-header">
      <h3>Confirm Wine Match</h3>
      <p class="parsed-info">
        Detected: <strong>${escapeHtml(parsedWine.wine_name)}</strong>
        ${parsedWine.vintage ? `(${escapeHtml(parsedWine.vintage)})` : ''}
      </p>
    </div>

    <div class="confirmation-quantity">
      <label for="confirmation-qty">Number of bottles:</label>
      <div class="qty-controls">
        <button type="button" class="qty-btn" data-action="decrease">−</button>
        <input type="number" id="confirmation-qty" min="1" max="24" value="1">
        <button type="button" class="qty-btn" data-action="increase">+</button>
      </div>
    </div>

    <div class="confirmation-matches">
      ${matches && matches.length > 0 ? `
        <h4>Select the correct wine:</h4>
        ${renderMatches(matches)}
      ` : `
        <p class="no-matches">No matches found on Vivino. You can add the wine without verification.</p>
      `}
    </div>

    <div class="confirmation-actions">
      <button class="btn-secondary" id="confirmation-skip-btn">
        Skip - add without Vivino data
      </button>
    </div>
  `;

  // Quantity control handlers
  const qtyInput = content.querySelector('#confirmation-qty');
  content.querySelectorAll('.qty-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      let val = parseInt(qtyInput.value) || 1;
      if (action === 'increase' && val < 24) val++;
      if (action === 'decrease' && val > 1) val--;
      qtyInput.value = val;
      selectedQuantity = val;
    });
  });
  qtyInput.addEventListener('change', () => {
    let val = parseInt(qtyInput.value) || 1;
    val = Math.max(1, Math.min(24, val));
    qtyInput.value = val;
    selectedQuantity = val;
  });

  // Add event handlers
  content.querySelectorAll('.match-card').forEach(card => {
    card.addEventListener('click', () => handleMatchSelect(card));
  });

  // CSP-compliant image fallback (replaces inline onerror handlers)
  content.querySelectorAll('img[data-fallback-src]').forEach((img) => {
    img.addEventListener('error', () => {
      img.src = img.dataset.fallbackSrc;
    }, { once: true });
  });

  // Stop propagation on Vivino links to prevent card click handler (CSP-compliant)
  content.querySelectorAll('.match-meta-link a').forEach(link => {
    link.addEventListener('click', (e) => e.stopPropagation());
  });

  content.querySelector('#confirmation-skip-btn').addEventListener('click', handleSkip);
}

/**
 * Render match cards.
 * @param {Array} matches - Wine matches
 * @returns {string} HTML
 */
function renderMatches(matches) {
  return matches.slice(0, 6).map((wine, index) => {
    const hasDetailedData = wine.rating || wine.winery?.name || wine.region;
    return `
    <div class="match-card ${index === 0 ? 'top-match' : ''}"
         data-vivino-id="${wine.vivinoId || ''}"
         data-wine='${JSON.stringify(wine).replace(/'/g, "&#39;")}'>
      <div class="match-image">
        ${wine.imageUrl ? `
          <img src="${escapeHtml(wine.imageUrl)}" alt="${escapeHtml(wine.name)}"
               data-fallback-src="/images/wine-placeholder.svg">
        ` : `
          <div class="image-placeholder"></div>
        `}
      </div>
      <div class="match-details">
        <h5>${escapeHtml(wine.name || 'Unknown Wine')}</h5>
        ${hasDetailedData ? `
          <p class="match-meta">
            ${wine.winery?.name ? escapeHtml(wine.winery.name) + ' · ' : ''}
            ${wine.region ? escapeHtml(wine.region) + ' · ' : ''}
            ${wine.country ? escapeHtml(wine.country) : ''}
          </p>
          ${wine.rating ? `
            <p class="match-rating">
              <span class="rating-stars">${renderStars(wine.rating)}</span>
              <span class="rating-value">${wine.rating.toFixed(1)}</span>
              ${wine.ratingCount ? `<span class="rating-count">(${formatCount(wine.ratingCount)} ratings)</span>` : ''}
            </p>
          ` : '<p class="match-rating">No rating</p>'}
          ${wine.grapeVariety ? `<p class="match-grape">${escapeHtml(wine.grapeVariety)}</p>` : ''}
        ` : `
          <p class="match-meta match-meta-link">
            ${wine.vivinoUrl ? `<a href="${escapeHtml(wine.vivinoUrl)}" target="_blank" rel="noopener">View on Vivino ↗</a>` : 'Found on Vivino'}
          </p>
          <p class="match-note">Click to confirm this is the correct wine</p>
        `}
      </div>
      <div class="match-action">
        <button class="btn-confirm">${index === 0 ? 'This is it' : 'Select'}</button>
      </div>
    </div>
  `;
  }).join('');
}

/**
 * Render star rating display.
 * @param {number} rating - Rating value (0-5)
 * @returns {string} HTML
 */
function renderStars(rating) {
  if (!rating) return '';
  const full = Math.floor(rating);
  const half = (rating % 1) >= 0.3 && (rating % 1) < 0.8 ? 1 : 0;
  const empty = 5 - full - half;
  return '<span class="stars-filled">★</span>'.repeat(full) +
         (half ? '<span class="stars-half">★</span>' : '') +
         '<span class="stars-empty">☆</span>'.repeat(empty);
}

/**
 * Format rating count.
 * @param {number} count - Rating count
 * @returns {string}
 */
function formatCount(count) {
  if (!count) return '0';
  if (count >= 1000) return (count / 1000).toFixed(1) + 'k';
  return count.toString();
}

/**
 * Render error state.
 * @param {Object} parsedWine - Parsed wine data
 * @param {string} message - Error message
 */
function renderError(parsedWine, message) {
  const content = confirmationModal.querySelector('#confirmation-content');
  content.innerHTML = `
    <div class="confirmation-header">
      <h3>Confirm Wine Match</h3>
      <p class="parsed-info">
        Detected: <strong>${escapeHtml(parsedWine.wine_name)}</strong>
        ${parsedWine.vintage ? `(${escapeHtml(parsedWine.vintage)})` : ''}
      </p>
    </div>
    <div class="confirmation-error">
      <p>${escapeHtml(message)}</p>
    </div>
    <div class="confirmation-actions">
      <button class="btn-primary" id="confirmation-skip-btn">
        Add wine without verification
      </button>
    </div>
  `;

  content.querySelector('#confirmation-skip-btn').addEventListener('click', handleSkip);
}

/**
 * Handle match selection.
 * @param {HTMLElement} card - Selected card element
 */
function handleMatchSelect(card) {
  let wineData;
  try {
    wineData = JSON.parse(card.dataset.wine);
  } catch (err) {
    console.error('Failed to parse wine data:', err, card.dataset.wine);
    alert('Error selecting wine. Please try again or skip verification.');
    return;
  }
  closeConfirmation();

  if (currentCallbacks?.onConfirm) {
    currentCallbacks.onConfirm({
      vivinoId: wineData.vivinoId,
      vivinoUrl: wineData.vivinoUrl,
      name: wineData.name,
      vintage: wineData.vintage,
      rating: wineData.rating,
      ratingCount: wineData.ratingCount,
      winery: wineData.winery,
      region: wineData.region,
      country: wineData.country,
      grapeVariety: wineData.grapeVariety,
      wineType: wineData.wineType,
      confirmed: true,
      quantity: selectedQuantity
    });
  }
}

/**
 * Handle skip button.
 */
function handleSkip() {
  closeConfirmation();
  if (currentCallbacks?.onSkip) {
    currentCallbacks.onSkip(selectedQuantity);
  }
}

/**
 * Close the confirmation modal.
 */
export function closeConfirmation() {
  if (confirmationModal) {
    confirmationModal.classList.remove('active');
  }
}

/**
 * Check if confirmation modal is currently visible.
 * @returns {boolean}
 */
export function isConfirmationVisible() {
  return confirmationModal?.classList.contains('active') || false;
}
