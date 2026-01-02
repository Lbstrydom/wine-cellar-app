# Wine Confirmation Feature - Implementation Plan

> **Goal**: Add a "Confirm Wine Match" step before saving, showing alternative wines like Vivino does

---

## Problem Statement

Currently when a user adds a wine:
1. User uploads image/pastes text → Claude parses wine details
2. User clicks "Add Wine" → Wine saved immediately
3. Ratings fetched in background → **No verification if correct wine found**

**Result**: Wrong wines get saved with wrong ratings (e.g., "Nederburg Private Bin Two Centuries" matched to wrong Nederburg wine)

---

## Solution Overview

### User Flow (New)

```
┌─────────────────────────────────────────────────────────────────┐
│  1. USER INPUT                                                   │
│     Upload image / Paste text / Manual entry                    │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  2. CLAUDE PARSING                                               │
│     Extract: wine name, vintage, producer, colour, style        │
│     Show confidence indicator                                    │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  3. WINE SEARCH (NEW)                                           │
│     Search Vivino API for matching wines                        │
│     Return: top 5 matches + other wines from producer           │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  4. CONFIRMATION MODAL (NEW)                                    │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ "We found these wines matching your input:"                 ││
│  │                                                              ││
│  │ [Image] Nederburg Private Bin Two Centuries 2019  ★4.0     ││
│  │         Cabernet Sauvignon · Coastal Region · 313 ratings  ││
│  │         [✓ This is it]                                      ││
│  │                                                              ││
│  │ [Image] Nederburg Private Bin Cabernet 2018       ★3.8     ││
│  │         Cabernet Sauvignon · Paarl · 156 ratings           ││
│  │         [Select this]                                       ││
│  │                                                              ││
│  │ ─────────────────────────────────────────────────────────── ││
│  │ Other wines from Nederburg:                                 ││
│  │                                                              ││
│  │ [Img] 1791 Cabernet  [Img] 1791 Merlot  [Img] Winemasters  ││
│  │       ★3.7                ★3.5               ★3.6          ││
│  │                                                              ││
│  │ ─────────────────────────────────────────────────────────── ││
│  │ [ Edit wine details ]  [ Skip - add without ratings ]       ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  5. SAVE WINE                                                    │
│     Save wine with Vivino ID for accurate rating lookup         │
│     Fetch ratings from confirmed source                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Technical Implementation

### Part 1: Vivino Search Integration

#### 1.1 Vivino API Discovery

Based on research, Vivino has an internal API:
- **Search endpoint**: `https://www.vivino.com/api/explore/explore`
- **Wine details**: `https://www.vivino.com/api/wines/{wine_id}`

**Data available from Vivino API:**
- Wine name, vintage, winery
- Rating (average), rating count
- Wine type (red/white/etc), grape variety
- Region, country
- Price (market price)
- Bottle image URL
- Wine ID (for direct linking)

#### 1.2 New Service: `src/services/vivinoSearch.js`

