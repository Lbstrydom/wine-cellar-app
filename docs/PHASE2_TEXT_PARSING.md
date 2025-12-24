# Phase 2: Smart Text Input (Claude-Powered Wine Parsing)

## Overview

Add the ability to paste or type wine descriptions and have Claude extract structured wine details. This makes adding wines faster - paste an order confirmation, type a description, or copy text from a website.

**Prerequisites**: 
- Phase 1 complete (bottle management modal exists)
- Claude API integration working (sommelier feature)
- Codebase follows AGENTS.md conventions

## Features

1. **Paste text parsing** - Paste wine order/list/description → Claude extracts wine details
2. **Type and parse** - Type wine description → Claude structures it
3. **Edit before saving** - Review/modify Claude's interpretation before committing
4. **Multiple wines** - Parse multiple wines from a single paste (e.g., order confirmation)

---

## User Flow

1. User clicks empty slot → Add Bottle modal opens
2. User clicks new **"Parse Text"** tab (alongside "Existing Wine" and "New Wine")
3. User pastes or types text (e.g., "2022 Kleine Zalze Chenin Blanc, South Africa, 13.5%, €8.99")
4. User clicks **"Parse with AI"**
5. Claude extracts: wine name, vintage, colour, style, price, etc.
6. Extracted details populate the form fields
7. User reviews/edits if needed
8. User clicks "Add Bottle" to save

---

## Files to Create/Modify

### Backend
- `src/services/claude.js` - Add wine parsing function
- `src/routes/wines.js` - Add parse endpoint

### Frontend
- `public/js/bottles.js` - Add parse tab and functionality
- `public/js/api.js` - Add parse API call
- `public/index.html` - Add parse tab HTML
- `public/css/styles.css` - Add parse-related styles

---

## Backend Implementation

### 1. Update src/services/claude.js

Add this function after the existing `getSommelierRecommendation` function:

```javascript
/**
 * Parse wine details from text using Claude.
 * @param {string} text - Raw text containing wine information
 * @returns {Promise<Object>} Parsed wine details
 */
export async function parseWineFromText(text) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Claude API key not configured');
  }

  const prompt = `You are a wine data extraction assistant. Extract wine details from the following text.

TEXT:
${text}

Extract the following fields (use null if not found):
- wine_name: Full name of the wine (producer + wine name, exclude vintage)
- vintage: Year as integer (null if NV or not specified)
- colour: One of "red", "white", "rose", "sparkling" (infer from grape/style if not explicit)
- style: Grape variety or wine style (e.g., "Sauvignon Blanc", "Chianti", "Champagne")
- price_eur: Price as decimal number (convert to EUR if another currency, use approximate rate)
- vivino_rating: Rating as decimal if mentioned (null if not)
- country: Country of origin
- region: Specific region if mentioned
- alcohol_pct: Alcohol percentage as decimal if mentioned
- notes: Any tasting notes or descriptions

If multiple wines are present, return an array. If single wine, still return an array with one element.

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
      "notes": "Crisp and citrusy"
    }
  ],
  "confidence": "high",
  "parse_notes": "Any notes about assumptions made"
}

RULES:
- Infer colour from grape variety if not stated (e.g., Merlot → red, Chardonnay → white)
- For blends, use the dominant grape as style
- If price is in another currency, convert to EUR (USD: ×0.92, GBP: ×1.17, ZAR: ×0.05)
- Set confidence to "high", "medium", or "low" based on how much you had to infer
- Be conservative - only include what you can reasonably determine`;

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250514',
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }]
  });

  const responseText = message.content[0].text;
  
  try {
    // Handle potential markdown code blocks
    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/) || 
                      responseText.match(/```\s*([\s\S]*?)\s*```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : responseText;
    return JSON.parse(jsonStr.trim());
  } catch (parseError) {
    console.error('Failed to parse Claude response:', responseText);
    throw new Error('Could not parse wine details from response');
  }
}
```

### 2. Update src/routes/wines.js

Add this endpoint (place it BEFORE the `/:id` route):

```javascript
/**
 * Parse wine details from text using Claude.
 * @route POST /api/wines/parse
 */
router.post('/parse', async (req, res) => {
  const { text } = req.body;
  
  if (!text || text.trim().length === 0) {
    return res.status(400).json({ error: 'No text provided' });
  }
  
  if (text.length > 5000) {
    return res.status(400).json({ error: 'Text too long (max 5000 characters)' });
  }
  
  try {
    // Import dynamically to avoid issues if API key not set
    const { parseWineFromText } = await import('../services/claude.js');
    const result = await parseWineFromText(text);
    res.json(result);
  } catch (error) {
    console.error('Wine parsing error:', error);
    
    if (error.message.includes('API key')) {
      return res.status(503).json({ error: 'AI parsing not configured' });
    }
    
    res.status(500).json({ 
      error: 'Failed to parse wine details',
      message: error.message 
    });
  }
});
```

