/**
 * @fileoverview Quick Pair inline form for restaurant pairing wizard.
 * Single image + dish text → parse → straight to pairings.
 * Trades accuracy for speed — no review steps.
 * @module restaurantPairing/quickPair
 */

import { resizeImage } from '../bottles/imageParsing.js';
import { parseMenu } from '../api/restaurantPairing.js';
import { mergeWines, mergeDishes } from './state.js';
import { showToast } from '../utils.js';

/** Max characters for dish text area */
const MAX_CHARS = 2000;
/** Max parse budget allowed */
const MAX_PARSES = 10;

// --- Module state ---

/** @type {Array<{el: Element, event: string, handler: Function}>} */
let listeners = [];
/** @type {AbortController|null} */
let parseController = null;
/** @type {string|null} Base64 image data */
let imageBase64 = null;
/** @type {string|null} Image MIME type */
let imageMediaType = null;

// --- Helpers ---

function addListener(el, event, handler) {
  el.addEventListener(event, handler);
  listeners.push({ el, event, handler });
}

/**
 * Parse dish text into structured items (one per line).
 * @param {string} text - Raw dish text
 * @returns {Array<Object>} Dish items
 */
function parseDishText(text) {
  return text
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(name => ({
      name,
      description: '',
      category: null,
      confidence: 'high'
    }));
}

/**
 * Update the "Get Pairings" button enabled state.
 * Enabled when BOTH image AND dish text are present.
 * @param {HTMLElement} container
 */
function updateGoButton(container) {
  const goBtn = container.querySelector('.restaurant-quick-pair-go');
  const textarea = container.querySelector('.restaurant-quick-pair-dishes');
  if (!goBtn || !textarea) return;

  const hasDishes = textarea.value.trim().length > 0;
  const hasImage = imageBase64 != null;
  goBtn.disabled = !(hasImage && hasDishes);
}

// --- Render ---

/**
 * Render Quick Pair inline form, replacing current Step 1 content.
 * @param {HTMLElement} container - Mount point (.restaurant-step-content)
 * @param {Object} options
 * @param {{used: number}} options.parseBudget - Shared budget tracker
 * @param {Function} options.onComplete - Callback after successful parse+merge
 * @param {Function} options.onCancel - Callback to return to full wizard Step 1
 * @returns {{destroy: Function}}
 */
