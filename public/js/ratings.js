/**
 * @fileoverview Wine ratings UI module.
 * @module ratings
 */

import {
  fetchWineRatingsFromApi,
  fetchRatingsAsync,
  getRatingsJobStatus,
  getWineRatings,
  addManualRating,
  deleteRating,
  fetchWine,
  fetchLayout
} from './api.js';
import { showToast, escapeHtml } from './utils.js';
import { state } from './app.js';

// Main rating sources for the dropdown
const MAIN_RATING_SOURCES = [
  { id: 'decanter', name: 'Decanter World Wine Awards', short: 'DWWA', lens: 'competition', score_type: 'medal' },
  { id: 'iwc', name: 'International Wine Challenge', short: 'IWC', lens: 'competition', score_type: 'medal' },
  { id: 'iwsc', name: 'Int\'l Wine & Spirit Competition', short: 'IWSC', lens: 'competition', score_type: 'medal' },
  { id: 'veritas', name: 'Veritas Awards', short: 'Veritas', lens: 'competition', score_type: 'medal' },
  { id: 'old_mutual', name: 'Old Mutual Trophy Wine Show', short: 'Old Mutual', lens: 'competition', score_type: 'medal' },
  { id: 'concours_mondial', name: 'Concours Mondial de Bruxelles', short: 'CMB', lens: 'competition', score_type: 'medal' },
  { id: 'mundus_vini', name: 'Mundus Vini', short: 'Mundus Vini', lens: 'competition', score_type: 'medal' },
  { id: 'james_suckling', name: 'James Suckling', short: 'Suckling', lens: 'critics', score_type: 'points' },
  { id: 'wine_advocate', name: 'Wine Advocate / Robert Parker', short: 'Wine Advocate', lens: 'critics', score_type: 'points' },
  { id: 'wine_spectator', name: 'Wine Spectator', short: 'Wine Spectator', lens: 'critics', score_type: 'points' },
  { id: 'wine_enthusiast', name: 'Wine Enthusiast', short: 'Wine Enthusiast', lens: 'critics', score_type: 'points' },
  { id: 'jancis_robinson', name: 'Jancis Robinson', short: 'Jancis Robinson', lens: 'critics', score_type: 'points' },
  { id: 'tim_atkin', name: 'Tim Atkin MW', short: 'Tim Atkin', lens: 'critics', score_type: 'points' },
  { id: 'platters', name: 'Platter\'s Wine Guide', short: 'Platter\'s', lens: 'critics', score_type: 'stars' },
  { id: 'decanter_magazine', name: 'Decanter Magazine', short: 'Decanter Mag', lens: 'critics', score_type: 'points' },
  { id: 'vivino', name: 'Vivino', short: 'Vivino', lens: 'community', score_type: 'stars' },
  { id: 'cellar_tracker', name: 'CellarTracker', short: 'CellarTracker', lens: 'community', score_type: 'points' }
];

// Medal options for competition sources
const MEDAL_OPTIONS = [
  { value: 'Platinum', label: 'Platinum' },
  { value: 'Trophy', label: 'Trophy' },
  { value: 'Double Gold', label: 'Double Gold' },
  { value: 'Grand Gold', label: 'Grand Gold' },
  { value: 'Gold Outstanding', label: 'Gold Outstanding' },
  { value: 'Gold', label: 'Gold' },
  { value: 'Silver', label: 'Silver' },
  { value: 'Bronze', label: 'Bronze' },
  { value: 'Commended', label: 'Commended' }
];

// Current wine ID for manual rating form (used in hideManualRatingForm)
let _currentManualRatingWineId = null;

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
 * Render full ratings panel for wine modal.
 * @param {Object} ratingsData - Full ratings response
 * @returns {string} HTML string
 */