**Important**: Ensure route order in wines.js is:
1. `GET /` 
2. `GET /styles`
3. `GET /search`
4. `POST /parse` ← Add here
5. `GET /:id`
6. `POST /`
7. `PUT /:id`

---

## Frontend Implementation

### 1. Update public/js/api.js

Add this function:

```javascript
/**
 * Parse wine details from text using Claude.
 * @param {string} text - Raw text to parse
 * @returns {Promise<{wines: Array, confidence: string, parse_notes: string}>}
 */
export async function parseWineText(text) {
  const res = await fetch(`${API_BASE}/api/wines/parse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to parse wine');
  }
  return res.json();
}
```

### 2. Update public/js/bottles.js

Add parse tab functionality. Insert these additions:

#### Add at top of file (with other state variables):

```javascript
let parsedWines = [];
let selectedParsedIndex = 0;
```

#### Add new functions:

```javascript
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
    btn.innerHTML = '🔍 Parse with AI';
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
    Confidence: ${result.confidence || 'unknown'}
    ${result.parse_notes ? `<br><small>${result.parse_notes}</small>` : ''}
  </div>`;
  
  // Wine list (if multiple)
  if (parsedWines.length > 1) {
    html += '<div class="parsed-wine-list">';
    parsedWines.forEach((wine, idx) => {
      html += `
        <div class="parsed-wine-item ${idx === selectedParsedIndex ? 'selected' : ''}" data-index="${idx}">
          <strong>${wine.wine_name || 'Unknown'}</strong> ${wine.vintage || 'NV'}
          <br><small>${wine.style || ''} • ${wine.colour || ''}</small>
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
        <div><label>Name:</label> ${wine.wine_name || '-'}</div>
        <div><label>Vintage:</label> ${wine.vintage || 'NV'}</div>
        <div><label>Colour:</label> ${wine.colour || '-'}</div>
        <div><label>Style:</label> ${wine.style || '-'}</div>
        <div><label>Price:</label> ${wine.price_eur ? '€' + wine.price_eur : '-'}</div>
        <div><label>Rating:</label> ${wine.vivino_rating || '-'}</div>
        <div><label>Country:</label> ${wine.country || '-'}</div>
        <div><label>Alcohol:</label> ${wine.alcohol_pct ? wine.alcohol_pct + '%' : '-'}</div>
      </div>
      ${wine.notes ? `<div class="preview-notes"><label>Notes:</label> ${wine.notes}</div>` : ''}
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
```

#### Update `setBottleFormMode` function to handle three modes:

```javascript
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
```

#### Update `initBottles` to add event listener:

```javascript
// Add in initBottles function
document.getElementById('parse-text-btn')?.addEventListener('click', handleParseText);
```

#### Add import for parseWineText at top of file:

```javascript
import { 
  fetchWine, 
  fetchWineStyles, 
  searchWines, 
  createWine, 
  updateWine, 
  addBottles,
  removeBottle,
  parseWineText  // Add this
} from './api.js';
```

### 3. Update public/index.html

Update the bottle modal form toggle to include three tabs. Replace the existing form-toggle div:

```html
<div class="form-section">
  <div class="form-toggle">
    <button type="button" class="toggle-btn active" data-mode="existing">Existing Wine</button>
    <button type="button" class="toggle-btn" data-mode="new">New Wine</button>
    <button type="button" class="toggle-btn" data-mode="parse">Parse Text</button>
  </div>
</div>
```

Add the parse section after `existing-wine-section` and before `new-wine-section`:

```html
<!-- Parse text section -->
<div class="form-section" id="parse-wine-section" style="display: none;">
  <label class="form-label">Paste or type wine details:</label>
  <textarea id="wine-text-input" rows="4" placeholder="e.g., 2022 Kleine Zalze Chenin Blanc, South Africa, €8.99

Or paste an order confirmation, wine list, or any text containing wine information..."></textarea>
  <button type="button" class="btn btn-secondary" id="parse-text-btn" style="margin-top: 0.5rem;">
    🔍 Parse with AI
  </button>
  <div id="parse-results" style="margin-top: 1rem;"></div>
