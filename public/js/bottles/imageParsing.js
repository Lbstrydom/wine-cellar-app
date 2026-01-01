/**
 * @fileoverview Image upload and parsing functionality.
 * @module bottles/imageParsing
 */

import { parseWineImage } from '../api.js';
import { showToast } from '../utils.js';
import { bottleState } from './state.js';
import { renderParsedWines } from './textParsing.js';

// Resize threshold - always resize images larger than this (2MB)
const RESIZE_THRESHOLD = 2 * 1024 * 1024;
// Target size for resized images (aim for ~1MB to stay well under server limits)
const TARGET_IMAGE_SIZE = 1 * 1024 * 1024;
// Max dimension for resized images
const MAX_IMAGE_DIMENSION = 2048;

/**
 * Initialize image parsing handlers.
 */
export function initImageParsing() {
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
 * Detect if running on a mobile device.
 * @returns {boolean} True if mobile device
 */
function isMobileDevice() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints && navigator.maxTouchPoints > 2);
}

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
      bottleState.uploadedImage = {
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

    bottleState.uploadedImage = {
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
export function clearUploadedImage() {
  bottleState.uploadedImage = null;

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
  if (!bottleState.uploadedImage) {
    showToast('Please upload an image first');
    return;
  }

  const btn = document.getElementById('parse-image-btn');
  const resultsDiv = document.getElementById('parse-results');

  btn.disabled = true;
  btn.innerHTML = '<span class="loading-spinner"></span> Analyzing...';
  resultsDiv.innerHTML = '<p style="color: var(--text-muted);">Analyzing image...</p>';

  try {
    const result = await parseWineImage(bottleState.uploadedImage.base64, bottleState.uploadedImage.mediaType);
    bottleState.parsedWines = result.wines || [];
    bottleState.selectedParsedIndex = 0;

    if (bottleState.parsedWines.length === 0) {
      resultsDiv.innerHTML = '<p style="color: var(--text-muted);">No wines found in image.</p>';
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
