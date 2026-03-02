/**
 * @fileoverview Rating reminder bar for consumed wines pending rating.
 * Non-blocking collapsed bar with expandable inline rating cards.
 * Uses role="status" (polite live region) — not role="alert".
 * @module ratingReminder
 */

import { getPendingRatings, resolvePendingRating, dismissAllPendingRatings } from './api/pendingRatings.js';
import { showToast, escapeHtml } from './utils.js';

/** @type {Map<string, Object>} Pending item data keyed by string ID */
const _pendingItems = new Map();

/**
 * Check for pending ratings and show reminder bar if any exist.
 * Called once during startAuthenticatedApp() after loadInitialData().
 * Fire-and-forget — failures are silently ignored.
 */
export async function checkPendingRatings() {
  try {
    const { needsRating, alreadyRated } = await getPendingRatings();
    const total = needsRating.length + alreadyRated.length;
    if (total === 0) return;
    showRatingBar(needsRating, alreadyRated);
  } catch {
    // Silent fail — reminder is non-critical
  }
}

/**
 * Show the collapsed rating reminder bar.
 * @param {Object[]} needsRating - Items that need a rating
 * @param {Object[]} alreadyRated - Items that already have a rating on consumption_log
 */
function showRatingBar(needsRating, alreadyRated) {
  const container = document.getElementById('rating-reminder-bar');
  if (!container) return;
  const total = needsRating.length + alreadyRated.length;

  container.innerHTML = `
    <div class="rating-bar-collapsed">
      <span class="rating-bar-text">🍷 You have ${total} wine${total > 1 ? 's' : ''} to rate from recent tastings</span>
      <button class="btn btn-small btn-primary" id="rating-bar-expand">Review</button>
      <button class="btn btn-small btn-secondary" id="rating-bar-dismiss">Dismiss</button>
    </div>
    <div class="rating-bar-expanded" id="rating-bar-expanded" style="display:none;"></div>
  `;
  container.style.display = 'block';

  document.getElementById('rating-bar-expand').addEventListener('click', () => {
    const expanded = document.getElementById('rating-bar-expanded');
    if (expanded.style.display === 'none') {
      renderExpandedCards(needsRating, alreadyRated);
      expanded.style.display = 'block';
      document.getElementById('rating-bar-expand').textContent = 'Collapse';
    } else {
      expanded.style.display = 'none';
      document.getElementById('rating-bar-expand').textContent = 'Review';
    }
  });

  document.getElementById('rating-bar-dismiss').addEventListener('click', async () => {
    try {
      await dismissAllPendingRatings();
      container.style.display = 'none';
      _pendingItems.clear();
      showToast('Reminders dismissed');
    } catch {
      showToast('Failed to dismiss reminders');
    }
  });
}

/**
 * Render expanded view with individual rating cards.
 * Populates _pendingItems map for card event handlers.
 * @param {Object[]} needsRating - Items needing a rating
 * @param {Object[]} alreadyRated - Items with existing rating
 */
function renderExpandedCards(needsRating, alreadyRated) {
  const expanded = document.getElementById('rating-bar-expanded');
  if (!expanded) return;

  // Rebuild the item map for this render pass
  _pendingItems.clear();
  for (const item of needsRating) {
    _pendingItems.set(String(item.id), item);
  }
  for (const item of alreadyRated) {
    _pendingItems.set(String(item.id), item);
  }

  let html = '';

  // Items needing rating
  for (const item of needsRating) {
    html += renderRatingCard(item, false);
  }

  // Items already rated (via wine detail modal or other path)
  for (const item of alreadyRated) {
    html += renderRatingCard(item, true);
  }

  html += `
    <div class="dismiss-all-bar">
      <button class="btn btn-small btn-secondary" id="rating-bar-dismiss-all">Dismiss All Remaining</button>
    </div>
  `;

  expanded.innerHTML = html;

  // Wire up all card actions
  expanded.querySelectorAll('.rating-card').forEach(card => {
    wireRatingCard(card);
  });

  document.getElementById('rating-bar-dismiss-all')?.addEventListener('click', async () => {
    try {
      await dismissAllPendingRatings();
      const container = document.getElementById('rating-reminder-bar');
      if (container) container.style.display = 'none';
      _pendingItems.clear();
      showToast('All reminders dismissed');
    } catch {
      showToast('Failed to dismiss reminders');
    }
  });
}