```javascript
/**
 * Search Vivino for wines matching the given criteria.
 * Uses Bright Data Web Unlocker if direct access fails.
 */

import { fetchWithBrightData } from './brightDataClient.js';

const VIVINO_API_BASE = 'https://www.vivino.com/api';

/**
 * Search Vivino for wines matching query.
 * @param {Object} params - Search parameters
 * @param {string} params.query - Wine name to search
 * @param {string} [params.producer] - Producer/winery name
 * @param {number} [params.vintage] - Year
 * @param {string} [params.country] - Country code (e.g., 'za', 'fr')
 * @returns {Promise<{matches: Array, producerWines: Array}>}
 */
export async function searchVivinoWines({ query, producer, vintage, country }) {
  // Build search URL
  const searchUrl = buildSearchUrl({ query, vintage, country });

  // Fetch via Bright Data (Vivino blocks direct requests)
  const response = await fetchWithBrightData(searchUrl, {
    zone: process.env.BRIGHTDATA_WEB_ZONE
  });

  const data = JSON.parse(response);

  // Parse matches
  const matches = parseVivinoResults(data.explore_vintage?.matches || []);

  // If we have a producer, fetch their other wines
  let producerWines = [];
  if (producer && matches.length > 0) {
    const wineryId = matches[0].winery?.id;
    if (wineryId) {
      producerWines = await fetchWineryWines(wineryId);
    }
  }

  return { matches, producerWines };
}

/**
 * Fetch all wines from a specific winery.
 */
export async function fetchWineryWines(wineryId, limit = 10) {
  const url = `${VIVINO_API_BASE}/wineries/${wineryId}/wines?per_page=${limit}`;
  const response = await fetchWithBrightData(url);
  return parseVivinoResults(JSON.parse(response).wines || []);
}

/**
 * Get detailed wine info by Vivino wine ID.
 */
export async function getVivinoWineDetails(wineId) {
  const url = `${VIVINO_API_BASE}/wines/${wineId}`;
  const response = await fetchWithBrightData(url);
  return parseWineDetails(JSON.parse(response));
}

function buildSearchUrl({ query, vintage, country }) {
  const params = new URLSearchParams({
    q: query,
    per_page: 10
  });

  if (vintage) params.append('year', vintage);
  if (country) params.append('country_codes[]', country);

  return `${VIVINO_API_BASE}/explore/explore?${params}`;
}

function parseVivinoResults(matches) {
  return matches.map(match => ({
    vivinoId: match.vintage?.wine?.id,
    vintageId: match.vintage?.id,
    name: match.vintage?.name || match.vintage?.wine?.name,
    vintage: match.vintage?.year,
    winery: {
      id: match.vintage?.wine?.winery?.id,
      name: match.vintage?.wine?.winery?.name
    },
    rating: match.vintage?.statistics?.ratings_average,
    ratingCount: match.vintage?.statistics?.ratings_count,
    region: match.vintage?.wine?.region?.name,
    country: match.vintage?.wine?.region?.country?.name,
    grapeVariety: match.vintage?.wine?.style?.varietal_name,
    wineType: getWineType(match.vintage?.wine?.type_id),
    imageUrl: match.vintage?.image?.variations?.bottle_medium,
    price: match.price?.amount,
    currency: match.price?.currency?.code,
    vivinoUrl: `https://www.vivino.com/w/${match.vintage?.wine?.id}`
  }));
}

function getWineType(typeId) {
  const types = { 1: 'red', 2: 'white', 3: 'sparkling', 4: 'rose', 7: 'dessert', 24: 'fortified' };
  return types[typeId] || 'unknown';
}
```

#### 1.3 Bright Data Scraper (Alternative)

If API access is unreliable, create a Bright Data scraper:

**Scraper Code for Bright Data IDE:**
```javascript
// Vivino Wine Search Scraper
// Input: { query: "wine name", vintage: 2019 }

navigate(`https://www.vivino.com/search/wines?q=${encodeURIComponent(input.query)}`);

// Wait for results to load
wait('.search-results-list');

// Parse search results
let wines = parse({
  wines: {
    _$: '.wine-card',
    vivinoId: '.wine-card@data-wine',
    name: '.wine-card__name',
    winery: '.wine-card__winery',
    rating: '.average__number',
    ratingCount: '.average__stars + span',
    region: '.wine-card__region',
    imageUrl: '.wine-card__image img@src',
    price: '.wine-price-value'
  }
});

// If vintage specified, filter results
if (input.vintage) {
  wines.wines = wines.wines.filter(w =>
    w.name.includes(input.vintage.toString())
  );
}

collect(wines);
```

---

### Part 2: Backend API Endpoints

#### 2.1 New Route: `src/routes/wineSearch.js`

```javascript
import { Router } from 'express';
import { searchVivinoWines, getVivinoWineDetails } from '../services/vivinoSearch.js';

const router = Router();

/**
 * Search for wines (returns candidates for confirmation).
 * POST /api/wine-search
 */
