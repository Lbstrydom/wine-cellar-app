/**
 * @fileoverview Bottle add/edit modal functionality.
 * @module bottles
 */

import {
  fetchWine,
  fetchWineStyles,
  searchWines,
  createWine,
  updateWine,
  addBottles,
  removeBottle,
  parseWineText,
  parseWineImage,
  getSuggestedPlacement
} from './api.js';
import { showToast, escapeHtml } from './utils.js';
import { refreshData, state } from './app.js';
import { showWineModal } from './modals.js';
import { isDragging } from './dragdrop.js';

let bottleModalMode = 'add'; // 'add' or 'edit'
let editingLocation = null;
let editingWineId = null;
let wineStyles = [];
let searchTimeout = null;
let parsedWines = [];
let selectedParsedIndex = 0;
let uploadedImage = null; // { base64: string, mediaType: string, preview: string }

/**
 * Initialise bottle management.
 */
export async function initBottles() {
  // Load wine styles for datalist
  try {
    wineStyles = await fetchWineStyles();
    const datalist = document.getElementById('style-list');
    if (datalist) {
      datalist.innerHTML = wineStyles.map(s => `<option value="${escapeHtml(s)}">`).join('');
    }
  } catch (err) {
    console.error('Failed to load wine styles:', err);
  }

  // Form mode toggle
  document.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => setBottleFormMode(btn.dataset.mode));
  });

  // Wine search input
  const searchInput = document.getElementById('wine-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => handleWineSearch(e.target.value), 300);
    });
  }

  // Form submit
  const form = document.getElementById('bottle-form');
  if (form) {
    form.addEventListener('submit', handleBottleFormSubmit);
  }

  // Cancel button
  document.getElementById('bottle-cancel-btn')?.addEventListener('click', closeBottleModal);

  // Delete button
  document.getElementById('bottle-delete-btn')?.addEventListener('click', handleDeleteBottle);

  // Close modal on overlay click
  document.getElementById('bottle-modal-overlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'bottle-modal-overlay') closeBottleModal();
  });

  // Parse text button
  document.getElementById('parse-text-btn')?.addEventListener('click', handleParseText);

  // Image upload handlers
  const uploadArea = document.getElementById('image-upload-area');
  const fileInput = document.getElementById('image-file-input');
  const cameraInput = document.getElementById('camera-file-input');
  const browseBtn = document.getElementById('browse-files-btn');
  const photoBtn = document.getElementById('take-photo-btn');

  if (uploadArea) {
    // Click on upload area opens file browser (on desktop) or shows options (handled by buttons)
    uploadArea.addEventListener('click', (e) => {
      // Only trigger if clicking the upload prompt area, not the preview
      if (e.target.closest('#image-preview')) return;
      // On mobile, prefer camera if available
      if (isMobileDevice() && cameraInput) {
        cameraInput.click();
      } else {
        fileInput?.click();
      }
    });
    uploadArea.addEventListener('dragover', handleImageDragOver);
    uploadArea.addEventListener('dragleave', handleImageDragLeave);
    uploadArea.addEventListener('drop', handleImageDrop);
  }

  if (browseBtn) {
    browseBtn.addEventListener('click', () => fileInput?.click());
  }

  if (photoBtn) {
    photoBtn.addEventListener('click', () => cameraInput?.click());
  }

  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) handleImageFile(file);
    });
  }

  if (cameraInput) {
    cameraInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) handleImageFile(file);
    });
  }

  // Parse image button
  document.getElementById('parse-image-btn')?.addEventListener('click', handleParseImage);

  // Paste handler for screenshots (on the modal)
  document.getElementById('bottle-modal')?.addEventListener('paste', handlePaste);
}

/**
 * Handle slot click - show appropriate modal.
 * @param {HTMLElement} slotEl - Slot element
 */
