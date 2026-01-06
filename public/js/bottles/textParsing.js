/**
 * @fileoverview Text parsing functionality for wine details extraction.
 * @module bottles/textParsing
 */

import { escapeHtml, WINE_COUNTRIES } from '../utils.js';
import { bottleState } from './state.js';
import { submitParsedWine } from './form.js';
import { getAcquisitionPlacement } from '../api.js';

/**
 * Initialize text parsing handlers.
 * Note: The unified "Analyze Wine" button is handled in imageParsing.js
 */
export function initTextParsing() {
  // Text parsing is now handled by the unified analyze button in imageParsing.js
}

/**
 * Get CSS class for field confidence highlighting.
 * @param {string} confidence - Field confidence level
 * @returns {string} CSS class
 */
function getConfidenceClass(confidence) {
  switch (confidence) {
    case 'low':
    case 'missing':
      return 'field-uncertain';
    case 'medium':
      return 'field-review';
    default:
      return '';
  }
}

/**
 * Get tooltip for field confidence.
 * @param {string} confidence - Field confidence level
 * @returns {string} Tooltip text
 */
function getConfidenceTooltip(confidence) {
  switch (confidence) {
    case 'high':
      return 'Clearly visible';
    case 'medium':
      return 'May need review';
    case 'low':
      return 'Uncertain - please verify';
    case 'missing':
      return 'Not found - please enter';
    default:
      return '';
  }
}

/**
 * Render parsed wines for selection with inline editing and confidence highlighting.
 * @param {Object} result - Parse result with wines array
 */
