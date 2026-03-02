/**
 * @fileoverview Wine Research modal for searching ratings before buying.
 * Opens from shopping cart items (planned/ordered status) and displays
 * enrichment data (ratings, drinking window, narrative, food pairings)
 * fetched via POST /api/acquisition/enrich.
 * @module recipes/wineResearch
 */

import { enrichWine } from '../api/index.js';
import { escapeHtml } from '../utils.js';
import { renderWineProfile } from '../wineProfile.js';

/** @type {HTMLElement|null} */
let _overlayEl = null;

/** @type {HTMLElement|null} - Element that had focus before modal opened */
let _triggerEl = null;

/**
 * Open the wine research modal for a cart item.
 * Shows a preview of search terms first, then fetches enrichment data on confirmation.
 * @param {Object} item - Cart item with wine_name, producer, vintage, etc.
 */
export async function openWineResearchModal(item) {
  // Double-open guard
  if (_overlayEl) closeModal();

  _triggerEl = document.activeElement;

  // Create modal DOM
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay wine-research-overlay active';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Wine research');

  const vintageText = item.vintage ? ` ${item.vintage}` : '';
  const producerText = item.producer ? `${escapeHtml(item.producer)} · ` : '';

  overlay.innerHTML = `
    <div class="modal modal-large wine-research-modal">
      <button class="modal-close-x wine-research-close" type="button" aria-label="Close">&times;</button>
      <h2>${escapeHtml(item.wine_name)}${vintageText}</h2>
      <p class="wine-research-subtitle">${producerText}Research before buying</p>
      <div class="wine-research-body">
        ${renderSearchPreview(item)}
      </div>
      <div class="modal-actions">
        <button class="btn btn-primary btn-small wine-research-search-btn" type="button">🔍 Search</button>
        <button class="btn btn-secondary btn-small wine-research-close-btn" type="button">Cancel</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  _overlayEl = overlay;

  // Wire close handlers
  const closeBtn = overlay.querySelector('.wine-research-close');
  const closeBtnBottom = overlay.querySelector('.wine-research-close-btn');
  closeBtn.addEventListener('click', closeModal);
  closeBtnBottom.addEventListener('click', closeModal);
  overlay.addEventListener('click', handleBackdropClick);
  document.addEventListener('keydown', handleKeyDown);

  // Wire search button
  const searchBtn = overlay.querySelector('.wine-research-search-btn');
  searchBtn.addEventListener('click', () => executeSearch(item));

  // Focus first editable field
  const firstInput = overlay.querySelector('.search-preview-input');
  if (firstInput) firstInput.focus();
  else searchBtn.focus();
}

/**
 * Render the search term preview form.
 * @param {Object} item - Cart item data
 * @returns {string} HTML for the preview form
 */
function renderSearchPreview(item) {
  const fields = [
    { key: 'wine_name', label: 'Wine Name', value: item.wine_name || '', required: true },
    { key: 'producer',  label: 'Producer',  value: item.producer || '' },
    { key: 'vintage',   label: 'Vintage',   value: item.vintage || '' },
    { key: 'country',   label: 'Country',   value: item.country || '' },
    { key: 'colour',    label: 'Colour',    value: item.colour || '' },
    { key: 'region',    label: 'Region',    value: item.region || '' },
    { key: 'grapes',    label: 'Grapes',    value: item.grapes || '' }
  ];

  let html = '<div class="search-preview">';
  html += '<p class="search-preview-hint">Review the search terms below. Edit if needed, then click Search.</p>';
  html += '<div class="search-preview-fields">';

  for (const f of fields) {
    const val = escapeHtml(String(f.value));
    const req = f.required ? ' <span class="search-preview-required">*</span>' : '';
    html += `
      <div class="search-preview-field">
        <label class="search-preview-label" for="sp-${f.key}">${f.label}${req}</label>
        <input class="search-preview-input" id="sp-${f.key}" data-key="${f.key}"
               type="text" value="${val}" ${f.required ? 'required' : ''} />
      </div>
    `;
  }

  html += '</div></div>';
  return html;
}

/**
 * Read edited search terms from preview form and build wine payload.
 * @returns {Object} Wine payload
 */
function readSearchTerms() {
  const wine = {};
  if (!_overlayEl) return wine;
  _overlayEl.querySelectorAll('.search-preview-input').forEach(input => {
    const key = input.dataset.key;
    const val = input.value.trim();
    if (val) wine[key] = val;
  });
  return wine;
}

/**
 * Execute the search: replace preview with loading spinner, then call API.
 * @param {Object} _item - Original cart item (used as fallback context)
 */
async function executeSearch(_item) {
  if (!_overlayEl) return;

  const wine = readSearchTerms();
  if (!wine.wine_name) {
    const nameInput = _overlayEl.querySelector('#sp-wine_name');
    if (nameInput) { nameInput.focus(); nameInput.classList.add('input-error'); }
    return;
  }

  // Replace preview with loading state
  const body = _overlayEl.querySelector('.wine-research-body');
  if (body) {
    body.innerHTML = `
      <div class="wine-research-loading">
        <div class="wine-research-loading-icon">🔍</div>
        <p>Searching critic reviews and competition results...</p>
        <div class="progress-container">
          <div class="progress-bar-wrapper">
            <div class="progress-bar wine-research-progress"></div>
          </div>
          <span class="progress-text">This may take 15–60 seconds</span>
        </div>
      </div>
    `;
  }

  // Update modal actions to just Close
  const actions = _overlayEl.querySelector('.modal-actions');
  if (actions) {
    actions.innerHTML = '<button class="btn btn-secondary btn-small wine-research-close-btn" type="button">Close</button>';
    actions.querySelector('.wine-research-close-btn').addEventListener('click', closeModal);
  }

  // Fetch enrichment data
  try {
    const data = await enrichWine(wine);

    // Stale response guard — modal may have been closed during fetch
    if (!_overlayEl) return;

    const bodyEl = _overlayEl.querySelector('.wine-research-body');
    if (!bodyEl) return;

    // Check for error field (can be set even with HTTP 200)
    if (data.error && (!data.ratings || !data.ratings.ratings?.length)) {
      renderError(bodyEl, data.error);
      return;
    }

    renderResults(bodyEl, data);
  } catch (err) {
    if (!_overlayEl) return;
    const bodyEl = _overlayEl.querySelector('.wine-research-body');
    if (bodyEl) renderError(bodyEl, err.message || 'Search failed');
  }
}

/**
 * Close the research modal and clean up.
 */
function closeModal() {
  if (_overlayEl) {
    _overlayEl.remove();
    _overlayEl = null;
  }
  document.removeEventListener('keydown', handleKeyDown);

  // Restore focus to trigger element
  if (_triggerEl && typeof _triggerEl.focus === 'function') {
    _triggerEl.focus();
    _triggerEl = null;
  }
}

/**
 * Handle backdrop click — close if click is on overlay, not inner modal.
 * @param {MouseEvent} e
 */
function handleBackdropClick(e) {
  if (e.target === _overlayEl) closeModal();
}

/**
 * Handle keydown for Escape and focus trap.
 * @param {KeyboardEvent} e
 */
function handleKeyDown(e) {
  if (!_overlayEl) return;

  if (e.key === 'Escape') {
    closeModal();
    return;
  }

  // Focus trap
  if (e.key === 'Tab') {
    const focusable = _overlayEl.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}

/**
 * Render error state in the modal body.
 * @param {HTMLElement} body - Container element
 * @param {string} message - Error message
 */
function renderError(body, message) {
  body.innerHTML = `
    <div class="wine-research-error">
      <p>${escapeHtml(message)}</p>
      <p class="wine-research-no-data">Try adding more details (producer, vintage, region) to improve search accuracy.</p>
    </div>
  `;
}

/**
 * Render enrichment results in the modal body.
 * @param {HTMLElement} body - Container element
 * @param {Object} data - enrichWine() response: { ratings, drinkingWindows, error }
 */
function renderResults(body, data) {
  const ratings = data.ratings || {};
  const ratingsList = ratings.ratings || [];
  const meta = ratings._metadata || {};

  // No ratings found
  if (ratingsList.length === 0 && !ratings._narrative) {
    body.innerHTML = `
      <div class="wine-research-error">
        <p>No ratings found for this wine.</p>
        <p class="wine-research-no-data">Try adding more details (producer, vintage, region) to improve search accuracy.</p>
      </div>
    `;
    return;
  }

  let html = '<div class="wine-research-results">';

  // 1. Individual ratings
  if (ratingsList.length > 0) {
    html += `<div class="wine-research-section">`;
    html += `<div class="wine-research-section-title">Ratings (${ratingsList.length} sources)</div>`;
    for (const r of ratingsList) {
      const icon = r.source_lens === 'competition' ? '🏆' :
                   r.source_lens === 'critics' ? '📝' : '👥';
      const sourceName = escapeHtml(r.source_short || r.source || 'Unknown');
      const yearText = r.competition_year ? ` (${r.competition_year})` : '';
      const rawScore = escapeHtml(String(r.raw_score || ''));
      const awardBadge = r.award_name
        ? ` <span class="award-badge">${escapeHtml(r.award_name)}</span>`
        : '';
      const vintageWarning = r.vintage_match && r.vintage_match !== 'exact'
        ? ` <span class="vintage-warning">⚠ ${escapeHtml(r.vintage_match)}</span>`
        : '';
      const confidenceBadge = r.confidence
        ? ` <span class="confidence-badge confidence-${r.confidence}">${escapeHtml(r.confidence)}</span>`
        : '';

      html += `
        <div class="rating-item">
          <div class="rating-source">${icon} ${sourceName}${yearText}</div>
          <div class="rating-score">${rawScore}${awardBadge}${vintageWarning}${confidenceBadge}</div>
        </div>
      `;
    }
    html += `</div>`;
  }

  // 2. Drinking window
  const dw = ratings.drinking_window || (data.drinkingWindows && data.drinkingWindows[0]) || null;
  if (dw) {
    const from = dw.drink_from || dw.drink_from_year || '';
    const to = dw.drink_by || dw.drink_by_year || '';
    const peak = dw.peak || '';
    const rec = dw.recommendation || '';
    if (from || to) {
      html += `<div class="wine-research-section">`;
      html += `<div class="wine-research-section-title">Drinking Window</div>`;
      html += `<div class="wine-research-window">`;
      html += `<span class="wine-research-window-years">${escapeHtml(String(from))} – ${escapeHtml(String(to))}</span>`;
      if (peak) html += ` <span>(peak: ${escapeHtml(String(peak))})</span>`;
      if (rec) html += `<div class="wine-research-no-data" style="margin-top:0.3rem">${escapeHtml(rec)}</div>`;
      html += `</div></div>`;
    }
  }

  // 3. Food pairings
  const pairings = ratings.food_pairings || [];
  if (pairings.length > 0) {
    html += `<div class="wine-research-section">`;
    html += `<div class="wine-research-section-title">Food Pairings</div>`;
    html += `<div class="wine-research-pairings">`;
    for (const p of pairings) {
      html += `<span class="wine-research-pairing-chip">${escapeHtml(p)}</span>`;
    }
    html += `</div></div>`;
  }

  // 4. Style summary
  if (ratings.style_summary) {
    html += `<div class="wine-research-section">`;
    html += `<div class="wine-research-section-title">Style</div>`;
    html += `<div class="wine-research-style">${escapeHtml(ratings.style_summary)}</div>`;
    html += `</div>`;
  }

  // 5. Grape varieties
  const grapes = ratings.grape_varieties || [];
  if (grapes.length > 0) {
    html += `<div class="wine-research-section">`;
    html += `<div class="wine-research-section-title">Grape Varieties</div>`;
    html += `<div>${escapeHtml(grapes.join(', '))}</div>`;
    html += `</div>`;
  }

  // 6. Wine Profile narrative placeholder (DOM-rendered separately for XSS safety)
  if (ratings._narrative) {
    html += `<div class="wine-research-section wine-research-narrative-container"></div>`;
  }

  // 7. Sources footer
  const sourcesCount = meta.sources_count || ratingsList.length;
  const durationSec = meta.duration_ms ? (meta.duration_ms / 1000).toFixed(1) : null;
  html += `<div class="wine-research-sources-footer">`;
  html += `Searched ${sourcesCount} source${sourcesCount !== 1 ? 's' : ''}`;
  if (durationSec) html += ` · ${durationSec}s`;
  html += `</div>`;

  html += '</div>';

  body.innerHTML = html;

  // Render narrative via DOM API (XSS-safe — uses textContent, not innerHTML)
  if (ratings._narrative) {
    const narrativeContainer = body.querySelector('.wine-research-narrative-container');
    if (narrativeContainer) {
      renderWineProfile(narrativeContainer, ratings._narrative);
    }
  }

  // Wire toggle detail button if present
  wireResultsEvents(body);
}

/**
 * Wire event listeners on results (e.g. collapsible sections).
 * @param {HTMLElement} body - Modal body container
 */
function wireResultsEvents(body) {
  // Currently no interactive elements in results beyond the wine profile toggle
  // (which is wired internally by renderWineProfile). Placeholder for future use.
  void body;
}
