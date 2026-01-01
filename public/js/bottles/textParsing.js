/**
 * @fileoverview Text parsing functionality for wine details extraction.
 * @module bottles/textParsing
 */

import { parseWineText } from '../api.js';
import { showToast, escapeHtml } from '../utils.js';
import { bottleState } from './state.js';
import { setBottleFormMode } from './modal.js';

/**
 * Initialize text parsing handlers.
 */
export function initTextParsing() {
  document.getElementById('parse-text-btn')?.addEventListener('click', handleParseText);
}

/**
 * Handle parse text button click.
 */
async function handleParseText() {
  const textInput = document.getElementById('wine-text-input');
  const text = textInput.value.trim();

  if (!text) {
    showToast('Please enter or paste wine text');
    return;
  }

  const btn = document.getElementById('parse-text-btn');
  const resultsDiv = document.getElementById('parse-results');

  btn.disabled = true;
  btn.innerHTML = '<span class="loading-spinner"></span> Parsing...';
  resultsDiv.innerHTML = '<p style="color: var(--text-muted);">Analyzing text...</p>';

  try {
    const result = await parseWineText(text);
    bottleState.parsedWines = result.wines || [];

    if (bottleState.parsedWines.length === 0) {
      resultsDiv.innerHTML = '<p style="color: var(--text-muted);">No wines found in text.</p>';
      return;
    }

    renderParsedWines(result);

  } catch (err) {
    resultsDiv.innerHTML = `<p style="color: var(--priority-1);">Error: ${err.message}</p>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Extract Wine Details';
  }
}

/**
 * Render parsed wines for selection with inline editing.
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
  html += `
    <div class="parsed-wine-preview parsed-wine-editable">
      <h4>Review & Edit Details</h4>
      <div class="parsed-edit-form">
        <div class="parsed-field">
          <label for="parsed-name">Wine Name</label>
          <input type="text" id="parsed-name" value="${escapeHtml(wine.wine_name) || ''}" />
        </div>
        <div class="parsed-field-row">
          <div class="parsed-field">
            <label for="parsed-vintage">Vintage</label>
            <input type="number" id="parsed-vintage" value="${escapeHtml(wine.vintage) || ''}" min="1900" max="2030" />
          </div>
          <div class="parsed-field">
            <label for="parsed-colour">Colour</label>
            <select id="parsed-colour">
              <option value="red" ${wine.colour === 'red' ? 'selected' : ''}>Red</option>
              <option value="white" ${wine.colour === 'white' ? 'selected' : ''}>White</option>
              <option value="rose" ${wine.colour === 'rose' ? 'selected' : ''}>Rosé</option>
              <option value="sparkling" ${wine.colour === 'sparkling' ? 'selected' : ''}>Sparkling</option>
            </select>
          </div>
        </div>
        <div class="parsed-field">
          <label for="parsed-style">Style</label>
          <input type="text" id="parsed-style" value="${escapeHtml(wine.style) || ''}" list="style-list" />
        </div>
        <div class="parsed-field-row">
          <div class="parsed-field">
            <label for="parsed-price">Price (€)</label>
            <input type="number" id="parsed-price" value="${wine.price_eur || ''}" min="0" step="0.01" />
          </div>
          <div class="parsed-field">
            <label for="parsed-rating">Rating</label>
            <input type="number" id="parsed-rating" value="${wine.vivino_rating || ''}" min="1" max="5" step="0.1" />
          </div>
        </div>
        <div class="parsed-field">
          <label for="parsed-country">Country</label>
          <input type="text" id="parsed-country" value="${escapeHtml(wine.country) || ''}" />
        </div>
      </div>
      <button type="button" class="btn btn-primary" id="use-parsed-btn" style="margin-top: 1rem;">
        Add This Wine
      </button>
    </div>
  `;

  resultsDiv.innerHTML = html;

  // Add click handlers for wine selection (if multiple wines)
  resultsDiv.querySelectorAll('.parsed-wine-item').forEach(item => {
    item.addEventListener('click', () => {
      // Save current edits before switching
      saveCurrentParsedEdits();
      bottleState.selectedParsedIndex = parseInt(item.dataset.index);
      renderParsedWines(result);
    });
  });

  // Add handler for "Add This Wine" button
  document.getElementById('use-parsed-btn')?.addEventListener('click', () => {
    // Get values from editable fields
    const editedWine = {
      wine_name: document.getElementById('parsed-name')?.value || '',
      vintage: document.getElementById('parsed-vintage')?.value || null,
      colour: document.getElementById('parsed-colour')?.value || 'white',
      style: document.getElementById('parsed-style')?.value || '',
      price_eur: document.getElementById('parsed-price')?.value || null,
      vivino_rating: document.getElementById('parsed-rating')?.value || null,
      country: document.getElementById('parsed-country')?.value || ''
    };
    useParsedWine(editedWine);
  });
}

/**
 * Save current edits back to parsedWines array.
 */
function saveCurrentParsedEdits() {
  if (!bottleState.parsedWines[bottleState.selectedParsedIndex]) return;

  const nameInput = document.getElementById('parsed-name');
  if (nameInput) {
    bottleState.parsedWines[bottleState.selectedParsedIndex].wine_name = nameInput.value;
    bottleState.parsedWines[bottleState.selectedParsedIndex].vintage = document.getElementById('parsed-vintage')?.value || null;
    bottleState.parsedWines[bottleState.selectedParsedIndex].colour = document.getElementById('parsed-colour')?.value || 'white';
    bottleState.parsedWines[bottleState.selectedParsedIndex].style = document.getElementById('parsed-style')?.value || '';
    bottleState.parsedWines[bottleState.selectedParsedIndex].price_eur = document.getElementById('parsed-price')?.value || null;
    bottleState.parsedWines[bottleState.selectedParsedIndex].vivino_rating = document.getElementById('parsed-rating')?.value || null;
    bottleState.parsedWines[bottleState.selectedParsedIndex].country = document.getElementById('parsed-country')?.value || '';
  }
}

/**
 * Populate form with parsed wine details.
 * @param {Object} wine - Parsed wine object
 */
function useParsedWine(wine) {
  // Switch to "New Wine" tab
  setBottleFormMode('new');

  // Populate fields
  document.getElementById('wine-name').value = wine.wine_name || '';
  document.getElementById('wine-vintage').value = wine.vintage || '';
  document.getElementById('wine-colour').value = wine.colour || 'white';
  document.getElementById('wine-style').value = wine.style || '';
  document.getElementById('wine-rating').value = wine.vivino_rating || '';
  document.getElementById('wine-price').value = wine.price_eur || '';

  // Clear the selected wine ID since we're creating new
  document.getElementById('selected-wine-id').value = '';

  showToast('Details loaded - review and save');
}
