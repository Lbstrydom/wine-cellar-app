# Phase 3: Image/Photo Input (Claude Vision Wine Parsing)

## Overview

Add the ability to upload photos or screenshots of wine labels, menus, or receipts and have Claude Vision extract wine details. This makes adding wines even easier - snap a photo of a bottle or screenshot a wine website.

**Prerequisites**: 
- Phase 1 complete (bottle management modal)
- Phase 2 complete (text parsing)
- Claude API integration working
- Codebase follows AGENTS.md conventions

## Features

1. **Upload image** - Select image file from device
2. **Camera capture** - Take photo directly (mobile)
3. **Drag and drop** - Drop image onto upload area
4. **Screenshot paste** - Ctrl+V to paste screenshot
5. **Claude Vision parsing** - Extract wine details from image
6. **Edit before saving** - Review/modify extracted details

---

## User Flow

1. User clicks empty slot → Add Bottle modal opens
2. User clicks **"Parse Text"** tab (same tab, now supports images too)
3. User either:
   - Clicks upload area to select image
   - Drags image onto upload area
   - Pastes screenshot (Ctrl+V)
   - Uses camera (mobile)
4. Image preview appears
5. User clicks **"Parse Image with AI"**
6. Claude Vision extracts wine details
7. Extracted details populate the form fields
8. User reviews/edits if needed
9. User clicks "Add Bottle" to save

---

## Files to Create/Modify

### Backend
- `src/services/claude.js` - Add image parsing function
- `src/routes/wines.js` - Add image parse endpoint

### Frontend
- `public/js/bottles.js` - Add image upload and parsing
- `public/js/api.js` - Add image parse API call
- `public/index.html` - Add image upload HTML
- `public/css/styles.css` - Add image upload styles

---

## Backend Implementation

### 1. Update src/services/claude.js

Add this function after the existing `parseWineFromText` function:

```javascript
/**
 * Parse wine details from an image using Claude Vision.
 * @param {string} base64Image - Base64 encoded image data
 * @param {string} mediaType - Image MIME type (image/jpeg, image/png, image/webp, image/gif)
 * @returns {Promise<Object>} Parsed wine details
 */
export async function parseWineFromImage(base64Image, mediaType) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Claude API key not configured');
  }

  // Validate media type
  const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!validTypes.includes(mediaType)) {
    throw new Error(`Invalid image type: ${mediaType}. Supported: ${validTypes.join(', ')}`);
  }

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250514',
    max_tokens: 1500,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: base64Image
            }
          },
          {
            type: 'text',
            text: `You are a wine data extraction assistant. Examine this image and extract wine details.

The image may be:
- A wine bottle label
- A wine menu or list
- A receipt or order confirmation
- A screenshot from a wine website or app
- A shelf tag or price label

Extract the following fields (use null if not found or not visible):
- wine_name: Full name of the wine (producer + wine name, exclude vintage)
- vintage: Year as integer (null if NV or not visible)
- colour: One of "red", "white", "rose", "sparkling" (infer from grape/style/bottle colour if not explicit)
- style: Grape variety or wine style (e.g., "Sauvignon Blanc", "Chianti", "Champagne")
- price_eur: Price as decimal number (convert to EUR if another currency, use approximate rate)
- vivino_rating: Rating as decimal if visible (null if not)
- country: Country of origin
- region: Specific region if mentioned
- alcohol_pct: Alcohol percentage as decimal if visible
- notes: Any tasting notes, descriptions, or other relevant text visible

If multiple wines are visible, return an array. If single wine, still return an array with one element.

Respond ONLY with valid JSON, no other text:
{
  "wines": [
    {
      "wine_name": "Producer Wine Name",
      "vintage": 2022,
      "colour": "white",
      "style": "Sauvignon Blanc",
      "price_eur": 12.99,
      "vivino_rating": null,
      "country": "France",
      "region": "Loire Valley",
      "alcohol_pct": 13.0,
      "notes": "Any visible tasting notes"
    }
  ],
  "confidence": "high",
  "parse_notes": "Description of what was visible and any assumptions made"
}