</div>
```

### 4. Update public/css/styles.css

Add these styles:

```css
/* ============================================================
   PARSE TEXT SECTION
   ============================================================ */

#wine-text-input {
  width: 100%;
  padding: 0.8rem;
  background: var(--bg-slot);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 0.9rem;
  font-family: inherit;
  resize: vertical;
  min-height: 100px;
}

#wine-text-input:focus {
  outline: none;
  border-color: var(--accent);
}

#wine-text-input::placeholder {
  color: var(--text-muted);
}

.parse-confidence {
  font-size: 0.85rem;
  padding: 0.5rem;
  background: var(--bg-slot);
  border-radius: 4px;
}

.parse-confidence small {
  opacity: 0.8;
}

.parsed-wine-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 1rem;
  max-height: 150px;
  overflow-y: auto;
}

.parsed-wine-item {
  padding: 0.6rem 0.8rem;
  background: var(--bg-slot);
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
}

.parsed-wine-item:hover {
  background: var(--bg-slot-hover);
}

.parsed-wine-item.selected {
  border-color: var(--accent);
  background: rgba(139, 115, 85, 0.2);
}

.parsed-wine-item strong {
  color: var(--text);
}

.parsed-wine-item small {
  color: var(--text-muted);
}

.parsed-wine-preview {
  background: var(--bg-slot);
  border-radius: 8px;
  padding: 1rem;
}

.parsed-wine-preview h4 {
  margin: 0 0 0.75rem 0;
  font-size: 0.9rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.preview-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.5rem;
  font-size: 0.9rem;
}

.preview-grid label {
  color: var(--text-muted);
  font-size: 0.75rem;
  text-transform: uppercase;
}

.preview-grid > div {
  display: flex;
  flex-direction: column;
}

.preview-notes {
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--border);
  font-size: 0.9rem;
}

.preview-notes label {
  display: block;
  color: var(--text-muted);
  font-size: 0.75rem;
  text-transform: uppercase;
  margin-bottom: 0.25rem;
}

/* Three-tab toggle adjustment */
.form-toggle {
  display: flex;
  gap: 0;
  background: var(--bg-slot);
  border-radius: 8px;
  padding: 4px;
}

.toggle-btn {
  flex: 1;
  padding: 0.5rem 0.75rem;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: 6px;
  font-size: 0.85rem;
  transition: all 0.2s;
  white-space: nowrap;
}
```

---

## Testing

After implementation, test these scenarios:

### Basic parsing
- [ ] Paste "2022 Kleine Zalze Chenin Blanc €8.99" → extracts name, vintage, colour, price
- [ ] Type "Cloudy Bay Sauvignon Blanc 2023 New Zealand" → extracts details

### Multiple wines
- [ ] Paste order confirmation with 3 wines → shows list, can select each
- [ ] Click between wines → preview updates

### Edge cases
- [ ] Paste text with no wine info → shows "No wines found"
- [ ] Paste very long text → shows error (max 5000 chars)
- [ ] API key not set → shows "AI parsing not configured"

### Flow completion
- [ ] Parse wine → click "Use These Details" → form populates
- [ ] Edit parsed details if needed → save → bottle added

### Sample test texts

**Simple:**
```
2022 Kleine Zalze Chenin Blanc, South Africa, 13.5% ABV, €8.99
```

**Order confirmation style:**
```
Your order:
1x Cloudy Bay Sauvignon Blanc 2023 - €24.99
2x Penfolds Bin 389 Cabernet Shiraz 2020 - €45.00 each
1x Moët & Chandon Brut Imperial NV - €39.99
```

**Verbose description:**
```
This stunning Burgundy from Domaine Leflaive is their 2021 Puligny-Montrachet 
Premier Cru "Les Pucelles". Pale gold in color with aromas of citrus, 
white flowers, and subtle oak. 13% alcohol. Rated 94 points by Wine Advocate.
Around £85 per bottle.
```

---

## Deployment

After testing locally:

```bash
git add .
git commit -m "feat: add AI-powered wine text parsing (Phase 2)"
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

- The parse feature requires `ANTHROPIC_API_KEY` to be set
- Claude infers colour from grape variety (Merlot → red, Chardonnay → white)
- Currency conversion is approximate (USD, GBP, ZAR → EUR)
- Multiple wines can be parsed at once, but user adds them one at a time
- Parsed details go into the "New Wine" form for review before saving