export function renderParsedWines(result) {
  const resultsDiv = document.getElementById('parse-results');

  let html = '';

  // Confidence indicator
  const confidenceColor = {
    'high': 'var(--accent)',
    'medium': 'var(--priority-2)',
    'low': 'var(--priority-1)'
  }[result.confidence] || 'var(--text-muted)';

  html += `<div class="parse-confidence" style="color: ${confidenceColor}; margin-bottom: 0.5rem;">
    Confidence: ${escapeHtml(result.confidence) || 'unknown'}
    ${result.parse_notes ? `<br><small>${escapeHtml(result.parse_notes)}</small>` : ''}
  </div>`;

  // Wine list (if multiple)
  if (bottleState.parsedWines.length > 1) {
    html += '<div class="parsed-wine-list">';
    bottleState.parsedWines.forEach((wine, idx) => {
      html += `
        <div class="parsed-wine-item ${idx === bottleState.selectedParsedIndex ? 'selected' : ''}" data-index="${idx}">
          <strong>${escapeHtml(wine.wine_name) || 'Unknown'}</strong> ${escapeHtml(wine.vintage) || 'NV'}
          <br><small>${escapeHtml(wine.style) || ''} - ${escapeHtml(wine.colour) || ''}</small>
        </div>
      `;
    });
    html += '</div>';
  }

  // Selected wine - editable form
  const wine = bottleState.parsedWines[bottleState.selectedParsedIndex];
  const fc = wine._fieldConfidences || {};
  const uncertainFields = wine._uncertainFields || [];

  // Show hint if there are uncertain fields
  if (uncertainFields.length > 0) {
    html += `<div class="parse-review-hint" style="background: var(--priority-2); color: var(--bg-dark); padding: 0.5rem; margin-bottom: 0.5rem; border-radius: 4px;">
      <strong>Please review:</strong> ${uncertainFields.length} field(s) need verification (highlighted in yellow)
    </div>`;
  }

  html += `
    <div class="parsed-wine-preview parsed-wine-editable">
      <h4>Review & Edit Details</h4>
      <div class="parsed-edit-form">
        <div class="parsed-field ${getConfidenceClass(fc.wine_name)}" title="${getConfidenceTooltip(fc.wine_name)}">
          <label for="parsed-name">Wine Name ${fc.wine_name !== 'high' ? '⚠' : ''}</label>
          <input type="text" id="parsed-name" value="${escapeHtml(wine.wine_name) || ''}" />
        </div>
        <div class="parsed-field-row">
          <div class="parsed-field ${getConfidenceClass(fc.vintage)}" title="${getConfidenceTooltip(fc.vintage)}">
            <label for="parsed-vintage">Vintage ${fc.vintage !== 'high' ? '⚠' : ''}</label>
            <input type="number" id="parsed-vintage" value="${escapeHtml(wine.vintage) || ''}" min="1900" max="2030" placeholder="NV" />
          </div>
          <div class="parsed-field ${getConfidenceClass(fc.colour)}" title="${getConfidenceTooltip(fc.colour)}">
            <label for="parsed-colour">Colour ${fc.colour !== 'high' ? '⚠' : ''}</label>
            <select id="parsed-colour">
              <option value="red" ${wine.colour === 'red' ? 'selected' : ''}>Red</option>
              <option value="white" ${wine.colour === 'white' ? 'selected' : ''}>White</option>
              <option value="rose" ${wine.colour === 'rose' ? 'selected' : ''}>Rosé</option>
              <option value="sparkling" ${wine.colour === 'sparkling' ? 'selected' : ''}>Sparkling</option>
            </select>
          </div>
        </div>
        <div class="parsed-field ${getConfidenceClass(fc.style)}" title="${getConfidenceTooltip(fc.style)}">
          <label for="parsed-style">Style ${fc.style !== 'high' ? '⚠' : ''}</label>
          <input type="text" id="parsed-style" value="${escapeHtml(wine.style) || ''}" list="style-list" placeholder="e.g., Sauvignon Blanc" />
        </div>
        <div class="parsed-field-row">
          <div class="parsed-field ${getConfidenceClass(fc.price_eur)}" title="${getConfidenceTooltip(fc.price_eur)}">
            <label for="parsed-price">Price (€)</label>
            <input type="number" id="parsed-price" value="${wine.price_eur || ''}" min="0" step="0.01" />
          </div>
          <div class="parsed-field">
            <label for="parsed-rating">Rating</label>
            <input type="number" id="parsed-rating" value="${wine.vivino_rating || ''}" min="1" max="5" step="0.1" />
          </div>
        </div>
        <div class="parsed-field ${getConfidenceClass(fc.country)}" title="${getConfidenceTooltip(fc.country)}">
          <label for="parsed-country">Country ${fc.country !== 'high' ? '⚠' : ''}</label>
          <select id="parsed-country">
            <option value="">Select country...</option>
            ${WINE_COUNTRIES.map(c => `<option value="${c}" ${wine.country === c ? 'selected' : ''}>${c}</option>`).join('')}
            <option value="Other" ${wine.country && !WINE_COUNTRIES.includes(wine.country) ? 'selected' : ''}>Other</option>
          </select>
          <input type="text" id="parsed-country-other" placeholder="Enter country name..."
                 value="${wine.country && !WINE_COUNTRIES.includes(wine.country) ? escapeHtml(wine.country) : ''}"
                 style="display: ${wine.country && !WINE_COUNTRIES.includes(wine.country) ? 'block' : 'none'}; margin-top: 0.5rem;" />
        </div>
      </div>

      <!-- Placement suggestion section -->
      <div id="placement-suggestion" class="placement-suggestion" style="margin-top: 1rem; display: none;">
        <h5 style="margin-bottom: 0.5rem;">Suggested Placement</h5>
        <div id="placement-zone" class="placement-zone"></div>
        <div id="placement-fridge" class="placement-fridge"></div>
      </div>

      <div class="parsed-actions" style="margin-top: 1rem; display: flex; gap: 0.5rem; flex-wrap: wrap;">
        <button type="button" class="btn btn-primary" id="use-parsed-btn">
          Add This Wine
        </button>
        <button type="button" class="btn btn-secondary" id="get-placement-btn">
          Suggest Placement
        </button>
      </div>
    </div>
  `;

  resultsDiv.innerHTML = html;

  // Hide the bottom buttons when showing parse results (Add This Wine handles everything)
  const quantitySection = document.getElementById('quantity-section');
  const modalActions = document.querySelector('#bottle-modal .modal-actions');
  if (quantitySection) quantitySection.style.display = 'none';
  if (modalActions) modalActions.style.display = 'none';

  // Add click handlers for wine selection (if multiple wines)
  resultsDiv.querySelectorAll('.parsed-wine-item').forEach(item => {
    item.addEventListener('click', () => {
      // Save current edits before switching
      saveCurrentParsedEdits();
      bottleState.selectedParsedIndex = parseInt(item.dataset.index);
      renderParsedWines(result);
    });
  });

  // Handle "Other" country dropdown
  const parsedCountrySelect = document.getElementById('parsed-country');
  const parsedCountryOther = document.getElementById('parsed-country-other');
  if (parsedCountrySelect && parsedCountryOther) {
    parsedCountrySelect.addEventListener('change', () => {
      parsedCountryOther.style.display = parsedCountrySelect.value === 'Other' ? 'block' : 'none';
      if (parsedCountrySelect.value !== 'Other') {
        parsedCountryOther.value = '';
      }
    });
  }

  // Add handler for "Add This Wine" button - directly submit
  document.getElementById('use-parsed-btn')?.addEventListener('click', async () => {
    // Get country value (handle "Other" option)
    let countryValue = document.getElementById('parsed-country')?.value || '';
    if (countryValue === 'Other') {
      countryValue = document.getElementById('parsed-country-other')?.value.trim() || '';
    }

    // Get values from editable fields
    const editedWine = {
      wine_name: document.getElementById('parsed-name')?.value || '',
      vintage: document.getElementById('parsed-vintage')?.value || null,
      colour: document.getElementById('parsed-colour')?.value || 'white',
      style: document.getElementById('parsed-style')?.value || '',
      price_eur: document.getElementById('parsed-price')?.value || null,
      vivino_rating: document.getElementById('parsed-rating')?.value || null,
      country: countryValue || null
    };

    // Get quantity from form
    const quantity = Number.parseInt(document.getElementById('bottle-quantity')?.value, 10) || 1;

    // Directly submit the wine
    await submitParsedWine(editedWine, quantity);
  });

  // Add handler for "Suggest Placement" button
  document.getElementById('get-placement-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('get-placement-btn');
    const placementDiv = document.getElementById('placement-suggestion');
    const zoneDiv = document.getElementById('placement-zone');
    const fridgeDiv = document.getElementById('placement-fridge');

    // Collect current wine data
    let countryValue = document.getElementById('parsed-country')?.value || '';
    if (countryValue === 'Other') {
      countryValue = document.getElementById('parsed-country-other')?.value.trim() || '';
    }

    const wineData = {
      wine_name: document.getElementById('parsed-name')?.value || '',
      vintage: document.getElementById('parsed-vintage')?.value || null,
      colour: document.getElementById('parsed-colour')?.value || 'white',
      style: document.getElementById('parsed-style')?.value || '',
      country: countryValue || null
    };

    btn.disabled = true;
    btn.textContent = 'Getting suggestion...';

    try {
      const placement = await getAcquisitionPlacement(wineData);

      // Show zone suggestion
      let zoneHtml = '';
      if (placement.zone) {
        const confidenceIcon = {
          'high': '✓',
          'medium': '?',
          'low': '!'
        }[placement.zone.confidence] || '?';

        zoneHtml = `
          <div class="zone-suggestion ${placement.zone.requiresReview ? 'needs-review' : ''}">
            <strong>${confidenceIcon} Zone:</strong> ${escapeHtml(placement.zone.displayName)}
            <br><small>${escapeHtml(placement.zone.reason)}</small>
            ${placement.suggestedSlot ? `<br><small>Suggested slot: <strong>${placement.suggestedSlot}</strong></small>` : ''}
          </div>
        `;

        // Show alternatives if available
        if (placement.zone.alternatives && placement.zone.alternatives.length > 0) {
          zoneHtml += `<div class="zone-alternatives" style="margin-top: 0.25rem; font-size: 0.85em; color: var(--text-muted);">
            Alternatives: ${placement.zone.alternatives.map(a => a.displayName).join(', ')}
          </div>`;
        }
      }
      zoneDiv.innerHTML = zoneHtml;

      // Show fridge suggestion
      let fridgeHtml = '';
      if (placement.fridge && placement.fridge.eligible) {
        fridgeHtml = `
          <div class="fridge-suggestion" style="margin-top: 0.5rem; padding: 0.5rem; background: var(--bg-lighter); border-radius: 4px;">
            <strong>🧊 Fridge Eligible</strong>
            <br><small>${escapeHtml(placement.fridge.reason)}</small>
            <br><small>Category: ${escapeHtml(placement.fridge.category)}</small>
          </div>
        `;
      }
      fridgeDiv.innerHTML = fridgeHtml;

      placementDiv.style.display = 'block';

    } catch (err) {
      zoneDiv.innerHTML = `<div style="color: var(--priority-1);">Error: ${escapeHtml(err.message)}</div>`;
      placementDiv.style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Suggest Placement';
    }
  });
}

