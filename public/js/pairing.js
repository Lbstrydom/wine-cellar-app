/**
 * @fileoverview Pairing UI logic: recommendation cards, choose button, feedback integration.
 */

import { choosePairingWine } from './api.js';

let currentSessionId = null;

/**
 * Render a single recommendation card with "Choose This Wine" button.
 * @param {Object} rec - Recommendation object
 * @param {number} rank - Rank of the recommendation
 * @returns {HTMLElement} Card element
 */
export function renderRecommendation(rec, rank) {
  const card = document.createElement('div');
  card.className = 'recommendation-card';
  card.innerHTML = `
    <div class="rec-header">
      <span class="rec-rank">#${rank}</span>
      <span class="rec-wine-name">${rec.wine_name}</span>
      <span class="rec-vintage">${rec.vintage || 'NV'}</span>
      ${rec.is_priority ? '<span class="priority-badge">★ Priority</span>' : ''}
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
    handleChooseWine(rec.wine_id, rank, e.target);
  });
  card.querySelector('.btn-view-wine').addEventListener('click', () => {
    openWineDetail(rec.wine_id);
  });
  return card;
}

/**
 * Handle "Choose This Wine" button click.
 */
async function handleChooseWine(wineId, rank, buttonElement) {
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
    await choosePairingWine(currentSessionId, wineId, rank);
    // Show feedback modal after choosing
    openPairingFeedbackModal(currentSessionId, wineId);
  } catch (error) {
    console.error('Error recording wine choice:', error);
    buttonElement.disabled = false;
    buttonElement.textContent = 'Choose This Wine';
  }
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
  // ...existing display logic to render cards...
}

function openWineDetail(_wineId) {
  // ...existing logic to open wine detail modal...
}
