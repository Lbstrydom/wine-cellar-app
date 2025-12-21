/**
 * @fileoverview Wine ratings UI module.
 * @module ratings
 */

import { fetchWineRatingsFromApi, getWineRatings } from './api.js';
import { showToast, escapeHtml } from './utils.js';

/**
 * Render star rating display.
 * @param {number} stars - Star rating (0-5, half increments)
 * @param {string} size - 'small' or 'large'
 * @returns {string} HTML string
 */
export function renderStars(stars, size = 'small') {
  if (stars === null || stars === undefined) {
    return `<span class="stars-unrated ${escapeHtml(size)}">Unrated</span>`;
  }

  const fullStars = Math.floor(stars);
  const hasHalf = stars % 1 >= 0.5;
  const emptyStars = 5 - fullStars - (hasHalf ? 1 : 0);

  let html = `<span class="stars-display ${escapeHtml(size)}">`;
  html += '★'.repeat(fullStars);
  if (hasHalf) html += '½';
  html += '☆'.repeat(emptyStars);
  html += `</span>`;

  return html;
}

/**
 * Render confidence badge.
 * @param {string} level - 'high', 'medium', 'low', 'unrated'
 * @returns {string} HTML string
 */
export function renderConfidenceBadge(level) {
  const labels = {
    high: { text: 'High', className: 'confidence-high' },
    medium: { text: 'Med', className: 'confidence-medium' },
    low: { text: 'Low', className: 'confidence-low' },
    unrated: { text: '-', className: 'confidence-unrated' }
  };
  const config = labels[level] || labels.unrated;
  return `<span class="confidence-badge ${config.className}">${config.text}</span>`;
}

/**
 * Render compact rating display for wine cards.
 * @param {Object} wine - Wine object with rating fields
 * @returns {string} HTML string
 */
export function renderCompactRating(wine) {
  if (!wine.purchase_stars) {
    return '';
  }

  return `
    <div class="wine-rating-compact">
      ${renderStars(wine.purchase_stars, 'small')}
      ${renderConfidenceBadge(wine.confidence_level)}
    </div>
  `;
}

/**
 * Render full ratings panel for wine modal.
 * @param {Object} ratingsData - Full ratings response
 * @returns {string} HTML string
 */
export function renderRatingsPanel(ratingsData) {
  if (!ratingsData || ratingsData.confidence_level === 'unrated') {
    return `
      <div class="ratings-panel unrated">
        <p>No ratings available</p>
        <button class="btn btn-secondary btn-small" id="fetch-ratings-btn">
          Search for Ratings
        </button>
      </div>
    `;
  }

  const { purchase_score, purchase_stars, confidence_level, lens_details, ratings } = ratingsData;

  let html = `
    <div class="ratings-panel">
      <div class="ratings-summary">
        <div class="purchase-score">
          ${renderStars(purchase_stars, 'large')}
          <span class="score-value">${escapeHtml(String(purchase_score))}</span>
          ${renderConfidenceBadge(confidence_level)}
        </div>
        <div class="lens-indices">
  `;

  // Lens breakdown
  const lensLabels = {
    competition: { icon: '🏆', name: 'Competition' },
    critics: { icon: '📝', name: 'Critics' },
    community: { icon: '👥', name: 'Community' }
  };

  for (const [lens, data] of Object.entries(lens_details || {})) {
    const config = lensLabels[lens];
    if (!config) continue;
    const value = data.index !== null ? data.index.toFixed(1) : '-';
    html += `
      <div class="lens-index">
        <span class="lens-icon">${config.icon}</span>
        <span class="lens-name">${config.name}</span>
        <span class="lens-value">${escapeHtml(value)}</span>
      </div>
    `;
  }

  html += `
        </div>
      </div>
      <div class="ratings-detail-toggle">
        <button class="btn btn-text" id="toggle-ratings-detail">
          Show Details ▼
        </button>
      </div>
      <div class="ratings-detail" style="display: none;">
  `;

  // Individual ratings
  if (ratings && ratings.length > 0) {
    for (const rating of ratings) {
      const icon = rating.source_lens === 'competition' ? '🏆' :
                   rating.source_lens === 'critics' ? '📝' : '👥';
      const sourceName = escapeHtml(rating.source_short || rating.source);
      const yearText = rating.competition_year ? `(${escapeHtml(String(rating.competition_year))})` : '';
      const rawScore = escapeHtml(String(rating.raw_score));
      const awardBadge = rating.award_name
        ? `<span class="award-badge">${escapeHtml(rating.award_name)}</span>`
        : '';
      const ratingCountText = rating.rating_count
        ? `${rating.rating_count.toLocaleString()} ratings`
        : '';
      const vintageWarning = rating.vintage_match !== 'exact'
        ? `<span class="vintage-warning">⚠ ${escapeHtml(rating.vintage_match)}</span>`
        : '';

      html += `
        <div class="rating-item">
          <div class="rating-source">
            ${icon} ${sourceName} ${yearText}
          </div>
          <div class="rating-score">
            ${rawScore}
            ${awardBadge}
          </div>
          <div class="rating-meta">
            ${ratingCountText}
            ${vintageWarning}
          </div>
        </div>
      `;
    }
  }

  html += `
      </div>
      <div class="ratings-actions">
        <button class="btn btn-secondary btn-small" id="refresh-ratings-btn">
          Refresh
        </button>
        <button class="btn btn-secondary btn-small" id="add-rating-btn">
          + Add Manual
        </button>
      </div>
    </div>
  `;

  return html;
}

/**
 * Initialize ratings panel event handlers.
 * @param {number} wineId - Wine ID
 */
export function initRatingsPanel(wineId) {
  // Toggle detail view
  const toggleBtn = document.getElementById('toggle-ratings-detail');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const detail = document.querySelector('.ratings-detail');
      if (detail.style.display === 'none') {
        detail.style.display = 'block';
        toggleBtn.textContent = 'Hide Details ▲';
      } else {
        detail.style.display = 'none';
        toggleBtn.textContent = 'Show Details ▼';
      }
    });
  }

  // Fetch ratings
  const fetchBtn = document.getElementById('fetch-ratings-btn');
  if (fetchBtn) {
    fetchBtn.addEventListener('click', () => handleFetchRatings(wineId));
  }

  const refreshBtn = document.getElementById('refresh-ratings-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => handleFetchRatings(wineId));
  }

  // Add manual rating (future enhancement)
  const addBtn = document.getElementById('add-rating-btn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      showToast('Manual rating entry coming soon');
    });
  }
}

/**
 * Handle fetch ratings button click.
 * @param {number} wineId - Wine ID
 */
async function handleFetchRatings(wineId) {
  const fetchBtn = document.getElementById('fetch-ratings-btn');
  const refreshBtn = document.getElementById('refresh-ratings-btn');
  const btn = fetchBtn || refreshBtn;

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Searching...';
  }

  try {
    const result = await fetchWineRatingsFromApi(wineId);
    showToast(`Found ${result.ratings?.length || 0} ratings`);

    // Refresh the ratings display
    const ratingsData = await getWineRatings(wineId);
    const panel = document.querySelector('.ratings-panel-container');
    if (panel) {
      panel.innerHTML = renderRatingsPanel(ratingsData);
      initRatingsPanel(wineId);
    }
  } catch (err) {
    showToast('Error: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = fetchBtn ? 'Search for Ratings' : 'Refresh';
    }
  }
}