export function renderRatingsPanel(ratingsData) {
  if (!ratingsData || ratingsData.confidence_level === 'unrated') {
    return `
      <div class="ratings-panel unrated">
        <p>No ratings available</p>
        <div id="ratings-progress" class="progress-container" style="display: none;">
          <div class="progress-bar-wrapper">
            <div id="ratings-progress-bar" class="progress-bar"></div>
          </div>
          <span id="ratings-progress-text" class="progress-text">Starting...</span>
        </div>
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
        <div class="rating-item" data-rating-id="${rating.id}">
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
          <button class="rating-delete-btn" data-rating-id="${rating.id}" title="Delete rating">×</button>
        </div>
      `;
    }
  }

  html += `
      </div>
  `;

  // Local awards from awards database
  const localAwards = ratingsData.local_awards || [];
  if (localAwards.length > 0) {
    html += `
      <div class="local-awards-section">
        <h4 class="local-awards-title">Awards Database</h4>
        <div class="local-awards-list">
    `;
    for (const award of localAwards) {
      const awardClass = getAwardClass(award.award);
      html += `
        <div class="local-award-item">
          <span class="local-award-badge ${awardClass}">${escapeHtml(award.award)}</span>
          <span class="local-award-comp">${escapeHtml(award.competition)} ${award.year || ''}</span>
          ${award.category ? `<span class="local-award-category">${escapeHtml(award.category)}</span>` : ''}
        </div>
      `;
    }
    html += `
        </div>
      </div>
    `;
  }

  html += `
      <div id="ratings-progress" class="progress-container" style="display: none;">
        <div class="progress-bar-wrapper">
          <div id="ratings-progress-bar" class="progress-bar"></div>
        </div>
        <span id="ratings-progress-text" class="progress-text">Starting...</span>
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
 * Get CSS class for award badge based on award type.
 * @param {string} award - Award name
 * @returns {string} CSS class
 */
function getAwardClass(award) {
  if (!award) return '';
  const lower = award.toLowerCase();
  if (lower.includes('trophy') || lower.includes('platinum') || lower.includes('best')) {
    return 'award-trophy';
  }
  if (lower.includes('double gold') || lower.includes('grand gold')) {
    return 'award-double-gold';
  }
  if (lower.includes('gold')) {
    return 'award-gold';
  }
  if (lower.includes('silver')) {
    return 'award-silver';
  }
  if (lower.includes('bronze')) {
    return 'award-bronze';
  }
  return '';
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

  // Add manual rating
  const addBtn = document.getElementById('add-rating-btn');
  if (addBtn) {
    addBtn.addEventListener('click', () => showManualRatingForm(wineId));
  }

  // Delete rating buttons
  document.querySelectorAll('.rating-delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const ratingId = btn.dataset.ratingId;
      handleDeleteRating(wineId, ratingId);
    });
  });
}

/**
 * Handle delete rating button click.
 * @param {number} wineId - Wine ID
 * @param {number} ratingId - Rating ID
 */
async function handleDeleteRating(wineId, ratingId) {
  if (!confirm('Delete this rating?')) return;

  try {
    await deleteRating(wineId, ratingId);
    showToast('Rating deleted');

    // Refresh ratings display
    const ratingsData = await getWineRatings(wineId);
    const panel = document.querySelector('.ratings-panel-container');
    if (panel) {
      panel.innerHTML = renderRatingsPanel(ratingsData);
      initRatingsPanel(wineId);
    }
  } catch (err) {
    showToast('Error: ' + err.message);
  }
}

/**
 * Handle fetch ratings button click.
 * Uses async job queue with progress polling for better UX.
 * @param {number} wineId - Wine ID
 * @param {boolean} useAsync - Whether to use async endpoint (default true)
 */
async function handleFetchRatings(wineId, useAsync = true) {
  const fetchBtn = document.getElementById('fetch-ratings-btn');
  const refreshBtn = document.getElementById('refresh-ratings-btn');
  const btn = fetchBtn || refreshBtn;
  const progressContainer = document.getElementById('ratings-progress');
  const progressBar = document.getElementById('ratings-progress-bar');
  const progressText = document.getElementById('ratings-progress-text');

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Fetching...';
  }

  // Show progress bar if async and progress elements exist
  if (useAsync && progressContainer) {
    progressContainer.style.display = 'block';
    if (progressBar) progressBar.style.width = '0%';
    if (progressText) progressText.textContent = 'Queuing job...';
  }

  try {
    if (useAsync) {
      // Queue async job
      let jobId;

      try {
        const queueResponse = await fetchRatingsAsync(wineId);
        jobId = queueResponse.jobId;
      } catch (_err) {
        // Fall back to sync if async endpoint fails
        console.warn('Async endpoint failed, falling back to sync');
        return handleFetchRatings(wineId, false);
      }

      // Poll for progress
      const result = await pollJobProgress(jobId, (progress, message) => {
        if (progressBar) progressBar.style.width = `${progress}%`;
        if (progressText) progressText.textContent = message || `${progress}%`;
      });

      // Show result
      if (result && result.ratingsFound !== undefined) {
        showToast(`Found ${result.ratingsFound} ratings`);
      } else {
        showToast('Ratings updated');
      }
    } else {
      // Fallback to synchronous fetch
      const result = await fetchWineRatingsFromApi(wineId);
      showToast(result.message || 'Ratings updated');
    }

    // Refresh the ratings display AND wine details (for tasting notes)
    if (progressText) progressText.textContent = 'Loading results...';

    // FIX: Fetch BOTH ratings AND wine details in parallel
    // The wine details contain tasting_notes which is stored in the wines table
    const [ratingsData, wineData] = await Promise.all([
      getWineRatings(wineId),
      fetchWine(wineId)
    ]);

    // 1. Update ratings panel
    const panel = document.querySelector('.ratings-panel-container');
    if (panel) {
      panel.innerHTML = renderRatingsPanel(ratingsData);
      initRatingsPanel(wineId);
    }

    // 2. Update tasting notes directly in the modal DOM
    const tastingNotesField = document.getElementById('modal-tasting-notes-field');
    const tastingNotesText = document.getElementById('modal-tasting-notes');

    if (tastingNotesField && tastingNotesText) {
      if (wineData?.tasting_notes) {
        tastingNotesField.style.display = 'block';
        tastingNotesText.textContent = wineData.tasting_notes;
        console.log('[TastingNotes] Updated modal with fresh tasting notes');
      } else {
        tastingNotesField.style.display = 'none';
        console.log('[TastingNotes] No tasting notes in wine data');
      }
    }

    // 3. Update local slot state for consistency (if modal has currentSlot reference)
    if (window.currentSlot) {
      window.currentSlot.tasting_notes = wineData?.tasting_notes || null;
    }

    // Also refresh layout state for grid consistency
    state.layout = await fetchLayout();

  } catch (err) {
    showToast('Error: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = fetchBtn ? 'Search for Ratings' : 'Refresh';
    }
    if (progressContainer) {
      progressContainer.style.display = 'none';
    }
  }
}

/**
 * Poll job status until complete.
 * @param {number} jobId - Job ID
 * @param {Function} onProgress - Progress callback (progress, message)
 * @returns {Promise<Object>} Job result
 */
async function pollJobProgress(jobId, onProgress) {
  const pollInterval = 1000; // 1 second
  const maxPolls = 120; // 2 minutes max

  for (let i = 0; i < maxPolls; i++) {
    const status = await getRatingsJobStatus(jobId);

    onProgress(status.progress || 0, status.progress_message);

    if (status.status === 'completed') {
      return status.result;
    }

    if (status.status === 'failed') {
      const error = status.result?.error || 'Job failed';
      throw new Error(error);
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  throw new Error('Job timed out');
}

/**
 * Show manual rating form.
 * @param {number} wineId - Wine ID
 */
function showManualRatingForm(wineId) {
  _currentManualRatingWineId = wineId;

  // Check if form already exists
  const formContainer = document.getElementById('manual-rating-form');
  if (formContainer) {
    formContainer.remove();
  }

  // Build source options grouped by lens
  const competitionSources = MAIN_RATING_SOURCES.filter(s => s.lens === 'competition');
  const criticsSources = MAIN_RATING_SOURCES.filter(s => s.lens === 'critics');
  const communitySources = MAIN_RATING_SOURCES.filter(s => s.lens === 'community');

  const sourceOptions = `
    <optgroup label="Competitions">
      ${competitionSources.map(s => `<option value="${s.id}" data-score-type="${s.score_type}">${escapeHtml(s.name)}</option>`).join('')}
    </optgroup>
    <optgroup label="Critics">
      ${criticsSources.map(s => `<option value="${s.id}" data-score-type="${s.score_type}">${escapeHtml(s.name)}</option>`).join('')}
    </optgroup>
    <optgroup label="Community">
      ${communitySources.map(s => `<option value="${s.id}" data-score-type="${s.score_type}">${escapeHtml(s.name)}</option>`).join('')}
    </optgroup>
    <optgroup label="Other">
      <option value="other" data-score-type="points">Other (specify below)</option>
    </optgroup>
  `;

  const medalOptions = MEDAL_OPTIONS.map(m =>
    `<option value="${escapeHtml(m.value)}">${escapeHtml(m.label)}</option>`
  ).join('');

  const currentYear = new Date().getFullYear();

  const formHtml = `
    <div id="manual-rating-form" class="manual-rating-form">
      <h4>Add Manual Rating</h4>
      <div class="form-row">
        <div class="form-field">
          <label for="rating-source">Source</label>
          <select id="rating-source">
            ${sourceOptions}
          </select>
        </div>
      </div>
      <div class="form-row" id="other-source-row" style="display: none;">
        <div class="form-field">
          <label for="rating-other-source">Source Name</label>
          <input type="text" id="rating-other-source" placeholder="e.g., Wine Magazine" />
        </div>
      </div>
      <div class="form-row" id="medal-row">
        <div class="form-field">
          <label for="rating-medal">Medal/Award</label>
          <select id="rating-medal">
            ${medalOptions}
          </select>
        </div>
      </div>
      <div class="form-row" id="points-row" style="display: none;">
        <div class="form-field">
          <label for="rating-points">Score</label>
          <input type="number" id="rating-points" min="0" max="100" step="0.5" placeholder="e.g., 92" />
          <small class="form-hint">Points out of 100 (or 20 for Jancis)</small>
        </div>
      </div>
      <div class="form-row" id="stars-row" style="display: none;">
        <div class="form-field">
          <label for="rating-stars">Stars</label>
          <select id="rating-stars">
            <option value="5">5 Stars</option>
            <option value="4.5">4.5 Stars</option>
            <option value="4">4 Stars</option>
            <option value="3.5">3.5 Stars</option>
            <option value="3">3 Stars</option>
            <option value="2.5">2.5 Stars</option>
            <option value="2">2 Stars</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-field">
          <label for="rating-year">Competition Year (optional)</label>
          <input type="number" id="rating-year" min="2000" max="${currentYear}" placeholder="${currentYear}" />
        </div>
      </div>
      <div class="form-row">
        <div class="form-field">
          <label for="rating-url">Source URL (optional)</label>
          <input type="url" id="rating-url" placeholder="https://..." />
        </div>
      </div>
      <div class="manual-rating-actions">
        <button type="button" class="btn btn-primary btn-small" id="save-manual-rating-btn">Save Rating</button>
        <button type="button" class="btn btn-secondary btn-small" id="cancel-manual-rating-btn">Cancel</button>
      </div>
    </div>
  `;

  // Insert after ratings actions
  const ratingsActions = document.querySelector('.ratings-actions');
  if (ratingsActions) {
    ratingsActions.insertAdjacentHTML('afterend', formHtml);
  } else {
    // If no ratings panel, insert at end of ratings container
    const container = document.getElementById('modal-ratings-container');
    if (container) {
      container.insertAdjacentHTML('beforeend', formHtml);
    }
  }

  // Add event listeners
  initManualRatingForm(wineId);
}

/**
 * Initialize manual rating form event handlers.
 * @param {number} wineId - Wine ID
 */
function initManualRatingForm(wineId) {
  const sourceSelect = document.getElementById('rating-source');
  const saveBtn = document.getElementById('save-manual-rating-btn');
  const cancelBtn = document.getElementById('cancel-manual-rating-btn');

  // Handle source change to show appropriate score input
  if (sourceSelect) {
    sourceSelect.addEventListener('change', handleSourceChange);
    // Trigger initial state
    handleSourceChange();
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', () => handleSaveManualRating(wineId));
  }

  if (cancelBtn) {
    cancelBtn.addEventListener('click', hideManualRatingForm);
  }
}

/**
 * Handle source selection change.
 */
function handleSourceChange() {
  const sourceSelect = document.getElementById('rating-source');
  const selectedOption = sourceSelect.options[sourceSelect.selectedIndex];
  const scoreType = selectedOption.dataset.scoreType;
  const sourceId = sourceSelect.value;

  const medalRow = document.getElementById('medal-row');
  const pointsRow = document.getElementById('points-row');
  const starsRow = document.getElementById('stars-row');
  const otherSourceRow = document.getElementById('other-source-row');

  // Hide all score rows first
  medalRow.style.display = 'none';
  pointsRow.style.display = 'none';
  starsRow.style.display = 'none';
  otherSourceRow.style.display = 'none';

  // Show appropriate score input
  if (scoreType === 'medal') {
    medalRow.style.display = 'flex';
  } else if (scoreType === 'stars') {
    starsRow.style.display = 'flex';
  } else {
    pointsRow.style.display = 'flex';
  }

  // Show other source input if "Other" selected
  if (sourceId === 'other') {
    otherSourceRow.style.display = 'flex';
  }
}

/**
 * Handle save manual rating.
 * @param {number} wineId - Wine ID
 */
async function handleSaveManualRating(wineId) {
  const sourceSelect = document.getElementById('rating-source');
  const selectedOption = sourceSelect.options[sourceSelect.selectedIndex];
  const scoreType = selectedOption.dataset.scoreType;
  const sourceId = sourceSelect.value;

  // Get the score based on type
  let rawScore;
  let awardName = null;

  if (scoreType === 'medal') {
    const medalSelect = document.getElementById('rating-medal');
    rawScore = medalSelect.value;
    awardName = medalSelect.value;
  } else if (scoreType === 'stars') {
    rawScore = document.getElementById('rating-stars').value;
  } else {
    rawScore = document.getElementById('rating-points').value;
  }

  if (!rawScore) {
    showToast('Please enter a score');
    return;
  }

  // Handle "Other" source
  let customSourceName = null;
  if (sourceId === 'other') {
    customSourceName = document.getElementById('rating-other-source').value.trim();
    if (!customSourceName) {
      showToast('Please enter the source name');
      return;
    }
  }

  const competitionYear = document.getElementById('rating-year').value || null;
  const sourceUrl = document.getElementById('rating-url').value || null;

  const saveBtn = document.getElementById('save-manual-rating-btn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';

  try {
    await addManualRating(wineId, {
      source: sourceId,
      score_type: scoreType,
      raw_score: rawScore,
      award_name: awardName,
      competition_year: competitionYear,
      source_url: sourceUrl,
      custom_source_name: customSourceName
    });

    showToast('Rating added');
    hideManualRatingForm();

    // Refresh ratings display
    const ratingsData = await getWineRatings(wineId);
    const panel = document.querySelector('.ratings-panel-container');
    if (panel) {
      panel.innerHTML = renderRatingsPanel(ratingsData);
      initRatingsPanel(wineId);
    }
  } catch (err) {
    showToast('Error: ' + err.message);
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Rating';
  }
}

/**
 * Hide manual rating form.
 */
function hideManualRatingForm() {
  const form = document.getElementById('manual-rating-form');
  if (form) {
    form.remove();
  }
  _currentManualRatingWineId = null;
}

/**
 * Update tasting notes display in the modal from layout state.
 * This is a fallback - the primary update now happens directly in handleFetchRatings.
 * @param {number} wineId - Wine ID
 */
function _updateTastingNotesDisplay(wineId) {
  if (!state.layout) return;

  // Find the wine's slot in the layout
  const allSlots = [
    ...state.layout.fridge.rows.flatMap(r => r.slots),
    ...state.layout.cellar.rows.flatMap(r => r.slots)
  ];

  // Try both number and string comparison for type safety
  let slot = allSlots.find(s => s.wine_id === wineId);
  if (!slot) {
    slot = allSlots.find(s => String(s.wine_id) === String(wineId));
  }

  if (!slot) return;

  // Update the tasting notes field in the modal
  const tastingNotesField = document.getElementById('modal-tasting-notes-field');
  const tastingNotesText = document.getElementById('modal-tasting-notes');

  if (tastingNotesField && tastingNotesText) {
    if (slot.tasting_notes) {
      tastingNotesField.style.display = 'block';
      tastingNotesText.textContent = slot.tasting_notes;
    } else {
      tastingNotesField.style.display = 'none';
    }
  }
}