export function handleSlotClick(slotEl) {
  // Check if in slot picker mode first
  if (document.body.classList.contains('slot-picker-mode')) {
    handleSlotPickerClick(slotEl);
    return;
  }

  // Don't trigger if dragging
  if (isDragging()) return;

  const location = slotEl.dataset.location;
  const wineId = slotEl.dataset.wineId;

  if (wineId) {
    // Filled slot - find slot data and show detail/edit modal
    const slotData = findSlotData(location);
    if (slotData) {
      showWineModal(slotData);
    }
  } else {
    // Empty slot - show add bottle modal
    showAddBottleModal(location);
  }
}

/**
 * Find slot data from current layout.
 * @param {string} location - Location code
 * @returns {Object|null}
 */
function findSlotData(location) {
  if (!state.layout) return null;
  const allSlots = [
    ...state.layout.fridge.rows.flatMap(r => r.slots),
    ...state.layout.cellar.rows.flatMap(r => r.slots)
  ];
  return allSlots.find(s => s.location_code === location);
}

/**
 * Show modal for adding new bottle.
 * @param {string} location - Target slot location
 */
export function showAddBottleModal(location) {
  bottleModalMode = 'add';
  editingLocation = location;
  editingWineId = null;

  document.getElementById('bottle-modal-title').textContent = 'Add New Bottle';
  document.getElementById('bottle-modal-subtitle').textContent = `Adding to slot: ${location}`;
  document.getElementById('bottle-save-btn').textContent = 'Add Bottle';
  document.getElementById('bottle-delete-btn').style.display = 'none';
  document.getElementById('quantity-section').style.display = 'block';

  // Reset form
  document.getElementById('bottle-form').reset();
  document.getElementById('selected-wine-id').value = '';
  document.getElementById('wine-search-results').classList.remove('active');

  // Reset image upload
  clearUploadedImage();

  // Clear parse results
  const parseResults = document.getElementById('parse-results');
  if (parseResults) parseResults.innerHTML = '';

  // Default to existing wine mode
  setBottleFormMode('existing');

  document.getElementById('bottle-modal-overlay').classList.add('active');
}

/**
 * Show modal for editing existing bottle.
 * @param {string} location - Slot location
 * @param {number} wineId - Wine ID
 */
export async function showEditBottleModal(location, wineId) {
  bottleModalMode = 'edit';
  editingLocation = location;
  editingWineId = wineId;

  document.getElementById('bottle-modal-title').textContent = 'Edit Wine';
  document.getElementById('bottle-modal-subtitle').textContent = `Location: ${location}`;
  document.getElementById('bottle-save-btn').textContent = 'Save Changes';
  document.getElementById('bottle-delete-btn').style.display = 'block';
  document.getElementById('quantity-section').style.display = 'none';

  // Hide toggle buttons - go straight to form
  const formToggle = document.querySelector('.form-toggle');
  if (formToggle) formToggle.style.display = 'none';

  // Load wine details
  try {
    const wine = await fetchWine(wineId);
    document.getElementById('wine-name').value = wine.wine_name || '';
    document.getElementById('wine-vintage').value = wine.vintage || '';
    document.getElementById('wine-colour').value = wine.colour || 'white';
    document.getElementById('wine-style').value = wine.style || '';
    document.getElementById('wine-rating').value = wine.vivino_rating || '';
    document.getElementById('wine-price').value = wine.price_eur || '';
    document.getElementById('wine-country').value = wine.country || '';
    document.getElementById('wine-drink-from').value = wine.drink_from || '';
    document.getElementById('wine-drink-peak').value = wine.drink_peak || '';
    document.getElementById('wine-drink-until').value = wine.drink_until || '';
    document.getElementById('selected-wine-id').value = wineId;
  } catch (_err) {
    showToast('Failed to load wine details');
    return;
  }

  // Switch to edit mode (shows form fields)
  setBottleFormMode('new');

  document.getElementById('bottle-modal-overlay').classList.add('active');
}

/**
 * Close bottle modal.
 */
