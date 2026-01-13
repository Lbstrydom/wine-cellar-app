/**
 * @fileoverview Wine disambiguation modal for duplicates and external matches.
 * @module bottles/disambiguationModal
 */

import { escapeHtml } from '../utils.js';

let disambiguationModal = null;
let currentCallbacks = null;
let selectedQuantity = 1;

/**
 * Show disambiguation modal.
 * @param {Object} wineInput - Wine data from form/parsing
 * @param {Object} result - Duplicate and match data
 * @param {Object} callbacks - { onUseExisting, onSelectMatch, onSkip }
 */
export function showWineDisambiguation(wineInput, result, callbacks) {
  currentCallbacks = { wineInput, ...callbacks };
  selectedQuantity = 1;

  if (!disambiguationModal) {
    createModal();
  }

  renderContent(wineInput, result);
  disambiguationModal.classList.add('active');
}

/**
 * Close modal.
 */
export function closeDisambiguation() {
  if (disambiguationModal) {
    disambiguationModal.classList.remove('active');
  }
}

function createModal() {
  disambiguationModal = document.createElement('div');
  disambiguationModal.id = 'wine-disambiguation-modal';
  disambiguationModal.className = 'modal-overlay';
  disambiguationModal.innerHTML = `
    <div class="modal wine-confirmation-modal">
      <button class="modal-close" id="disambiguation-close-btn">&times;</button>
      <div class="modal-content" id="disambiguation-content"></div>
    </div>
  `;
  document.body.appendChild(disambiguationModal);

  disambiguationModal.querySelector('#disambiguation-close-btn')
    .addEventListener('click', closeDisambiguation);
  disambiguationModal.addEventListener('click', (e) => {
    if (e.target === disambiguationModal) closeDisambiguation();
  });
}

function renderContent(wineInput, result) {
  const content = disambiguationModal.querySelector('#disambiguation-content');
  const duplicates = result?.duplicates || [];
  const matches = result?.matches || [];

  content.innerHTML = `
    <div class="confirmation-header">
      <h3>Confirm Wine Details</h3>
      <p class="parsed-info">
        Detected: <strong>${escapeHtml(wineInput.wine_name)}</strong>
        ${wineInput.vintage ? `(${escapeHtml(wineInput.vintage)})` : ''}
      </p>
    </div>

    <div class="confirmation-quantity">
      <label for="disambiguation-qty">Number of bottles:</label>
      <div class="qty-controls">
        <button type="button" class="qty-btn" data-action="decrease">-</button>
        <input type="number" id="disambiguation-qty" min="1" max="24" value="1">
        <button type="button" class="qty-btn" data-action="increase">+</button>
      </div>
    </div>

    ${duplicates.length > 0 ? `
      <div class="confirmation-matches">
        <h4>Possible duplicates in your cellar:</h4>
        ${renderDuplicates(duplicates)}
      </div>
    ` : ''}

    <div class="confirmation-matches">
      ${matches.length > 0 ? `
        <h4>External matches:</h4>
        ${renderMatches(matches)}
      ` : `
        <p class="no-matches">No external matches found.</p>
      `}
    </div>

    <div class="confirmation-actions">
      <button class="btn-secondary" id="disambiguation-skip-btn">
        Add as new wine
      </button>
    </div>
  `;

  bindQuantityControls(content);
  bindDuplicateHandlers(content);
  bindMatchHandlers(content);
  bindSkipHandler(content);
}

function bindQuantityControls(content) {
  const qtyInput = content.querySelector('#disambiguation-qty');
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
}

function bindDuplicateHandlers(content) {
  content.querySelectorAll('.duplicate-card').forEach(card => {
    card.addEventListener('click', () => {
      const wineId = card.dataset.wineId;
      closeDisambiguation();
      currentCallbacks?.onUseExisting?.(parseInt(wineId, 10), selectedQuantity);
    });
  });
}

function bindMatchHandlers(content) {
  content.querySelectorAll('.match-card').forEach(card => {
    card.addEventListener('click', () => {
      let matchData;
      try {
        matchData = JSON.parse(card.dataset.match);
      } catch (err) {
        console.error('Failed to parse match data:', err);
        return;
      }
      closeDisambiguation();
      currentCallbacks?.onSelectMatch?.(matchData, selectedQuantity);
    });
  });
}

function bindSkipHandler(content) {
  content.querySelector('#disambiguation-skip-btn').addEventListener('click', () => {
    closeDisambiguation();
    currentCallbacks?.onSkip?.(selectedQuantity);
  });
}

function renderDuplicates(duplicates) {
  return duplicates.map(wine => `
    <div class="duplicate-card" data-wine-id="${wine.id}">
      <div class="duplicate-details">
        <h5>${escapeHtml(wine.wine_name)}</h5>
        <p class="match-meta">
          ${wine.vintage ? escapeHtml(wine.vintage) + ' ' : ''}
          ${wine.style ? escapeHtml(wine.style) : ''}
        </p>
      </div>
      <div class="match-action">
        <button class="btn-confirm">Use existing</button>
      </div>
    </div>
  `).join('');
}

function renderMatches(matches) {
  return matches.slice(0, 3).map((match, index) => `
    <div class="match-card ${index === 0 ? 'top-match' : ''}"
         data-match='${JSON.stringify(match).replace(/'/g, '&#39;')}'>
      <div class="match-details">
        <h5>${escapeHtml(match.name || 'Unknown Wine')}</h5>
        <p class="match-meta">
          ${match.winery?.name ? escapeHtml(match.winery.name) + ' - ' : ''}
          ${match.region ? escapeHtml(match.region) + ' - ' : ''}
          ${match.country ? escapeHtml(match.country) : ''}
        </p>
        ${match.rating ? `
          <p class="match-rating">
            <span class="rating-value">${match.rating.toFixed(1)}</span>
            ${match.rating_count ? `<span class="rating-count">(${escapeHtml(match.rating_count)})</span>` : ''}
          </p>
        ` : '<p class="match-rating">No rating</p>'}
        <p class="match-note">Confidence: ${(match.confidence?.score || 0).toFixed(2)}</p>
      </div>
      <div class="match-action">
        <button class="btn-confirm">${index === 0 ? 'Select' : 'Choose'}</button>
      </div>
    </div>
  `).join('');
}