router.post('/', async (req, res) => {
  try {
    const { wineName, producer, vintage, country, colour } = req.body;

    // Search Vivino
    const vivinoResults = await searchVivinoWines({
      query: `${producer || ''} ${wineName}`.trim(),
      producer,
      vintage,
      country: countryToCode(country)
    });

    // Format response
    res.json({
      query: { wineName, producer, vintage, country },
      matches: vivinoResults.matches.slice(0, 5),
      producerWines: vivinoResults.producerWines.slice(0, 6),
      searchedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Wine search error:', error);
    res.status(500).json({ error: 'Failed to search for wines' });
  }
});

/**
 * Get detailed wine info by Vivino ID.
 * GET /api/wine-search/vivino/:id
 */
router.get('/vivino/:id', async (req, res) => {
  try {
    const details = await getVivinoWineDetails(req.params.id);
    res.json(details);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch wine details' });
  }
});

export default router;
```

#### 2.2 Update `src/routes/wines.js`

Add Vivino ID storage:

```javascript
// When creating wine, optionally store Vivino reference
router.post('/', async (req, res) => {
  const {
    wine_name, vintage, producer, country, style, colour,
    vivino_id,      // NEW: Vivino wine ID for accurate lookups
    vivino_url      // NEW: Direct link to Vivino page
  } = req.body;

  // ... existing insert logic with new fields
});
```

#### 2.3 Database Migration

```sql
-- data/migrations/016_vivino_reference.sql

-- Add Vivino reference to wines table
ALTER TABLE wines ADD COLUMN vivino_id INTEGER;
ALTER TABLE wines ADD COLUMN vivino_url TEXT;

-- Index for lookup
CREATE INDEX idx_wines_vivino_id ON wines(vivino_id);
```

---

### Part 3: Frontend Changes

#### 3.1 New Module: `public/js/bottles/wineConfirmation.js`

```javascript
/**
 * Wine Confirmation Modal
 * Shows search results and lets user confirm the correct wine.
 */

import * as api from '../api.js';
import { state as bottleState } from './state.js';

let confirmationModal = null;
let currentCallback = null;

/**
 * Show confirmation modal with wine search results.
 * @param {Object} parsedWine - Wine details from Claude parsing
 * @param {Function} onConfirm - Called with confirmed wine data
 * @param {Function} onSkip - Called if user skips confirmation
 */
export async function showWineConfirmation(parsedWine, onConfirm, onSkip) {
  currentCallback = { onConfirm, onSkip };

  // Show loading state
  renderConfirmationModal({ loading: true, parsedWine });

  try {
    // Search for matching wines
    const searchResults = await api.searchWines({
      wineName: parsedWine.wine_name,
      producer: extractProducer(parsedWine.wine_name),
      vintage: parsedWine.vintage,
      country: parsedWine.country,
      colour: parsedWine.colour
    });

    // Render results
    renderConfirmationModal({
      loading: false,
      parsedWine,
      matches: searchResults.matches,
      producerWines: searchResults.producerWines
    });

  } catch (error) {
    console.error('Wine search failed:', error);
    renderConfirmationModal({
      loading: false,
      parsedWine,
      error: 'Could not search for wines. You can still add manually.'
    });
  }
}

function renderConfirmationModal({ loading, parsedWine, matches, producerWines, error }) {
  if (!confirmationModal) {
    createModalElement();
  }

  const content = confirmationModal.querySelector('.modal-content');

  if (loading) {
    content.innerHTML = `
      <div class="confirmation-loading">
        <div class="spinner"></div>
        <p>Searching for "${parsedWine.wine_name}"...</p>
      </div>
    `;
    confirmationModal.classList.add('visible');
    return;
  }

  if (error) {
    content.innerHTML = `
      <div class="confirmation-error">
        <p>${error}</p>
        <div class="confirmation-actions">
          <button class="btn-primary" onclick="wineConfirmation.skipAndAdd()">
            Add wine without verification
          </button>
        </div>
      </div>
    `;
    return;
  }

  content.innerHTML = `
    <div class="confirmation-header">
      <h3>Confirm Wine Match</h3>
      <p class="parsed-info">
        Detected: <strong>${parsedWine.wine_name}</strong>
        ${parsedWine.vintage ? `(${parsedWine.vintage})` : ''}
      </p>
    </div>

    <div class="confirmation-matches">
      <h4>We found these wines:</h4>
      ${matches.length ? renderMatches(matches) : '<p class="no-matches">No exact matches found</p>'}
    </div>

    ${producerWines.length ? `
      <div class="confirmation-producer-wines">
        <h4>Other wines from this producer:</h4>
        <div class="producer-wines-grid">
          ${renderProducerWines(producerWines)}
        </div>
      </div>
    ` : ''}

    <div class="confirmation-actions">
      <button class="btn-secondary" onclick="wineConfirmation.editAndRetry()">
        Edit wine details
      </button>
      <button class="btn-tertiary" onclick="wineConfirmation.skipAndAdd()">
        Skip - add without ratings
      </button>
    </div>
  `;
}

function renderMatches(matches) {
  return matches.map((wine, index) => `
    <div class="match-card ${index === 0 ? 'top-match' : ''}" data-vivino-id="${wine.vivinoId}">
      <div class="match-image">
        <img src="${wine.imageUrl || '/images/wine-placeholder.png'}" alt="${wine.name}">
      </div>
      <div class="match-details">
        <h5>${wine.name}</h5>
        <p class="match-meta">
          ${wine.winery?.name || ''} · ${wine.region || ''} · ${wine.country || ''}
        </p>
        <p class="match-rating">
          <span class="rating-stars">${renderStars(wine.rating)}</span>
          <span class="rating-value">${wine.rating?.toFixed(1) || '-'}</span>
          <span class="rating-count">(${wine.ratingCount || 0} ratings)</span>
        </p>
        ${wine.grapeVariety ? `<p class="match-grape">${wine.grapeVariety}</p>` : ''}
      </div>
      <div class="match-action">
        <button class="btn-confirm" onclick="wineConfirmation.selectWine(${wine.vivinoId}, '${encodeURIComponent(JSON.stringify(wine))}')">
          ${index === 0 ? '✓ This is it' : 'Select'}
        </button>
      </div>
    </div>
  `).join('');
}

function renderProducerWines(wines) {
  return wines.slice(0, 6).map(wine => `
    <div class="producer-wine-card" onclick="wineConfirmation.selectWine(${wine.vivinoId}, '${encodeURIComponent(JSON.stringify(wine))}')">
      <img src="${wine.imageUrl || '/images/wine-placeholder.png'}" alt="${wine.name}">
      <p class="producer-wine-name">${wine.name}</p>
      <p class="producer-wine-rating">${wine.rating?.toFixed(1) || '-'} ★</p>
    </div>
  `).join('');
}

function renderStars(rating) {
  if (!rating) return '☆☆☆☆☆';
  const full = Math.floor(rating);
  const half = rating % 1 >= 0.5 ? 1 : 0;
  const empty = 5 - full - half;
  return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(empty);
}

// Public API
export function selectWine(vivinoId, wineJson) {
  const wine = JSON.parse(decodeURIComponent(wineJson));
  closeModal();
  currentCallback?.onConfirm({
    ...wine,
    vivinoId,
    confirmed: true
  });
}

export function skipAndAdd() {
  closeModal();
  currentCallback?.onSkip();
}

export function editAndRetry() {
  closeModal();
  // Return to form editing mode
  document.getElementById('wine-name')?.focus();
}

function createModalElement() {
  confirmationModal = document.createElement('div');
  confirmationModal.id = 'wine-confirmation-modal';
  confirmationModal.className = 'modal-overlay';
  confirmationModal.innerHTML = `
    <div class="modal wine-confirmation-modal">
      <button class="modal-close" onclick="wineConfirmation.closeModal()">×</button>
      <div class="modal-content"></div>
    </div>
  `;
  document.body.appendChild(confirmationModal);
}

export function closeModal() {
  confirmationModal?.classList.remove('visible');
}

// Expose to window for onclick handlers
window.wineConfirmation = { selectWine, skipAndAdd, editAndRetry, closeModal };
```

#### 3.2 Update `public/js/bottles/form.js`

Integrate confirmation step into form submission:

```javascript
// In handleBottleFormSubmit()

async function handleBottleFormSubmit(e) {
  e.preventDefault();

  const formData = collectFormData();

  // If this is a new wine (not editing), show confirmation
  if (!bottleState.editingWineId && !formData.skipConfirmation) {
    const { showWineConfirmation } = await import('./wineConfirmation.js');

    showWineConfirmation(
      formData,
      // onConfirm - user selected a wine
      async (confirmedWine) => {
        await saveWineWithConfirmation(formData, confirmedWine);
      },
      // onSkip - user wants to add without verification
      async () => {
        await saveWineWithoutConfirmation(formData);
      }
    );
    return;
  }

  // Editing existing wine - save directly
  await saveWineDirectly(formData);
}

async function saveWineWithConfirmation(formData, confirmedWine) {
  // Merge confirmed Vivino data with form data
  const wineData = {
    ...formData,
    wine_name: confirmedWine.name || formData.wine_name,
    vintage: confirmedWine.vintage || formData.vintage,
    country: confirmedWine.country || formData.country,
    style: confirmedWine.grapeVariety || formData.style,
    colour: confirmedWine.wineType || formData.colour,
    vivino_id: confirmedWine.vivinoId,
    vivino_url: confirmedWine.vivinoUrl,
    // Pre-populate Vivino rating
    vivino_rating: confirmedWine.rating
  };

  const wine = await api.createWine(wineData);
  await addBottlesToSlots(wine.id);

  // Fetch additional ratings (Decanter, etc.) using confirmed wine details
  api.fetchRatings(wine.id);

  showToast(`Added ${wineData.wine_name}`);
  closeModal();
  refreshData();
}

async function saveWineWithoutConfirmation(formData) {
  const wine = await api.createWine(formData);
  await addBottlesToSlots(wine.id);

  // Still try to fetch ratings, but may be less accurate
  api.fetchRatings(wine.id);

  showToast(`Added ${formData.wine_name} (without verification)`);
  closeModal();
  refreshData();
}
```

#### 3.3 Update `public/js/api.js`

Add new search endpoint:

```javascript
/**
 * Search for wines (Vivino) to confirm match.
 */
export async function searchWines({ wineName, producer, vintage, country, colour }) {
  const response = await fetch('/api/wine-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wineName, producer, vintage, country, colour })
  });

  if (!response.ok) throw new Error('Wine search failed');
  return response.json();
}
```

#### 3.4 CSS Styles: `public/css/styles.css`

```css
/* Wine Confirmation Modal */
.wine-confirmation-modal {
  max-width: 600px;
  max-height: 80vh;
  overflow-y: auto;
}

.confirmation-header {
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--border-color);
}