export function closeBottleModal() {
  document.getElementById('bottle-modal-overlay').classList.remove('active');
  editingLocation = null;
  editingWineId = null;

  // Reset form toggle visibility
  const formToggle = document.querySelector('.form-toggle');
  if (formToggle) formToggle.style.display = 'flex';
}

/**
 * Set bottle form mode (existing wine search, new wine entry, or parse text).
 * @param {string} mode - 'existing', 'new', or 'parse'
 */
function setBottleFormMode(mode) {
  // Update toggle buttons
  document.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  // Show/hide sections
  const existingSection = document.getElementById('existing-wine-section');
  const newSection = document.getElementById('new-wine-section');
  const parseSection = document.getElementById('parse-wine-section');

  if (existingSection) existingSection.style.display = mode === 'existing' ? 'block' : 'none';
  if (newSection) newSection.style.display = mode === 'new' ? 'block' : 'none';
  if (parseSection) parseSection.style.display = mode === 'parse' ? 'block' : 'none';
}

/**
 * Handle wine search input.
 * @param {string} query - Search query
 */
async function handleWineSearch(query) {
  const resultsContainer = document.getElementById('wine-search-results');

  if (query.length < 2) {
    resultsContainer.classList.remove('active');
    return;
  }

  try {
    const wines = await searchWines(query);

    if (wines.length === 0) {
      resultsContainer.innerHTML = '<div class="search-result-item">No wines found. Try "New Wine" tab.</div>';
    } else {
      resultsContainer.innerHTML = wines.map(wine => `
        <div class="search-result-item" data-wine-id="${escapeHtml(wine.id)}">
          <div class="search-result-name">${escapeHtml(wine.wine_name)} ${escapeHtml(wine.vintage) || 'NV'}</div>
          <div class="search-result-meta">${escapeHtml(wine.style) || ''} - ${escapeHtml(wine.colour)}</div>
        </div>
      `).join('');

      // Add click handlers
      resultsContainer.querySelectorAll('.search-result-item[data-wine-id]').forEach(item => {
        item.addEventListener('click', () => selectSearchResult(item));
      });
    }

    resultsContainer.classList.add('active');
  } catch (err) {
    console.error('Search failed:', err);
  }
}

/**
 * Handle search result selection.
 * @param {HTMLElement} item - Selected item
 */
function selectSearchResult(item) {
  const wineId = item.dataset.wineId;

  document.getElementById('selected-wine-id').value = wineId;
  document.getElementById('wine-search').value = item.querySelector('.search-result-name').textContent;
  document.getElementById('wine-search-results').classList.remove('active');

  // Highlight selected
  document.querySelectorAll('.search-result-item').forEach(i => i.classList.remove('selected'));
  item.classList.add('selected');
}

/**
 * Handle bottle form submission.
 * @param {Event} e - Submit event
 */
