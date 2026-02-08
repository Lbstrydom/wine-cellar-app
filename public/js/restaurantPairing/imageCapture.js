/**
 * @fileoverview Multi-image capture widget for restaurant pairing wizard.
 * Shared between Step 1 (wine list) and Step 3 (dish menu).
 * Handles image upload, camera capture, concurrency queue, and parse budget.
 * @module restaurantPairing/imageCapture
 */

import { resizeImage } from '../bottles/imageParsing.js';
import { parseMenu } from '../api/restaurantPairing.js';
import { showToast } from '../utils.js';

/** Max concurrent parseMenu requests */
const MAX_CONCURRENT = 2;

/** Max parse requests per 15-min window (mirrors backend) */
const MAX_PARSE_BUDGET = 10;

/** Max text length (mirrors backend schema) */
const MAX_TEXT_LENGTH = 5000;

/**
 * Create an image capture widget for menu parsing.
 * @param {HTMLElement} container - DOM container to render into
 * @param {Object} options - Widget configuration
 * @param {'wine_list'|'dish_menu'} options.type - Menu section type
 * @param {number} [options.maxImages=4] - Maximum images allowed
 * @param {{used: number}} options.parseBudget - Shared budget tracker
 * @param {Function} options.onAnalyze - Callback with parsed items array
 * @param {Function} [options.onSkipManual] - Callback for "Skip to Manual"
 * @returns {{getImages: Function, getText: Function, destroy: Function}}
 */
