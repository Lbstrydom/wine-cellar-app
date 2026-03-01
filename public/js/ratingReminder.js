/**
 * @fileoverview Rating reminder bar for consumed wines pending rating.
 * Non-blocking collapsed bar with expandable inline rating cards.
 * Uses role="status" (polite live region) — not role="alert".
 * @module ratingReminder
 */

import { getPendingRatings, resolvePendingRating, dismissAllPendingRatings } from './api/pendingRatings.js';
import { showToast, escapeHtml } from './utils.js';

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
      <button class="btn btn-sm btn-primary" id="rating-bar-expand">Review</button>
      <button class="btn btn-sm btn-secondary" id="rating-bar-dismiss">Dismiss</button>
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
      showToast('Reminders dismissed');
    } catch {
      showToast('Failed to dismiss reminders');
    }
  });
}

/**
 * Render expanded view with individual rating cards.
 * @param {Object[]} needsRating - Items needing a rating
 * @param {Object[]} alreadyRated - Items with existing rating
 */
function renderExpandedCards(needsRating, alreadyRated) {
  const expanded = document.getElementById('rating-bar-expanded');
  if (!expanded) return;

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
    <div class="rating-bar-footer">
      <button class="btn btn-sm btn-secondary" id="rating-bar-dismiss-all">Dismiss All Remaining</button>
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
          <span class="text-muted">consumed ${dateStr}</span>
        </div>
        <div class="rating-card-status">
          ✓ Rated ${item.existing_rating}/5
          <button class="btn btn-xs btn-secondary rating-card-confirm" data-id="${item.id}">OK</button>
        </div>
      </div>
    `;
  }

  return `
    <div class="rating-card" data-id="${item.id}" data-wine-id="${item.wine_id}">
      <div class="rating-card-info">
        <strong>${escapeHtml(item.wine_name)} ${item.vintage || 'NV'}</strong>
        ${colourBadge}
        <span class="text-muted">consumed ${dateStr} from ${item.location_code || '?'}</span>
      </div>
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
        <button class="btn btn-xs btn-primary rating-card-save" data-id="${item.id}">Save</button>
        <button class="btn btn-xs btn-secondary rating-card-skip" data-id="${item.id}">Skip</button>
      </div>
    </div>
  `;
}

/**
 * Wire event listeners for a rating card.
 * @param {HTMLElement} card - Card DOM element
 */
function wireRatingCard(card) {
  const id = card.dataset.id;

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

      try {
        saveBtn.disabled = true;
        saveBtn.textContent = '...';
        await resolvePendingRating(id, 'rated', rating, notesInput?.value || undefined);
        showToast(`Rated ${rating}/5 — saved!`);
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