async function handleBottleFormSubmit(e) {
  e.preventDefault();

  const mode = document.querySelector('.toggle-btn.active')?.dataset.mode || 'new';
  const quantity = Number.parseInt(document.getElementById('bottle-quantity')?.value, 10) || 1;

  try {
    let wineId;

    if (bottleModalMode === 'edit' || mode === 'new') {
      // Create or update wine
      const wineData = {
        wine_name: document.getElementById('wine-name').value.trim(),
        vintage: document.getElementById('wine-vintage').value || null,
        colour: document.getElementById('wine-colour').value,
        style: document.getElementById('wine-style').value.trim() || null,
        vivino_rating: document.getElementById('wine-rating').value || null,
        price_eur: document.getElementById('wine-price').value || null,
        country: document.getElementById('wine-country')?.value.trim() || null,
        drink_from: document.getElementById('wine-drink-from')?.value || null,
        drink_peak: document.getElementById('wine-drink-peak')?.value || null,
        drink_until: document.getElementById('wine-drink-until')?.value || null
      };

      if (!wineData.wine_name) {
        showToast('Wine name is required');
        return;
      }

      if (bottleModalMode === 'edit' && editingWineId) {
        // Update existing wine
        await updateWine(editingWineId, wineData);
        showToast('Wine updated');
        wineId = editingWineId;
      } else {
        // Create new wine
        const result = await createWine(wineData);
        wineId = result.id;
      }
    } else {
      // Using existing wine
      wineId = document.getElementById('selected-wine-id').value;
      if (!wineId) {
        showToast('Please select a wine');
        return;
      }
    }

    // Add bottle(s) to slot(s) - only for add mode
    if (bottleModalMode === 'add') {
      // Check if user selected smart placement vs specific slot
      const useSmartPlacement = editingLocation === 'smart';

      if (useSmartPlacement) {
        // Get AI-suggested placement
        try {
          const suggestion = await getSuggestedPlacement(wineId);
          if (suggestion.suggestedSlot) {
            const result = await addBottles(wineId, suggestion.suggestedSlot, quantity);
            showToast(`${result.message} (${suggestion.zoneName})`);
          } else {
            showToast('No empty slots in suggested zone. Please select manually.');
            showSlotPickerModalForWine(wineId, document.getElementById('wine-name').value || 'Wine');
            return;
          }
        } catch (err) {
          showToast(`Placement error: ${err.message}. Select slot manually.`);
          showSlotPickerModalForWine(wineId, document.getElementById('wine-name').value || 'Wine');
          return;
        }
      } else {
        const result = await addBottles(wineId, editingLocation, quantity);
        showToast(result.message);
      }
    }

    closeBottleModal();
    await refreshData();

  } catch (err) {
    showToast('Error: ' + err.message);
  }
}

/**
 * Show slot picker for a specific wine (used as fallback).
 * @param {number} wineId - Wine ID
 * @param {string} wineName - Wine name for display
 */
function showSlotPickerModalForWine(wineId, wineName) {
  closeBottleModal();
  showSlotPickerModal(wineId, wineName);
}

/**
 * Handle delete bottle button.
 */