export function renderQuickPair(container, { parseBudget, onComplete, onCancel }) {
  // Reset module state
  imageBase64 = null;
  imageMediaType = null;
  listeners = [];
  parseController = null;

  const budgetExhausted = parseBudget.used >= MAX_PARSES;

  container.innerHTML = `
    <div class="restaurant-quick-pair-form">
      <h3 class="restaurant-quick-pair-title">Quick Pair</h3>
      <p class="text-muted">One photo + your dishes &rarr; instant suggestions</p>

      <div class="restaurant-quick-pair-section">
        <label class="restaurant-quick-pair-label">Wine List</label>
        <div class="restaurant-quick-pair-image-row">
          <button class="btn btn-secondary restaurant-quick-pair-camera" type="button"
                  ${budgetExhausted ? 'disabled' : ''}>📷 Photo</button>
          <button class="btn btn-secondary restaurant-quick-pair-file" type="button"
                  ${budgetExhausted ? 'disabled' : ''}>📁 File</button>
          <span class="restaurant-quick-pair-image-status text-muted">No image</span>
        </div>
        <input type="file" accept="image/*" capture="environment"
               class="restaurant-quick-pair-camera-input" hidden>
        <input type="file" accept="image/*"
               class="restaurant-quick-pair-file-input" hidden>
        <div class="restaurant-quick-pair-thumb" style="display: none;"></div>
      </div>

      <div class="restaurant-quick-pair-section">
        <label class="restaurant-quick-pair-label" for="quick-pair-dishes">Your Dishes</label>
        <textarea class="restaurant-quick-pair-dishes restaurant-text-input"
                  id="quick-pair-dishes"
                  placeholder="Type your dishes, one per line&#10;e.g. Grilled salmon&#10;Beef fillet&#10;Caesar salad"
                  rows="4" maxlength="${MAX_CHARS}"></textarea>
        <div class="restaurant-text-counter"><span class="restaurant-quick-pair-char-count">0</span>/${MAX_CHARS}</div>
      </div>

      <div class="restaurant-quick-pair-actions">
        <button class="btn btn-primary restaurant-quick-pair-go" type="button" disabled>
          Get Pairings
        </button>
        <button class="btn btn-link restaurant-quick-pair-cancel" type="button">
          Use Full Wizard
        </button>
      </div>

      <div class="restaurant-quick-pair-loading" style="display: none;">
        <span class="loading-spinner"></span>
        <span>Analyzing wine list &amp; dishes&hellip;</span>
      </div>
    </div>
  `;

  // --- DOM refs ---
  const cameraBtn = container.querySelector('.restaurant-quick-pair-camera');
  const fileBtn = container.querySelector('.restaurant-quick-pair-file');
  const cameraInput = container.querySelector('.restaurant-quick-pair-camera-input');
  const fileInput = container.querySelector('.restaurant-quick-pair-file-input');
  const statusText = container.querySelector('.restaurant-quick-pair-image-status');
  const thumbEl = container.querySelector('.restaurant-quick-pair-thumb');
  const textarea = container.querySelector('.restaurant-quick-pair-dishes');
  const charCount = container.querySelector('.restaurant-quick-pair-char-count');
  const goBtn = container.querySelector('.restaurant-quick-pair-go');
  const cancelBtn = container.querySelector('.restaurant-quick-pair-cancel');
  const loadingEl = container.querySelector('.restaurant-quick-pair-loading');

  if (budgetExhausted) {
    showToast('Parse budget exhausted — use the full wizard to add wines manually', 'error');
  }

  // --- Image handling ---
  async function handleImageFile(file) {
    if (!file) return;
    try {
      const { base64, mediaType, dataUrl } = await resizeImage(file);
      imageBase64 = base64;
      imageMediaType = mediaType;
      statusText.textContent = file.name || 'Image selected';
      thumbEl.innerHTML = `<img src="${dataUrl}" alt="Wine list preview">`;
      thumbEl.style.display = '';
      updateGoButton(container);
    } catch (_err) {
      showToast('Failed to process image', 'error');
    }
  }

  // Camera button → hidden file input with capture
  addListener(cameraBtn, 'click', () => cameraInput.click());
  addListener(cameraInput, 'change', () => {
    if (cameraInput.files[0]) handleImageFile(cameraInput.files[0]);
  });

  // File button → hidden file input without capture
  addListener(fileBtn, 'click', () => fileInput.click());
  addListener(fileInput, 'change', () => {
    if (fileInput.files[0]) handleImageFile(fileInput.files[0]);
  });

  // --- Textarea char counter ---
  addListener(textarea, 'input', () => {
    charCount.textContent = String(textarea.value.length);
    updateGoButton(container);
  });

  // --- Cancel ---
  addListener(cancelBtn, 'click', () => {
    onCancel();
  });

  // --- Get Pairings ---
  addListener(goBtn, 'click', async () => {
    const dishText = textarea.value.trim();
    if (!imageBase64 || !dishText) return;

    // Runtime budget guard (belt-and-suspenders with render-time check)
    if (parseBudget.used >= MAX_PARSES) {
      showToast('Parse budget exhausted — use the full wizard to add wines manually', 'error');
      return;
    }

    // Show loading
    goBtn.disabled = true;
    loadingEl.style.display = '';

    let wineItems;
    try {
      // Increment budget before request (matches imageCapture.js pattern)
      parseBudget.used++;

      // Parse wine image
      parseController = new AbortController();
      const parseResult = await parseMenu(
        { type: 'wine_list', image: imageBase64, mediaType: imageMediaType },
        parseController.signal
      );
      parseController = null;

      wineItems = Array.isArray(parseResult.items) ? parseResult.items : [];
      if (wineItems.length === 0) {
        showToast('Could not find wines in image — please use the full wizard to add wines manually.', 'error');
        goBtn.disabled = false;
        loadingEl.style.display = 'none';
        return;
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        showToast(`Parse failed: ${err.message}`, 'error');
      }
      goBtn.disabled = false;
      loadingEl.style.display = 'none';
      updateGoButton(container);
      return;
    }

    // Parse dishes from text (client-side, no API call)
    const dishItems = parseDishText(dishText);

    // Merge into state
    mergeWines(wineItems);
    mergeDishes(dishItems);

    // Callback — controller handles navigation (separate from parse try/catch)
    try {
      await onComplete();
    } catch (err) {
      showToast(`Quick Pair failed: ${err.message}`, 'error');
    } finally {
      goBtn.disabled = false;
      loadingEl.style.display = 'none';
      updateGoButton(container);
    }
  });

  // --- Destroy ---
  function destroy() {
    if (parseController) {
      parseController.abort();
      parseController = null;
    }
    for (const { el, event, handler } of listeners) {
      el.removeEventListener(event, handler);
    }
    listeners = [];
    imageBase64 = null;
    imageMediaType = null;
  }

  return { destroy };
}
