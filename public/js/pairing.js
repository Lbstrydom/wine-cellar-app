/**
 * @fileoverview Pairing UI logic: recommendation cards, choose button, feedback integration.
 */

import { choosePairingWine, drinkBottle } from './api.js';
import { showWineModalFromList } from './modals.js';
import { showToast } from './utils.js';

let currentSessionId = null;

/** All recommendations from current session, keyed by wine_id. */
const recsByWineId = new Map();

/**
 * Format location codes for display.
 * @param {string} locations - Comma-separated location codes (e.g. "R5-3,R5-4")
 * @returns {string} Human-readable location text
 */
function formatLocation(locations) {
  if (!locations || locations === 'Unknown') return 'Unknown';
  const parts = locations.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length <= 3) return parts.join(', ');
  return `${parts.slice(0, 3).join(', ')} +${parts.length - 3} more`;
}

/**
 * Render a single recommendation card with "Choose This Wine" button.
 * @param {Object} rec - Recommendation object
 * @param {number} rank - Rank of the recommendation
 * @returns {HTMLElement} Card element
 */
export function renderRecommendation(rec, rank) {
  // Store rec for later retrieval (openWineDetail, drink action)
  if (rec.wine_id) recsByWineId.set(rec.wine_id, rec);

  const locationText = formatLocation(rec.location);
  const bottleCount = rec.bottle_count ?? 0;
  const card = document.createElement('div');
  card.className = 'recommendation-card';
  card.innerHTML = `
    <div class="rec-header">
      <span class="rec-rank">#${rank}</span>
      <span class="rec-wine-name">${rec.wine_name}</span>
      <span class="rec-vintage">${rec.vintage || 'NV'}</span>
      ${rec.is_priority ? '<span class="priority-badge">★ Priority</span>' : ''}
    </div>
    <div class="rec-location">
      <span class="rec-location-icon">📍</span>
      <span class="rec-location-text">${locationText}</span>
      <span class="rec-bottle-count">(${bottleCount} bottle${bottleCount === 1 ? '' : 's'})</span>
    </div>
    <div class="rec-why">${rec.why}</div>
    ${rec.food_tip ? `<div class="rec-food-tip">💡 ${rec.food_tip}</div>` : ''}
    <div class="rec-serving">
      ${rec.serving_temp ? `🌡️ ${rec.serving_temp}` : ''}
      ${rec.decant_time ? ` | ⏱️ Decant ${rec.decant_time}` : ''}
    </div>
    <div class="rec-actions">
      <button class="btn btn-primary btn-choose-wine" 
              data-wine-id="${rec.wine_id}" 
              data-rank="${rank}">
        Choose This Wine
      </button>
      <button class="btn btn-secondary btn-view-wine" 
              data-wine-id="${rec.wine_id}">
        View Details
      </button>
    </div>
  `;
  card.querySelector('.btn-choose-wine').addEventListener('click', (e) => {
    handleChooseWine(rec, rank, e.target, card);
  });
  card.querySelector('.btn-view-wine').addEventListener('click', () => {
    openWineDetail(rec.wine_id);
  });
  return card;
}

/**
 * Handle "Choose This Wine" button click.
 * Shows drink action panel after choice is recorded.
 * @param {Object} rec - Full recommendation object
 * @param {number} rank - Rank
 * @param {HTMLElement} buttonElement - The clicked button
 * @param {HTMLElement} card - The recommendation card element
 */
async function handleChooseWine(rec, rank, buttonElement, card) {
  if (!currentSessionId) {
    console.warn('No session ID available');
    return;
  }
  try {
    buttonElement.disabled = true;
    buttonElement.textContent = 'Chosen ✓';
    document.querySelectorAll('.btn-choose-wine').forEach(btn => {
      if (btn !== buttonElement) {
        btn.classList.remove('chosen');
        btn.textContent = 'Choose This Wine';
        btn.disabled = false;
      }
    });
    buttonElement.classList.add('chosen');

    // Remove any existing chosen-action panels
    document.querySelectorAll('.rec-chosen-actions').forEach(el => el.remove());

    await choosePairingWine(currentSessionId, rec.wine_id, rank);

    // Show drink action panel on this card
    showDrinkActionPanel(rec, card);

    // Show feedback modal after choosing
    openPairingFeedbackModal(currentSessionId, rec.wine_id);
  } catch (error) {
    console.error('Error recording wine choice:', error);
    buttonElement.disabled = false;
    buttonElement.textContent = 'Choose This Wine';
  }
}

/**
 * Show a drink/consume action panel on the chosen card.
 * @param {Object} rec - Recommendation with location data
 * @param {HTMLElement} card - Card element to append panel to
 */
function showDrinkActionPanel(rec, card) {
  const locations = rec.location && rec.location !== 'Unknown'
    ? rec.location.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  if (locations.length === 0) return;

  const firstLocation = locations[0];
  const panel = document.createElement('div');
  panel.className = 'rec-chosen-actions';
  panel.innerHTML = `
    <div class="rec-chosen-label">🍷 Ready to drink from <strong>${firstLocation}</strong>?</div>
    <button class="btn btn-drink" data-location="${firstLocation}">
      Drink This Bottle
    </button>
  `;

  panel.querySelector('.btn-drink').addEventListener('click', async (e) => {
    const btn = e.target;
    const location = btn.dataset.location;
    try {
      btn.disabled = true;
      btn.textContent = 'Recording...';
      await drinkBottle(location);
      btn.textContent = 'Consumed ✓';
      btn.classList.add('consumed');
      showToast(`Bottle from ${location} marked as consumed`);
      // Update bottle count display on the card
      const countEl = card.querySelector('.rec-bottle-count');
      if (countEl) {
        const newCount = Math.max(0, (rec.bottle_count ?? 1) - 1);
        countEl.textContent = `(${newCount} bottle${newCount === 1 ? '' : 's'})`;
      }
    } catch (err) {
      console.error('Error recording drink:', err);
      btn.disabled = false;
      btn.textContent = 'Drink This Bottle';
      showToast(`Error: ${err.message}`);
    }
  });

  card.appendChild(panel);
}

/**
 * Open the pairing feedback modal and store session/wine context.
 */
function openPairingFeedbackModal(sessionId, wineId) {
  const modal = document.getElementById('pairing-feedback-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  modal.dataset.sessionId = sessionId;
  modal.dataset.wineId = wineId;
}

/**
 * Display recommendations and store sessionId for choice tracking.
 * @param {Object} response - API response with recommendations and sessionId
 */
export function displayRecommendations(response) {
  currentSessionId = response.sessionId || null;
  // Store all recs for detail lookup
  if (response.recommendations) {
    response.recommendations.forEach(rec => {
      if (rec.wine_id) recsByWineId.set(rec.wine_id, rec);
    });
  }
}

/**
 * Open wine detail modal for the given wine ID.
 * @param {number} wineId - Wine ID to show details for
 */
function openWineDetail(wineId) {
  const rec = recsByWineId.get(wineId);
  if (!rec) return;
  showWineModalFromList({
    id: rec.wine_id,
    wine_name: rec.wine_name,
    vintage: rec.vintage || null,
    style: rec.style || null,
    colour: rec.colour || null,
    locations: rec.location || null,
    bottle_count: rec.bottle_count ?? 0
  });
}