async function handleDeleteBottle() {
  if (!editingLocation) return;

  if (!confirm(`Remove bottle from ${editingLocation}? This won't log it as consumed.`)) {
    return;
  }

  try {
    const result = await removeBottle(editingLocation);
    showToast(result.message);
    closeBottleModal();
    await refreshData();
  } catch (err) {
    showToast('Error: ' + err.message);
  }
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
    parsedWines = result.wines || [];

    if (parsedWines.length === 0) {
      resultsDiv.innerHTML = '<p style="color: var(--text-muted);">No wines found in text.</p>';
      return;
    }

    renderParsedWines(result);

  } catch (err) {
    resultsDiv.innerHTML = `<p style="color: var(--priority-1);">Error: ${err.message}</p>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Parse with AI';
  }
}

/**
 * Render parsed wines for selection.
 * @param {Object} result - Parse result with wines array
 */
function renderParsedWines(result) {
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
  if (parsedWines.length > 1) {
    html += '<div class="parsed-wine-list">';
    parsedWines.forEach((wine, idx) => {
      html += `
        <div class="parsed-wine-item ${idx === selectedParsedIndex ? 'selected' : ''}" data-index="${idx}">
          <strong>${escapeHtml(wine.wine_name) || 'Unknown'}</strong> ${escapeHtml(wine.vintage) || 'NV'}
          <br><small>${escapeHtml(wine.style) || ''} - ${escapeHtml(wine.colour) || ''}</small>
        </div>
      `;
    });
    html += '</div>';
  }

  // Selected wine preview
  const wine = parsedWines[selectedParsedIndex];
  html += `
    <div class="parsed-wine-preview">
      <h4>Extracted Details</h4>
      <div class="preview-grid">
        <div><label>Name:</label> ${escapeHtml(wine.wine_name) || '-'}</div>
        <div><label>Vintage:</label> ${escapeHtml(wine.vintage) || 'NV'}</div>
        <div><label>Colour:</label> ${escapeHtml(wine.colour) || '-'}</div>
        <div><label>Style:</label> ${escapeHtml(wine.style) || '-'}</div>
        <div><label>Price:</label> ${wine.price_eur ? '\u20AC' + escapeHtml(wine.price_eur) : '-'}</div>
        <div><label>Rating:</label> ${escapeHtml(wine.vivino_rating) || '-'}</div>
        <div><label>Country:</label> ${escapeHtml(wine.country) || '-'}</div>
        <div><label>Alcohol:</label> ${wine.alcohol_pct ? escapeHtml(wine.alcohol_pct) + '%' : '-'}</div>
      </div>
      ${wine.notes ? `<div class="preview-notes"><label>Notes:</label> ${escapeHtml(wine.notes)}</div>` : ''}
      <button type="button" class="btn btn-primary" id="use-parsed-btn" style="margin-top: 1rem;">
        Use These Details
      </button>
    </div>
  `;

  resultsDiv.innerHTML = html;

  // Add click handlers for wine selection
  resultsDiv.querySelectorAll('.parsed-wine-item').forEach(item => {
    item.addEventListener('click', () => {
      selectedParsedIndex = parseInt(item.dataset.index);
      renderParsedWines(result);
    });
  });

  // Add handler for "Use These Details" button
  document.getElementById('use-parsed-btn')?.addEventListener('click', () => {
    useParsedWine(parsedWines[selectedParsedIndex]);
  });
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

/**
 * Detect if running on a mobile device.
 * @returns {boolean} True if mobile device
 */
function isMobileDevice() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints && navigator.maxTouchPoints > 2);
}

// Resize threshold - always resize images larger than this (2MB)
const RESIZE_THRESHOLD = 2 * 1024 * 1024;
// Target size for resized images (aim for ~1MB to stay well under server limits)
const TARGET_IMAGE_SIZE = 1 * 1024 * 1024;
// Max dimension for resized images
const MAX_IMAGE_DIMENSION = 2048;

/**
 * Handle image file selection.
 * @param {File} file - Selected image file
 */
async function handleImageFile(file) {
  // Validate file type
  const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!validTypes.includes(file.type)) {
    showToast('Invalid image type. Use JPEG, PNG, WebP, or GIF.');
    return;
  }

  // If file is over the threshold, resize it for faster upload and to stay under server limits
  if (file.size > RESIZE_THRESHOLD) {
    showToast('Optimizing image...');
    try {
      const resizedResult = await resizeImage(file);
      uploadedImage = {
        base64: resizedResult.base64,
        mediaType: resizedResult.mediaType,
        preview: resizedResult.dataUrl
      };
      showImagePreview(resizedResult.dataUrl);
      showToast(`Image optimized (${formatFileSize(file.size)} → ${formatFileSize(resizedResult.size)})`);
      return;
    } catch (err) {
      console.error('Failed to resize image:', err);
      showToast('Failed to resize image. Please use a smaller file.');
      return;
    }
  }

  // Read file as base64 (file is within size limit)
  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    const base64 = dataUrl.split(',')[1];

    uploadedImage = {
      base64: base64,
      mediaType: file.type,
      preview: dataUrl
    };

    showImagePreview(dataUrl);
  };
  reader.onerror = () => {
    showToast('Failed to read image file');
  };
  reader.readAsDataURL(file);
}

/**
 * Format file size for display.
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted size string
 */
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/**
 * Resize an image to fit within size constraints.
 * Uses Canvas API to downscale large images.
 * @param {File} file - Image file to resize
 * @returns {Promise<{base64: string, mediaType: string, dataUrl: string, size: number}>}
 */
function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    img.onload = () => {
      // Calculate new dimensions maintaining aspect ratio
      let width = img.width;
      let height = img.height;

      // Scale down if larger than max dimension
      if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
        if (width > height) {
          height = Math.round((height * MAX_IMAGE_DIMENSION) / width);
          width = MAX_IMAGE_DIMENSION;
        } else {
          width = Math.round((width * MAX_IMAGE_DIMENSION) / height);
          height = MAX_IMAGE_DIMENSION;
        }
      }

      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);

      // Try different quality levels to get under target size
      let quality = 0.85;
      let dataUrl;
      let attempts = 0;

      // Output as JPEG for better compression (unless original was PNG with transparency)
      const outputType = 'image/jpeg';

      do {
        dataUrl = canvas.toDataURL(outputType, quality);
        const size = Math.round((dataUrl.length - 'data:image/jpeg;base64,'.length) * 0.75);

        if (size <= TARGET_IMAGE_SIZE || quality <= 0.3) {
          const base64 = dataUrl.split(',')[1];
          resolve({
            base64,
            mediaType: outputType,
            dataUrl,
            size
          });
          return;
        }

        quality -= 0.1;
        attempts++;
      } while (attempts < 10);

      // If we still couldn't get it small enough, return what we have
      const base64 = dataUrl.split(',')[1];
      resolve({
        base64,
        mediaType: outputType,
        dataUrl,
        size: Math.round((dataUrl.length - 'data:image/jpeg;base64,'.length) * 0.75)
      });
    };

    img.onerror = () => {
      reject(new Error('Failed to load image for resizing'));
    };

    // Load the image from file
    const reader = new FileReader();
    reader.onload = (e) => {
      img.src = e.target.result;
    };
    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Show image preview in the upload area.
 * @param {string} dataUrl - Image data URL for preview
 */
function showImagePreview(dataUrl) {
  const previewDiv = document.getElementById('image-preview');
  const uploadArea = document.getElementById('image-upload-area');

  // Create elements safely to avoid XSS
  previewDiv.innerHTML = '';
  const img = document.createElement('img');
  img.src = dataUrl;
  img.alt = 'Wine image preview';

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'btn btn-small btn-secondary';
  clearBtn.id = 'clear-image-btn';
  clearBtn.textContent = 'Clear';

  previewDiv.appendChild(img);
  previewDiv.appendChild(clearBtn);
  previewDiv.style.display = 'block';
  uploadArea.classList.add('has-image');

  // Show the parse image button
  document.getElementById('parse-image-btn').style.display = 'inline-flex';

  // Add clear handler
  clearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    clearUploadedImage();
  });
}

/**
 * Clear the uploaded image.
 */
function clearUploadedImage() {
  uploadedImage = null;

  const previewDiv = document.getElementById('image-preview');
  const uploadArea = document.getElementById('image-upload-area');
  const fileInput = document.getElementById('image-file-input');

  if (previewDiv) {
    previewDiv.innerHTML = '';
    previewDiv.style.display = 'none';
  }
  if (uploadArea) uploadArea.classList.remove('has-image');
  if (fileInput) fileInput.value = '';

  // Hide the parse image button
  const parseImageBtn = document.getElementById('parse-image-btn');
  if (parseImageBtn) parseImageBtn.style.display = 'none';
}

/**
 * Handle parse image button click.
 */
async function handleParseImage() {
  if (!uploadedImage) {
    showToast('Please upload an image first');
    return;
  }

  const btn = document.getElementById('parse-image-btn');
  const resultsDiv = document.getElementById('parse-results');

  btn.disabled = true;
  btn.innerHTML = '<span class="loading-spinner"></span> Analyzing...';
  resultsDiv.innerHTML = '<p style="color: var(--text-muted);">Analyzing image...</p>';

  try {
    const result = await parseWineImage(uploadedImage.base64, uploadedImage.mediaType);
    parsedWines = result.wines || [];
    selectedParsedIndex = 0;

    if (parsedWines.length === 0) {
      resultsDiv.innerHTML = '<p style="color: var(--text-muted);">No wines found in image.</p>';
      return;
    }

    renderParsedWines(result);

  } catch (err) {
    resultsDiv.innerHTML = `<p style="color: var(--priority-1);">Error: ${err.message}</p>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Parse Image with AI';
  }
}