.confirmation-header h3 {
  margin: 0 0 0.5rem 0;
}

.parsed-info {
  color: var(--text-muted);
  font-size: 0.9rem;
}

/* Match Cards */
.match-card {
  display: flex;
  gap: 1rem;
  padding: 1rem;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  margin-bottom: 0.75rem;
  transition: border-color 0.2s;
}

.match-card:hover {
  border-color: var(--accent-color);
}

.match-card.top-match {
  border-color: var(--accent-color);
  background: rgba(var(--accent-rgb), 0.05);
}

.match-image {
  flex-shrink: 0;
  width: 60px;
}

.match-image img {
  width: 100%;
  height: auto;
  border-radius: 4px;
}

.match-details {
  flex: 1;
  min-width: 0;
}

.match-details h5 {
  margin: 0 0 0.25rem 0;
  font-size: 1rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.match-meta {
  font-size: 0.8rem;
  color: var(--text-muted);
  margin: 0 0 0.25rem 0;
}

.match-rating {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
}

.rating-stars {
  color: var(--gold);
}

.rating-value {
  font-weight: bold;
}

.rating-count {
  font-size: 0.8rem;
  color: var(--text-muted);
}

.match-action {
  flex-shrink: 0;
  display: flex;
  align-items: center;
}

.btn-confirm {
  background: var(--accent-color);
  color: white;
  border: none;
  padding: 0.5rem 1rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
}

.btn-confirm:hover {
  opacity: 0.9;
}

/* Producer Wines Grid */
.producer-wines-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
  gap: 0.75rem;
  margin-top: 0.75rem;
}