RULES:
- Read all visible text carefully, including small print
- For bottle labels, look for producer name, wine name, vintage, region, alcohol %
- Infer colour from grape variety or bottle appearance if not stated
- If price is in another currency, convert to EUR (USD: ×0.92, GBP: ×1.17, ZAR: ×0.05)
- Set confidence to "high" if clearly legible, "medium" if partially visible, "low" if guessing
- If image is blurry or wine details aren't visible, set confidence to "low" and explain in parse_notes`
          }
        ]
      }
    ]
  });

  const responseText = message.content[0].text;
  
  try {
    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/) || 
                      responseText.match(/```\s*([\s\S]*?)\s*```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : responseText;
    return JSON.parse(jsonStr.trim());
  } catch (parseError) {
    console.error('Failed to parse Claude Vision response:', responseText);
    throw new Error('Could not parse wine details from image');
  }
}
```

### 2. Update src/routes/wines.js

Add this endpoint after the `/parse` text endpoint:

```javascript
/**
 * Parse wine details from image using Claude Vision.
 * @route POST /api/wines/parse-image
 */
router.post('/parse-image', async (req, res) => {
  const { image, mediaType } = req.body;
  
  if (!image) {
    return res.status(400).json({ error: 'No image provided' });
  }
  
  if (!mediaType) {
    return res.status(400).json({ error: 'No media type provided' });
  }
  
  // Check image size (base64 adds ~33% overhead, so 10MB image ≈ 13MB base64)
  // Limit to ~5MB original image
  if (image.length > 7000000) {
    return res.status(400).json({ error: 'Image too large (max 5MB)' });
  }
  
  try {
    const { parseWineFromImage } = await import('../services/claude.js');
    const result = await parseWineFromImage(image, mediaType);
    res.json(result);
  } catch (error) {
    console.error('Image parsing error:', error);
    
    if (error.message.includes('API key')) {
      return res.status(503).json({ error: 'AI parsing not configured' });
    }
    
    if (error.message.includes('Invalid image type')) {
      return res.status(400).json({ error: error.message });
    }
    
    res.status(500).json({ 
      error: 'Failed to parse wine from image',
      message: error.message 
    });
  }
});
```

**Route order in wines.js should be:**
1. `GET /` 
2. `GET /styles`
3. `GET /search`
4. `POST /parse`
5. `POST /parse-image` ← Add here
6. `GET /:id`
7. `POST /`
8. `PUT /:id`

---

## Frontend Implementation

### 1. Update public/js/api.js

Add this function:

```javascript
/**
 * Parse wine details from image using Claude Vision.
 * @param {string} base64Image - Base64 encoded image (without data URL prefix)
 * @param {string} mediaType - MIME type (image/jpeg, image/png, etc.)
 * @returns {Promise<{wines: Array, confidence: string, parse_notes: string}>}
 */