/**
 * Handle paste event for screenshots.
 * @param {ClipboardEvent} e - Paste event
 */
function handlePaste(e) {
  const items = e.clipboardData?.items;
  if (!items) return;

  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const file = item.getAsFile();
      if (file) handleImageFile(file);
      return;
    }
  }
}

/**
 * Handle drag over for image drop.
 * @param {DragEvent} e
 */
function handleImageDragOver(e) {
  e.preventDefault();
  e.currentTarget.classList.add('drag-over');
}

/**
 * Handle drag leave for image drop.
 * @param {DragEvent} e
 */
function handleImageDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}

/**
 * Handle image drop.
 * @param {DragEvent} e
 */
function handleImageDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');

  const files = e.dataTransfer?.files;
  if (files && files.length > 0) {
    const file = files[0];
    if (file.type.startsWith('image/')) {
      handleImageFile(file);
    } else {
      showToast('Please drop an image file');
    }
  }
}

// ============================================================
// SLOT PICKER MODE
// ============================================================

let pendingAddWineId = null;

/**
 * Show modal to pick empty slot for adding a wine.
 * @param {number} wineId - Wine to add
 * @param {string} wineName - Wine name for display
 * @param {boolean} offerSmartPlace - Whether to offer smart placement option
 */
export async function showSlotPickerModal(wineId, wineName, offerSmartPlace = true) {
  pendingAddWineId = wineId;

  // Update modal content
  document.getElementById('slot-picker-title').textContent = `Add: ${wineName}`;

  // Try to get placement suggestion if smart place offered
  let suggestionText = 'Click an empty slot to add the bottle';
  if (offerSmartPlace) {
    try {
      const suggestion = await getSuggestedPlacement(wineId);
      if (suggestion.zoneName && suggestion.suggestedSlot) {
        suggestionText = `Suggested: ${suggestion.zoneName} (${suggestion.suggestedSlot}) - Click slot or use Smart Place`;
        // Highlight the suggested slot
        const suggestedSlotEl = document.querySelector(`.slot[data-location="${suggestion.suggestedSlot}"]`);
        if (suggestedSlotEl) {
          suggestedSlotEl.classList.add('suggested-slot');
        }
      }
    } catch (_err) {
      // Ignore errors, just use default text
    }
  }
  document.getElementById('slot-picker-instruction').textContent = suggestionText;

  // Enable slot picker mode
  document.body.classList.add('slot-picker-mode');

  // Show overlay
  document.getElementById('slot-picker-overlay').classList.add('active');

  // Highlight empty slots
  document.querySelectorAll('.slot.empty').forEach(slot => {
    slot.classList.add('picker-target');
  });

  // Add cancel handler
  document.getElementById('cancel-slot-picker')?.addEventListener('click', closeSlotPickerModal);
}

/**
 * Handle slot click in picker mode.
 * @param {HTMLElement} slotEl - Clicked slot
 */
async function handleSlotPickerClick(slotEl) {
  if (!document.body.classList.contains('slot-picker-mode')) return;

  const location = slotEl.dataset.location;

  if (!slotEl.classList.contains('empty')) {
    showToast('Please select an empty slot');
    return;
  }

  try {
    await addBottles(pendingAddWineId, location, 1);
    showToast(`Added to ${location}`);
    closeSlotPickerModal();
    await refreshData();
  } catch (err) {
    showToast('Error: ' + err.message);
  }
}

/**
 * Close slot picker modal.
 */
export function closeSlotPickerModal() {
  document.body.classList.remove('slot-picker-mode');
  document.getElementById('slot-picker-overlay').classList.remove('active');
  document.querySelectorAll('.slot.picker-target').forEach(slot => {
    slot.classList.remove('picker-target');
  });
  document.querySelectorAll('.slot.suggested-slot').forEach(slot => {
    slot.classList.remove('suggested-slot');
  });
  pendingAddWineId = null;
}