export function createImageCapture(container, options) {
  const {
    type,
    maxImages = 4,
    parseBudget,
    onAnalyze,
    onSkipManual
  } = options;

  const typeLabel = type === 'wine_list' ? 'wine list' : 'dish menu';

  // --- Internal state ---
  /** @type {Array<{file: File, dataUrl: string, id: number}>} */
  const images = [];
  let nextImageId = 1;
  /** @type {Map<number, AbortController>} Image-keyed controllers for cancel-on-remove */
  const controllers = new Map();
  /** @type {Set<AbortController>} All active controllers for cleanup on destroy */
  const allControllers = new Set();
  const listeners = [];
  /** @type {Array<{el: Element, event: string, handler: Function}>} Listeners bound to image remove buttons (re-created each render) */
  const imageListeners = [];
  let analyzing = false;
  let destroyed = false;

  // --- Render ---
  const placeholder = type === 'wine_list'
    ? 'Paste wine list here...'
    : 'Paste dish menu here...';

  container.innerHTML = `
    <div class="restaurant-capture" role="region" aria-label="Image capture">
      <textarea class="restaurant-text-input" placeholder="${placeholder}" rows="4"
                aria-label="Paste menu text" maxlength="${MAX_TEXT_LENGTH}"></textarea>
      <div class="restaurant-text-counter">0 / ${MAX_TEXT_LENGTH}</div>
      <div class="restaurant-image-grid" role="list"></div>
      <div class="restaurant-capture-status" aria-live="polite"></div>
      <div class="restaurant-capture-actions">
        <button class="btn btn-secondary restaurant-browse-btn" type="button"
                aria-label="Browse files to upload">Browse Files</button>
        <button class="btn btn-secondary restaurant-camera-btn" type="button"
                aria-label="Take photo with camera">Take Photo</button>
      </div>
      <input type="file" accept="image/*" multiple class="restaurant-file-input" hidden>
      <input type="file" accept="image/*" capture="environment" class="restaurant-camera-input" hidden>
      <div class="restaurant-capture-buttons">
        <button class="btn btn-primary restaurant-analyze-btn" type="button"
                aria-label="Analyze ${typeLabel} images">Analyze</button>
        <button class="btn btn-secondary restaurant-skip-btn" type="button"
                aria-label="Skip image analysis, enter items manually">Skip to Manual</button>
      </div>
    </div>
  `;

  // --- DOM refs ---
  const textarea = container.querySelector('.restaurant-text-input');
  const charCounter = container.querySelector('.restaurant-text-counter');
  const imageGrid = container.querySelector('.restaurant-image-grid');
  const statusArea = container.querySelector('.restaurant-capture-status');
  const browseBtn = container.querySelector('.restaurant-browse-btn');
  const cameraBtn = container.querySelector('.restaurant-camera-btn');
  const fileInput = container.querySelector('.restaurant-file-input');
  const cameraInput = container.querySelector('.restaurant-camera-input');
  const analyzeBtn = container.querySelector('.restaurant-analyze-btn');
  const skipBtn = container.querySelector('.restaurant-skip-btn');

  // --- Helpers ---

  function addListener(el, event, handler, opts) {
    el.addEventListener(event, handler, opts);
    listeners.push({ el, event, handler, opts });
  }

  function updateCharCounter() {
    const len = textarea.value.length;
    charCounter.textContent = `${len} / ${MAX_TEXT_LENGTH}`;
  }

  function updateStatus(msg) {
    statusArea.textContent = msg;
  }

  function isBudgetExhausted() {
    return parseBudget.used >= MAX_PARSE_BUDGET;
  }

  function updateAnalyzeState() {
    const hasContent = images.length > 0 || textarea.value.trim().length > 0;
    const budgetLeft = !isBudgetExhausted();
    analyzeBtn.disabled = !hasContent || !budgetLeft || analyzing;

    if (isBudgetExhausted()) {
      updateStatus(`${parseBudget.used}/${MAX_PARSE_BUDGET} parses used — add items manually`);
    } else if (parseBudget.used > 0) {
      updateStatus(`${parseBudget.used}/${MAX_PARSE_BUDGET} parses used`);
    }
  }

  function renderImages() {
    // Clean up previous image-button listeners before replacing DOM
    for (const { el, event, handler } of imageListeners) {
      el.removeEventListener(event, handler);
    }
    imageListeners.length = 0;

    imageGrid.innerHTML = images.map((img) => `
      <div class="restaurant-image-thumb" role="listitem" data-image-id="${img.id}">
        <img src="${img.dataUrl}" alt="Menu image ${img.id}">
        <button class="restaurant-image-remove" type="button"
                aria-label="Remove image ${img.id}" data-remove-id="${img.id}">&times;</button>
        <div class="restaurant-image-progress" data-progress-id="${img.id}"></div>
      </div>
    `).join('');

    // Bind remove buttons (tracked separately for cleanup on re-render)
    imageGrid.querySelectorAll('.restaurant-image-remove').forEach(btn => {
      const removeId = Number(btn.dataset.removeId);
      const handler = () => removeImage(removeId);
      btn.addEventListener('click', handler);
      imageListeners.push({ el: btn, event: 'click', handler });
    });

    updateAnalyzeState();
  }

  async function addFiles(files) {
    const fileArray = Array.from(files);
    for (const file of fileArray) {
      if (images.length >= maxImages) {
        showToast(`Maximum ${maxImages} images allowed`, 'error');
        break;
      }
      try {
        const resized = await resizeImage(file);
        const id = nextImageId++;
        images.push({
          file,
          dataUrl: resized.dataUrl,
          base64: resized.base64,
          mediaType: resized.mediaType,
          id
        });
      } catch (err) {
        showToast(`Failed to process image: ${err.message}`, 'error');
      }
    }
    renderImages();
  }

  function removeImage(id) {
    // Cancel in-flight request if any
    const controller = controllers.get(id);
    if (controller) {
      controller.abort();
      controllers.delete(id);
    }
    const idx = images.findIndex(img => img.id === id);
    if (idx !== -1) images.splice(idx, 1);
    renderImages();
  }

  function showProgress(imageId, show) {
    const el = imageGrid.querySelector(`[data-progress-id="${imageId}"]`);
    if (el) {
      el.innerHTML = show ? '<span class="loading-spinner"></span>' : '';
    }
  }

  // --- Concurrency Queue ---

  /**
   * Process parse requests with bounded concurrency.
   * @param {Array<Object>} requests - Array of {payload, imageId?} objects
   * @returns {Promise<Array<Object>>} Merged items from all responses
   */
  async function processQueue(requests) {
    const allItems = [];
    let activeCount = 0;
    let index = 0;

    return new Promise((resolve) => {
      function scheduleNext() {
        // Guard: stop scheduling after destroy()
        if (destroyed) {
          if (activeCount === 0) resolve(allItems);
          return;
        }

        while (activeCount < MAX_CONCURRENT && index < requests.length) {
          const req = requests[index++];

          // Skip queued requests for images that were removed while waiting
          if (req.imageId && !images.some(img => img.id === req.imageId)) {
            continue;
          }

          if (isBudgetExhausted()) {
            showToast('Parse limit reached — add items manually', 'error');
            break;
          }
          activeCount++;
          if (req.imageId) showProgress(req.imageId, true);

          const controller = new AbortController();
          allControllers.add(controller);
          if (req.imageId) controllers.set(req.imageId, controller);

          parseBudget.used++;
          updateAnalyzeState();

          parseMenu(req.payload, controller.signal)
            .then(result => {
              if (!destroyed && result?.items) {
                allItems.push(...result.items);
              }
            })
            .catch(err => {
              if (err.name === 'AbortError') return; // Cancelled — expected
              if (destroyed) return;
              if (err.status === 429 || (err.message && err.message.includes('429'))) {
                showToast('Parse limit reached — please wait a few minutes or add items manually', 'error');
              } else {
                showToast(`Parse failed: ${err.message || 'Unknown error'}`, 'error');
              }
            })
            .finally(() => {
              activeCount--;
              allControllers.delete(controller);
              if (req.imageId) {
                showProgress(req.imageId, false);
                controllers.delete(req.imageId);
              }
              if (activeCount === 0 && index >= requests.length) {
                resolve(allItems);
              } else {
                scheduleNext();
              }
            });
        }

        // All requests already completed or budget exhausted
        if (activeCount === 0) {
          resolve(allItems);
        }
      }

      scheduleNext();
    });
  }

  // --- Event handlers ---

  async function handleAnalyze() {
    if (analyzing) return;
    if (isBudgetExhausted()) {
      showToast('Parse limit reached — add items manually', 'error');
      return;
    }

    analyzing = true;
    analyzeBtn.disabled = true;
    updateStatus('Analyzing...');

    const requests = [];

    // Text request (if any)
    const text = textarea.value.trim();
    if (text) {
      requests.push({
        payload: { type, text, image: null, mediaType: null }
      });
    }

    // Image requests
    for (const img of images) {
      requests.push({
        payload: { type, text: null, image: img.base64, mediaType: img.mediaType },
        imageId: img.id
      });
    }

    if (requests.length === 0) {
      analyzing = false;
      updateAnalyzeState();
      return;
    }

    try {
      const items = await processQueue(requests);
      if (destroyed) return; // Widget torn down during analysis
      if (onAnalyze && items.length > 0) {
        onAnalyze(items);
      } else if (items.length === 0) {
        showToast('No items found — try adding manually', 'info');
      }
    } finally {
      analyzing = false;
      if (!destroyed) updateAnalyzeState();
    }
  }

  function handleSkip() {
    if (onSkipManual) onSkipManual();
  }

  function handleFileSelect(e) {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
      e.target.value = ''; // Allow re-selecting same file
    }
  }

  // --- Bind events ---

  addListener(textarea, 'input', () => { updateCharCounter(); updateAnalyzeState(); });
  addListener(browseBtn, 'click', () => fileInput.click());
  addListener(cameraBtn, 'click', () => cameraInput.click());
  addListener(fileInput, 'change', handleFileSelect);
  addListener(cameraInput, 'change', handleFileSelect);
  addListener(analyzeBtn, 'click', handleAnalyze);
  addListener(skipBtn, 'click', handleSkip);

  // Initial state
  updateAnalyzeState();

  // --- Public API ---

  return {
    /** Get current images */
    getImages() { return [...images]; },

    /** Get current text value */
    getText() { return textarea.value; },

    /** Clean up all event listeners and abort controllers */
    destroy() {
      destroyed = true;
      for (const { el, event, handler, opts } of listeners) {
        el.removeEventListener(event, handler, opts);
      }
      listeners.length = 0;
      for (const { el, event, handler } of imageListeners) {
        el.removeEventListener(event, handler);
      }
      imageListeners.length = 0;
      for (const controller of allControllers) {
        controller.abort();
      }
      allControllers.clear();
      controllers.clear();
      analyzing = false;
    }
  };
}