/**
 * Render a single rating card.
 * @param {Object} item - Pending rating item
 * @param {boolean} hasExistingRating - Whether consumption_log already has a rating
 * @returns {string} HTML string
 */
function renderRatingCard(item, hasExistingRating) {
  const dateStr = item.consumed_at
    ? new Date(item.consumed_at).toLocaleDateString()
    : 'recently';

  const colourBadge = item.colour
    ? `<span class="rating-card-colour ${item.colour}">${item.colour}</span>`
    : '';

  if (hasExistingRating) {
    return `
      <div class="rating-card rating-card-done" data-id="${item.id}">
        <div class="rating-card-info">
          <strong>${escapeHtml(item.wine_name)} ${item.vintage || 'NV'}</strong>
          ${colourBadge}
          <span class="rating-card-meta">consumed ${dateStr}</span>
        </div>
        <div class="rating-card-existing">
          ✓ Rated ${item.existing_rating}/5
          <button class="btn btn-small btn-secondary rating-card-confirm" data-id="${item.id}">OK</button>
        </div>
      </div>
    `;
  }

  const previousRatingHint = item.previous_rating
    ? `<div class="rating-card-previous">Previously rated ${item.previous_rating}/5</div>`
    : '';

  let pairingSection = '';
  if (item.pairing_session_id && item.pairing_dish) {
    if (item.pairing_already_rated) {
      pairingSection = `<div class="rating-card-pairing-done">🍽 Paired with ${escapeHtml(item.pairing_dish)} — feedback recorded</div>`;
    } else {
      pairingSection = `
        <div class="rating-card-pairing">
          <button type="button" class="rating-card-pairing-toggle">
            🍽 Paired with: <strong>${escapeHtml(item.pairing_dish)}</strong>
            <span class="pairing-expand-hint">Rate pairing ▸</span>
          </button>
          <div class="rating-card-pairing-controls" style="display:none">
            <label>Pairing fit:
              <select class="pairing-fit-select">
                <option value="">—</option>
                <option value="5">5 Perfect</option>
                <option value="4">4 Very Good</option>
                <option value="3">3 Good</option>
                <option value="2">2 Okay</option>
                <option value="1">1 Poor</option>
              </select>
            </label>
            <span class="pairing-pair-again">
              Pair again?
              <label><input type="radio" name="pair-again-${item.id}" value="true"> Yes</label>
              <label><input type="radio" name="pair-again-${item.id}" value="false"> No</label>
            </span>
          </div>
        </div>
      `;
    }
  }

  return `
    <div class="rating-card" data-id="${item.id}" data-wine-id="${item.wine_id}">
      <div class="rating-card-info">
        <strong>${escapeHtml(item.wine_name)} ${item.vintage || 'NV'}</strong>
        ${colourBadge}
        <span class="rating-card-meta">consumed ${dateStr} from ${item.location_code || '?'}</span>
      </div>
      ${previousRatingHint}
      <div class="rating-card-controls">
        <label>
          Rating:
          <select class="rating-card-select">
            <option value="">—</option>
            <option value="1">1 ★</option>
            <option value="2">2 ★★</option>
            <option value="3">3 ★★★</option>
            <option value="4">4 ★★★★</option>
            <option value="5">5 ★★★★★</option>
          </select>
        </label>
        <input type="text" class="rating-card-notes" placeholder="Quick note (optional)" maxlength="500" />
        <button class="btn btn-small btn-primary rating-card-save" data-id="${item.id}">Save</button>
        <button class="btn btn-small btn-secondary rating-card-skip" data-id="${item.id}">Skip</button>
      </div>
      ${pairingSection}
    </div>
  `;
}