.producer-wine-card {
  text-align: center;
  cursor: pointer;
  padding: 0.5rem;
  border-radius: 8px;
  transition: background 0.2s;
}

.producer-wine-card:hover {
  background: rgba(var(--accent-rgb), 0.1);
}

.producer-wine-card img {
  width: 50px;
  height: auto;
  margin-bottom: 0.25rem;
}

.producer-wine-name {
  font-size: 0.75rem;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.producer-wine-rating {
  font-size: 0.7rem;
  color: var(--gold);
  margin: 0;
}

/* Confirmation Actions */
.confirmation-actions {
  display: flex;
  gap: 1rem;
  justify-content: flex-end;
  margin-top: 1.5rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border-color);
}

/* Loading State */
.confirmation-loading {
  text-align: center;
  padding: 3rem;
}

.confirmation-loading .spinner {
  width: 40px;
  height: 40px;
  border: 3px solid var(--border-color);
  border-top-color: var(--accent-color);
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto 1rem;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* No Matches */
.no-matches {
  color: var(--text-muted);
  text-align: center;
  padding: 1rem;
  background: rgba(var(--text-muted-rgb), 0.1);
  border-radius: 8px;
}
```

---

## Implementation Order

### Phase A: Backend Foundation
1. Create database migration for vivino_id column
2. Create `src/services/vivinoSearch.js`
3. Create `src/routes/wineSearch.js`
4. Register route in `src/server.js`
5. Test Vivino API access via Bright Data

### Phase B: Frontend Confirmation UI
1. Create `public/js/bottles/wineConfirmation.js`
2. Add CSS styles
3. Update `public/js/bottles/form.js` to integrate confirmation
4. Update `public/js/api.js` with new endpoint

### Phase C: Bright Data Scraper (if API unreliable)
1. Create scraper in Bright Data IDE
2. Test scraper with various wine searches
3. Update `vivinoSearch.js` to use scraper as fallback

### Phase D: Enhanced Features
1. Add "Change wine type" filter (like Vivino's Red/White/Sparkling tabs)
2. Add "Change vintage" selector
3. Save search history for faster lookups
4. Cache Vivino results in database

---

## Testing Plan

### Unit Tests
- `vivinoSearch.js` - Mock API responses, test parsing
- `wineConfirmation.js` - Test modal rendering, callbacks

### Integration Tests
- Full flow: Image upload → Parse → Search → Confirm → Save
- Edge cases: No matches found, API timeout, user cancels

### Manual Testing
- Test with Nederburg Private Bin Two Centuries 2019
- Test with obscure wines (no Vivino match)
- Test with wines having multiple vintages

---

## Success Metrics

| Metric | Before | Target |
|--------|--------|--------|
| Wrong wine matches | ~20% estimated | <5% |
| User confidence | No feedback | Confirmation step |
| Vivino data coverage | 0% | 80%+ of wines |
| Add wine time | ~5 sec | ~15 sec (with confirmation) |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Vivino blocks API access | Use Bright Data Web Unlocker + scraper fallback |
| Slow search response | Add loading indicator, cache results |
| No matches found | Allow skip, show manual entry option |
| Vivino API changes | Monitor, have scraper as backup |

---

## Files to Create/Modify

### New Files
- `src/services/vivinoSearch.js`
- `src/routes/wineSearch.js`
- `public/js/bottles/wineConfirmation.js`
- `data/migrations/016_vivino_reference.sql`

### Modified Files
- `src/server.js` - Register new route
- `public/js/bottles/form.js` - Add confirmation step
- `public/js/api.js` - Add searchWines function
- `public/css/styles.css` - Add confirmation modal styles

---

## Sources

- [Vivino API discovery](https://github.com/mmohamden/scraping-vivino-api-/blob/main/vivino%20api%20.py)
- [Bright Data Datasets Marketplace](https://brightdata.com/products/datasets)
- [Vivino Wine Data (Kaggle)](https://www.kaggle.com/datasets/joshuakalobbowles/vivino-wine-data)