export async function parseWineImage(base64Image, mediaType) {
  const res = await fetch(`${API_BASE}/api/wines/parse-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: base64Image, mediaType })
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to parse image');
  }
  return res.json();
}
```

### 2. Update public/js/bottles.js

Add import for the new API function:

```javascript
import { 
  fetchWine, 
  fetchWineStyles, 
  searchWines, 
  createWine, 
  updateWine, 
  addBottles,
  removeBottle,
  parseWineText,
  parseWineImage  // Add this
} from './api.js';
```

Add state variables at top (with existing ones):

```javascript
let uploadedImage = null;  // { base64: string, mediaType: string, preview: string }
```

Add these new functions:

```javascript
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
  
  // Validate file size (5MB max)
  if (file.size > 5 * 1024 * 1024) {
    showToast('Image too large (max 5MB)');
    return;
  }
  
  // Read file as base64
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
  reader.readAsDataURL(file);
}

/**
 * Show image preview in the upload area.
 * @param {string} dataUrl - Image data URL for preview
 */
function showImagePreview(dataUrl) {
  const previewDiv = document.getElementById('image-preview');
  const uploadArea = document.getElementById('image-upload-area');
  
  previewDiv.innerHTML = `
    <img src="${dataUrl}" alt="Wine image preview" />
    <button type="button" class="btn btn-small btn-secondary" id="clear-image-btn">✕ Clear</button>
  `;
  previewDiv.style.display = 'block';
  uploadArea.classList.add('has-image');
  
  // Show the parse image button
  document.getElementById('parse-image-btn').style.display = 'inline-flex';
  
  // Add clear handler
  document.getElementById('clear-image-btn').addEventListener('click', clearUploadedImage);
}

/**
 * Clear the uploaded image.
 */
function clearUploadedImage() {
  uploadedImage = null;
  
  const previewDiv = document.getElementById('image-preview');
  const uploadArea = document.getElementById('image-upload-area');
  const fileInput = document.getElementById('image-file-input');
  
  previewDiv.innerHTML = '';
  previewDiv.style.display = 'none';
  uploadArea.classList.remove('has-image');
  fileInput.value = '';
  
  // Hide the parse image button
  document.getElementById('parse-image-btn').style.display = 'none';
  
  // Clear results
  document.getElementById('parse-results').innerHTML = '';
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
    btn.innerHTML = '🔍 Parse Image with AI';
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
```

Update `initBottles` function to add event listeners:

```javascript
export async function initBottles() {
  // ... existing init code ...
  
  // Image upload handlers
  const uploadArea = document.getElementById('image-upload-area');
  const fileInput = document.getElementById('image-file-input');
  
  if (uploadArea) {
    uploadArea.addEventListener('click', () => fileInput?.click());
    uploadArea.addEventListener('dragover', handleImageDragOver);
    uploadArea.addEventListener('dragleave', handleImageDragLeave);
    uploadArea.addEventListener('drop', handleImageDrop);
  }
  
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) handleImageFile(file);
    });
  }
  
  // Parse image button
  document.getElementById('parse-image-btn')?.addEventListener('click', handleParseImage);
  
  // Paste handler for screenshots (on the modal)
  document.getElementById('bottle-modal')?.addEventListener('paste', handlePaste);
  
  // ... rest of existing init code ...
}
```

Update `showAddBottleModal` to reset image state:

```javascript
export function showAddBottleModal(location) {
  // ... existing code ...
  
  // Reset image upload
  clearUploadedImage();
  
  // ... rest of existing code ...
}
```

### 3. Update public/index.html

Replace the parse section with an enhanced version that supports both text and images:

```html
<!-- Parse text/image section -->
<div class="form-section" id="parse-wine-section" style="display: none;">
  
  <!-- Image upload area -->
  <div class="image-upload-area" id="image-upload-area">
    <input type="file" id="image-file-input" accept="image/jpeg,image/png,image/webp,image/gif" hidden />
    <div class="upload-prompt">
      <span class="upload-icon">📷</span>
      <span>Click to upload, drag & drop, or paste screenshot</span>
      <small>JPEG, PNG, WebP, GIF (max 5MB)</small>
    </div>
    <div id="image-preview"></div>
  </div>
  
  <button type="button" class="btn btn-secondary" id="parse-image-btn" style="display: none; margin-top: 0.5rem;">
    🔍 Parse Image with AI
  </button>
  
  <div class="parse-divider">
    <span>or paste/type text</span>
  </div>
  
  <!-- Text input area -->
  <textarea id="wine-text-input" rows="3" placeholder="Paste wine description, order confirmation, or any text containing wine info..."></textarea>
  
  <button type="button" class="btn btn-secondary" id="parse-text-btn" style="margin-top: 0.5rem;">
    🔍 Parse Text with AI
  </button>
  
  <div id="parse-results" style="margin-top: 1rem;"></div>
</div>
```

### 4. Update public/css/styles.css

Add these styles:

```css
/* ============================================================
   IMAGE UPLOAD
   ============================================================ */

.image-upload-area {
  border: 2px dashed var(--border);
  border-radius: 8px;
  padding: 1.5rem;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
  background: var(--bg-slot);
  position: relative;
}

.image-upload-area:hover {
  border-color: var(--accent);
  background: rgba(139, 115, 85, 0.1);
}

.image-upload-area.drag-over {
  border-color: var(--accent);
  background: rgba(139, 115, 85, 0.2);
  transform: scale(1.01);
}

.image-upload-area.has-image {
  padding: 0.5rem;
}

.image-upload-area.has-image .upload-prompt {
  display: none;
}

.upload-prompt {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  color: var(--text-muted);
}

.upload-icon {
  font-size: 2rem;
  opacity: 0.7;
}

.upload-prompt small {
  font-size: 0.75rem;
  opacity: 0.7;
}

#image-preview {
  display: none;
  position: relative;
}

#image-preview img {
  max-width: 100%;
  max-height: 200px;
  border-radius: 6px;
  object-fit: contain;
}

#clear-image-btn {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
}

.btn-small {
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
}

/* Parse divider */
.parse-divider {
  display: flex;
  align-items: center;
  text-align: center;
  margin: 1rem 0;
  color: var(--text-muted);
  font-size: 0.8rem;
}

.parse-divider::before,
.parse-divider::after {
  content: '';
  flex: 1;
  border-bottom: 1px solid var(--border);
}

.parse-divider span {
  padding: 0 0.75rem;
}

/* Adjust textarea height when image section is visible */
#parse-wine-section #wine-text-input {
  min-height: 60px;
}

/* Mobile camera capture */
@media (max-width: 768px) {
  .image-upload-area {
    padding: 1rem;
  }
  
  .upload-prompt span {
    font-size: 0.9rem;
  }
  
  #image-preview img {
    max-height: 150px;
  }
}
```

---

## Mobile Camera Support

The `<input type="file" accept="image/*">` automatically allows camera capture on mobile devices. When tapped on iOS/Android, it offers options to:
- Take Photo
- Photo Library
- Browse Files

No additional code needed - the browser handles this natively.

---

## Testing

After implementation, test these scenarios:

### Image upload
- [ ] Click upload area → file picker opens
- [ ] Select image → preview shows
- [ ] Clear button removes image

### Drag and drop
- [ ] Drag image file onto upload area → visual feedback
- [ ] Drop → image preview shows

### Paste screenshot
- [ ] Take screenshot, Ctrl+V in modal → image appears
- [ ] Works with snipping tool / screenshot apps

### Parse image
- [ ] Upload wine bottle label → extracts details
- [ ] Upload menu screenshot → extracts wine(s)
- [ ] Upload blurry image → low confidence warning

### Flow completion
- [ ] Parse image → "Use These Details" → form populates
- [ ] Edit if needed → save → bottle added

### Error handling
- [ ] Upload non-image file → error message
- [ ] Upload >5MB image → error message
- [ ] API key not set → appropriate error

### Mobile (test on phone)
- [ ] Tap upload → camera option appears
- [ ] Take photo → preview shows
- [ ] Parse works on mobile

### Sample test images
Use photos of:
- Wine bottle front labels
- Wine menu pages
- Vivino/wine app screenshots
- Supermarket shelf tags
- Order confirmation screenshots

---

## Deployment

After testing locally:

```bash
git add .
git commit -m "feat: add image/photo parsing with Claude Vision (Phase 3)"
git push
```

Wait for GitHub Actions to build, then on Synology:

```bash
cd ~/Apps/wine-cellar-app
sudo docker compose -f docker-compose.synology.yml pull
sudo docker compose -f docker-compose.synology.yml up -d
```

---

## Notes

- Claude Vision supports JPEG, PNG, WebP, and GIF
- Max image size: 5MB (validated client and server side)
- Base64 encoding adds ~33% size overhead
- Mobile browsers offer camera capture automatically
- Paste works with screenshots from any source
- Multiple wines can be in one image (e.g., menu page)
- Confidence indicator helps users know if they should verify details