/**
 * Save current edits back to parsedWines array.
 */
function saveCurrentParsedEdits() {
  if (!bottleState.parsedWines[bottleState.selectedParsedIndex]) return;

  const nameInput = document.getElementById('parsed-name');
  if (nameInput) {
    // Get country value (handle "Other" option)
    let countryValue = document.getElementById('parsed-country')?.value || '';
    if (countryValue === 'Other') {
      countryValue = document.getElementById('parsed-country-other')?.value.trim() || '';
    }

    bottleState.parsedWines[bottleState.selectedParsedIndex].wine_name = nameInput.value;
    bottleState.parsedWines[bottleState.selectedParsedIndex].vintage = document.getElementById('parsed-vintage')?.value || null;
    bottleState.parsedWines[bottleState.selectedParsedIndex].colour = document.getElementById('parsed-colour')?.value || 'white';
    bottleState.parsedWines[bottleState.selectedParsedIndex].style = document.getElementById('parsed-style')?.value || '';
    bottleState.parsedWines[bottleState.selectedParsedIndex].price_eur = document.getElementById('parsed-price')?.value || null;
    bottleState.parsedWines[bottleState.selectedParsedIndex].vivino_rating = document.getElementById('parsed-rating')?.value || null;
    bottleState.parsedWines[bottleState.selectedParsedIndex].country = countryValue || '';
  }
}