/**
 * Wire event listeners for a rating card.
 * @param {HTMLElement} card - Card DOM element
 */
function wireRatingCard(card) {
  const id = card.dataset.id;
  const item = _pendingItems.get(id);

  // "OK" button for already-rated items → dismiss
  const confirmBtn = card.querySelector('.rating-card-confirm');
  if (confirmBtn) {
    confirmBtn.addEventListener('click', async () => {
      try {
        await resolvePendingRating(id, 'dismissed');
        removeCard(card);
      } catch {
        showToast('Failed to dismiss');
      }
    });
    return;
  }

  // Pre-select rating dropdown if a previous wine-level rating exists
  if (item?.previous_rating) {
    const select = card.querySelector('.rating-card-select');
    if (select) select.value = String(Math.round(item.previous_rating));
  }

  // Pairing toggle
  const pairingToggle = card.querySelector('.rating-card-pairing-toggle');
  if (pairingToggle) {
    pairingToggle.addEventListener('click', () => {
      const controls = card.querySelector('.rating-card-pairing-controls');
      const hint = card.querySelector('.pairing-expand-hint');
      const isHidden = controls.style.display === 'none';
      controls.style.display = isHidden ? 'flex' : 'none';
      hint.textContent = isHidden ? '▾' : 'Rate pairing ▸';
    });
  }

  // Save rating
  const saveBtn = card.querySelector('.rating-card-save');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const select = card.querySelector('.rating-card-select');
      const notesInput = card.querySelector('.rating-card-notes');
      const rating = select?.value ? parseInt(select.value, 10) : null;

      if (!rating) {
        showToast('Please select a rating');
        return;
      }

      // Collect pairing feedback if controls are present and a fit rating is selected
      let pairingFeedback;
      const pairingFitSelect = card.querySelector('.pairing-fit-select');
      if (pairingFitSelect?.value) {
        const wouldPairAgainEl = card.querySelector(`input[name="pair-again-${id}"]:checked`);
        pairingFeedback = {
          pairingFitRating: parseInt(pairingFitSelect.value, 10),
          wouldPairAgain: wouldPairAgainEl ? wouldPairAgainEl.value === 'true' : null
        };
      }

      try {
        saveBtn.disabled = true;
        saveBtn.textContent = '...';
        const result = await resolvePendingRating(id, 'rated', rating, notesInput?.value || undefined, pairingFeedback);
        if (result.pairingFeedbackError) {
          showToast(`Rated ${rating}/5 — pairing feedback could not be saved`, 4000);
        } else if (pairingFeedback) {
          showToast(`Rated ${rating}/5 + pairing feedback saved!`);
        } else {
          showToast(`Rated ${rating}/5 — saved!`);
        }
        removeCard(card);
      } catch {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
        showToast('Failed to save rating');
      }
    });
  }

  // Skip (dismiss)
  const skipBtn = card.querySelector('.rating-card-skip');
  if (skipBtn) {
    skipBtn.addEventListener('click', async () => {
      try {
        await resolvePendingRating(id, 'dismissed');
        removeCard(card);
      } catch {
        showToast('Failed to dismiss');
      }
    });
  }
}

/**
 * Remove a card from DOM and hide bar if no cards remain.
 * @param {HTMLElement} card - Card to remove
 */
function removeCard(card) {
  card.remove();
  const expanded = document.getElementById('rating-bar-expanded');
  const remainingCards = expanded?.querySelectorAll('.rating-card');
  if (!remainingCards || remainingCards.length === 0) {
    const container = document.getElementById('rating-reminder-bar');
    if (container) container.style.display = 'none';
  }
}
