# Phase 5: Refinements & Improvements

## Overview

A collection of smaller enhancements to improve usability based on real-world usage:

1. **"Add Another" button** - Quick duplicate from wine modal
2. **Edit wine button** - Edit wine details from wine modal
3. **Personal ratings** - Your own score + tasting notes
4. **Consumption history view** - Browse what you've drunk with ratings
5. **Drink window** - Ready year, peak year, decline year fields

**Prerequisites**: 
- Phase 1-4 complete
- Codebase follows AGENTS.md conventions

---

## Feature 1: "Add Another" Button

Add a button to the wine detail modal that lets you quickly add another bottle of the same wine to an empty slot.

### Backend

No changes needed - uses existing `/api/bottles/add` endpoint.

### Frontend

#### Update public/js/modals.js

Add button to wine modal actions:

```javascript
// In the wine modal HTML (either in modals.js or index.html)
// Add this button alongside existing buttons:
<button class="btn btn-secondary" id="btn-add-another">+ Add Another</button>
```

Add handler:

```javascript
/**
 * Handle "Add Another" button - opens slot picker to add same wine.
 */
async function handleAddAnother() {
  if (!currentSlot || !currentSlot.wine_id) return;
  
  const wineId = currentSlot.wine_id;
  const wineName = currentSlot.wine_name;
  
  closeWineModal();
  
  // Show slot picker modal
  showSlotPickerModal(wineId, wineName);
}

// Add event listener in initModals()
document.getElementById('btn-add-another')?.addEventListener('click', handleAddAnother);
```

#### Create slot picker modal in public/js/bottles.js

```javascript
/**
 * Show modal to pick empty slot for adding a wine.
 * @param {number} wineId - Wine to add
 * @param {string} wineName - Wine name for display
 */
export function showSlotPickerModal(wineId, wineName) {
  // Store for later use
  window.pendingAddWineId = wineId;
  
  // Update modal content
  document.getElementById('slot-picker-title').textContent = `Add: ${wineName}`;
  document.getElementById('slot-picker-instruction').textContent = 'Click an empty slot to add the bottle';
  
  // Enable slot picker mode
  document.body.classList.add('slot-picker-mode');
  
  // Show overlay
  document.getElementById('slot-picker-overlay').classList.add('active');
  
  // Highlight empty slots
  document.querySelectorAll('.slot.empty').forEach(slot => {
    slot.classList.add('picker-target');
  });
}

/**
 * Handle slot click in picker mode.
 * @param {HTMLElement} slotEl - Clicked slot
 */
export async function handleSlotPickerClick(slotEl) {
  if (!document.body.classList.contains('slot-picker-mode')) return false;
  
  const location = slotEl.dataset.location;
  const wineId = window.pendingAddWineId;
  
  if (!slotEl.classList.contains('empty')) {
    showToast('Please select an empty slot');
    return true; // Handled, but invalid
  }
  
  try {
    await addBottles(wineId, location, 1);
    showToast(`Added to ${location}`);
    closeSlotPickerModal();
    await refreshData();
  } catch (err) {
    showToast('Error: ' + err.message);
  }
  
  return true; // Handled
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
  window.pendingAddWineId = null;
}
```

#### Update handleSlotClick in public/js/bottles.js

```javascript
export function handleSlotClick(slotEl) {
  // Check if in slot picker mode first
  if (document.body.classList.contains('slot-picker-mode')) {
    handleSlotPickerClick(slotEl);
    return;
  }
  
  // ... rest of existing code
}
```

#### Add to public/index.html

```html
<!-- Slot Picker Overlay -->
<div class="slot-picker-overlay" id="slot-picker-overlay">
  <div class="slot-picker-header">
    <h3 id="slot-picker-title">Add Bottle</h3>
    <p id="slot-picker-instruction">Click an empty slot</p>
    <button class="btn btn-secondary" id="cancel-slot-picker">Cancel</button>
  </div>
</div>
```

#### Add to public/css/styles.css

```css
/* Slot Picker Mode */
.slot-picker-overlay {
  display: none;
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  padding: 1rem;
  background: var(--bg-dark);
  border-bottom: 2px solid var(--accent);
  z-index: 100;
  text-align: center;
}

.slot-picker-overlay.active {
  display: block;
}

.slot-picker-header h3 {
  margin: 0 0 0.25rem 0;
  color: var(--accent);
}

.slot-picker-header p {
  margin: 0 0 0.5rem 0;
  color: var(--text-muted);
  font-size: 0.9rem;
}

body.slot-picker-mode .slot.empty.picker-target {
  border: 2px dashed var(--accent);
  background: rgba(139, 115, 85, 0.2);
  cursor: pointer;
}

body.slot-picker-mode .slot.empty.picker-target:hover {
  background: rgba(139, 115, 85, 0.4);
  transform: scale(1.05);
}

body.slot-picker-mode .slot:not(.empty) {
  opacity: 0.4;
  pointer-events: none;
}
```

---

## Feature 2: Edit Wine Button

Add ability to edit wine details (name, vintage, style, etc.) from the wine modal.

### Frontend

#### Update wine modal in public/index.html

Add edit button to modal actions:

```html
<div class="modal-actions">
  <button class="btn btn-primary" id="btn-drink">🍷 Drink This</button>
  <button class="btn btn-secondary" id="btn-add-another">+ Add Another</button>
  <button class="btn btn-secondary" id="btn-edit-wine">✎ Edit</button>
  <button class="btn btn-secondary" id="btn-close">Close</button>
</div>
```

#### Update public/js/modals.js

```javascript
/**
 * Handle edit wine button.
 */
function handleEditWine() {
  if (!currentSlot || !currentSlot.wine_id) return;
  
  const location = currentSlot.location_code;
  const wineId = currentSlot.wine_id;
  
  closeWineModal();
  
  // Open bottle modal in edit mode
  showEditBottleModal(location, wineId);
}

// Add event listener in initModals()
document.getElementById('btn-edit-wine')?.addEventListener('click', handleEditWine);
```

#### Verify showEditBottleModal exists in public/js/bottles.js

This should already exist from Phase 1. Ensure it:
1. Opens the bottle modal
2. Fetches wine details via API
3. Populates the form fields
4. Sets mode to 'edit'
5. Shows "Save Changes" button instead of "Add Bottle"

If not fully implemented, add:

```javascript
/**
 * Show modal for editing existing wine details.
 * @param {string} location - Slot location
 * @param {number} wineId - Wine ID
 */
export async function showEditBottleModal(location, wineId) {
  bottleModalMode = 'edit';
  editingLocation = location;
  editingWineId = wineId;
  
  // Update modal UI
  document.getElementById('bottle-modal-title').textContent = 'Edit Wine';
  document.getElementById('bottle-modal-subtitle').textContent = `Location: ${location}`;
  document.getElementById('bottle-save-btn').textContent = 'Save Changes';
  document.getElementById('bottle-delete-btn').style.display = 'block';
  document.getElementById('quantity-section').style.display = 'none';
  
  // Hide toggle buttons - go straight to form
  document.querySelector('.form-toggle')?.style.display = 'none';
  
  // Load wine details
  try {
    const wine = await fetchWine(wineId);
    
    // Populate form
    document.getElementById('wine-name').value = wine.wine_name || '';
    document.getElementById('wine-vintage').value = wine.vintage || '';
    document.getElementById('wine-colour').value = wine.colour || 'white';
    document.getElementById('wine-style').value = wine.style || '';
    document.getElementById('wine-rating').value = wine.vivino_rating || '';
    document.getElementById('wine-price').value = wine.price_eur || '';
    document.getElementById('wine-country').value = wine.country || '';
    document.getElementById('selected-wine-id').value = wineId;
    
    // Show new wine section (the form fields)
    setBottleFormMode('new');
    
  } catch (err) {
    showToast('Failed to load wine details');
    return;
  }
  
  document.getElementById('bottle-modal-overlay').classList.add('active');
}
```

#### Update form submit handler to handle edit mode

In `handleBottleFormSubmit`:

```javascript
if (bottleModalMode === 'edit' && editingWineId) {
  // Update existing wine
  const wineData = {
    wine_name: document.getElementById('wine-name').value.trim(),
    vintage: document.getElementById('wine-vintage').value || null,
    colour: document.getElementById('wine-colour').value,
    style: document.getElementById('wine-style').value.trim() || null,
    vivino_rating: document.getElementById('wine-rating').value || null,
    price_eur: document.getElementById('wine-price').value || null,
    country: document.getElementById('wine-country').value.trim() || null
  };
  
  await updateWine(editingWineId, wineData);
  showToast('Wine updated');
  closeBottleModal();
  await refreshData();
  return;
}
```

---

## Feature 3: Personal Ratings

Add your own rating and tasting notes to wines, separate from external ratings.

### Backend

#### Database migration

Add to `data/migrations/002_personal_ratings.sql`:

```sql
-- Personal ratings on wines
ALTER TABLE wines ADD COLUMN personal_rating REAL;        -- 0-5 scale, half increments
ALTER TABLE wines ADD COLUMN personal_notes TEXT;         -- Tasting notes
ALTER TABLE wines ADD COLUMN personal_rated_at DATETIME;  -- When you rated it
```

Run migration in `src/db/index.js`.

#### Update src/routes/wines.js

Add endpoint for personal rating:

```javascript
/**
 * Update personal rating for a wine.
 * @route PUT /api/wines/:id/personal-rating
 */
router.put('/:id/personal-rating', (req, res) => {
  const { id } = req.params;
  const { rating, notes } = req.body;
  
  db.prepare(`
    UPDATE wines 
    SET personal_rating = ?, personal_notes = ?, personal_rated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(rating || null, notes || null, id);
  
  res.json({ message: 'Personal rating saved' });
});

/**
 * Get personal rating for a wine.
 * @route GET /api/wines/:id/personal-rating
 */
router.get('/:id/personal-rating', (req, res) => {
  const { id } = req.params;
  
  const wine = db.prepare(`
    SELECT personal_rating, personal_notes, personal_rated_at 
    FROM wines WHERE id = ?
  `).get(id);
  
  if (!wine) {
    return res.status(404).json({ error: 'Wine not found' });
  }
  
  res.json(wine);
});
```

### Frontend

#### Update public/js/api.js

```javascript
/**
 * Update personal rating for a wine.
 * @param {number} wineId
 * @param {number} rating - 0-5
 * @param {string} notes - Tasting notes
 * @returns {Promise<Object>}
 */
export async function updatePersonalRating(wineId, rating, notes) {
  const res = await fetch(`${API_BASE}/api/wines/${wineId}/personal-rating`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rating, notes })
  });
  return res.json();
}
```

#### Add personal rating section to wine modal

In `public/index.html`, add to wine modal:

```html
<div class="modal-field personal-rating-section">
  <label>My Rating</label>
  <div class="personal-rating-input">
    <select id="modal-personal-rating">
      <option value="">Not rated</option>
      <option value="5">★★★★★ (5) Exceptional</option>
      <option value="4.5">★★★★½ (4.5) Excellent</option>
      <option value="4">★★★★ (4) Very Good</option>
      <option value="3.5">★★★½ (3.5) Good</option>
      <option value="3">★★★ (3) Acceptable</option>
      <option value="2.5">★★½ (2.5) Below Average</option>
      <option value="2">★★ (2) Poor</option>
      <option value="1">★ (1) Avoid</option>
    </select>
    <button class="btn btn-small btn-secondary" id="save-personal-rating">Save</button>
  </div>
  <textarea id="modal-personal-notes" placeholder="My tasting notes..." rows="2"></textarea>
</div>
```

#### Update public/js/modals.js

Load and save personal rating:

```javascript
/**
 * Load personal rating into modal.
 */
async function loadPersonalRating(wineId) {
  try {
    const data = await fetch(`/api/wines/${wineId}/personal-rating`).then(r => r.json());
    document.getElementById('modal-personal-rating').value = data.personal_rating || '';
    document.getElementById('modal-personal-notes').value = data.personal_notes || '';
  } catch (err) {
    console.error('Failed to load personal rating:', err);
  }
}

/**
 * Save personal rating.
 */
async function savePersonalRating() {
  if (!currentSlot?.wine_id) return;
  
  const rating = document.getElementById('modal-personal-rating').value || null;
  const notes = document.getElementById('modal-personal-notes').value || null;
  
  try {
    await updatePersonalRating(currentSlot.wine_id, rating, notes);
    showToast('Rating saved');
  } catch (err) {
    showToast('Error saving rating');
  }
}

// Call loadPersonalRating in showWineModal
// Add event listener for save button
document.getElementById('save-personal-rating')?.addEventListener('click', savePersonalRating);
```

#### Add styles to public/css/styles.css

```css
/* Personal Rating */
.personal-rating-section {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border);
}

.personal-rating-input {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.personal-rating-input select {
  flex: 1;
  padding: 0.5rem;
  background: var(--bg-slot);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
}

#modal-personal-notes {
  width: 100%;
  padding: 0.5rem;
  background: var(--bg-slot);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-family: inherit;
  font-size: 0.9rem;
  resize: vertical;
}
```

---

## Feature 4: Consumption History View

Add a new tab to view wines you've drunk with their ratings.

### Backend

#### Update src/routes/stats.js

Enhance consumption endpoint:

```javascript
/**
 * Get consumption history with wine details and ratings.
 * @route GET /api/consumption
 */
router.get('/consumption', (req, res) => {
  const { limit = 50, offset = 0 } = req.query;
  
  const log = db.prepare(`
    SELECT 
      cl.id,
      cl.wine_id,
      cl.slot_location,
      cl.consumed_at,
      cl.occasion,
      cl.pairing_dish,
      cl.rating as consumption_rating,
      cl.notes as consumption_notes,
      w.wine_name,
      w.vintage,
      w.style,
      w.colour,
      w.country,
      w.personal_rating,
      w.personal_notes,
      w.purchase_score,
      w.purchase_stars
    FROM consumption_log cl
    JOIN wines w ON w.id = cl.wine_id
    ORDER BY cl.consumed_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);
  
  const total = db.prepare('SELECT COUNT(*) as count FROM consumption_log').get();
  
  res.json({
    items: log,
    total: total.count,
    limit,
    offset
  });
});
```

### Frontend

#### Add History tab to public/index.html

In the nav tabs:

```html
<nav class="tabs">
  <div class="tab active" data-view="grid">Cellar Grid</div>
  <div class="tab" data-view="reduce">Reduce Now</div>
  <div class="tab" data-view="wines">All Wines</div>
  <div class="tab" data-view="history">History</div>
  <div class="tab" data-view="pairing">Find Pairing</div>
</nav>
```

Add history view:

```html
<!-- History View -->
<div class="view" id="view-history">
  <h2 style="margin-bottom: 1rem;">Consumption History</h2>
  <div class="history-list" id="history-list"></div>
</div>
```

#### Update public/js/app.js

Add history loading:

```javascript
/**
 * Load consumption history.
 */
export async function loadHistory() {
  const res = await fetch('/api/consumption');
  const data = await res.json();
  renderHistoryList(data.items);
}

/**
 * Render history list.
 * @param {Array} items - Consumption log items
 */
function renderHistoryList(items) {
  const container = document.getElementById('history-list');
  if (!container) return;
  
  if (items.length === 0) {
    container.innerHTML = '<p style="color: var(--text-muted);">No wines consumed yet</p>';
    return;
  }
  
  container.innerHTML = items.map(item => {
    const date = new Date(item.consumed_at).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
    
    const stars = item.consumption_rating 
      ? '★'.repeat(Math.floor(item.consumption_rating)) + '☆'.repeat(5 - Math.floor(item.consumption_rating))
      : '';
    
    return `
      <div class="history-item ${item.colour || ''}">
        <div class="history-date">${date}</div>
        <div class="history-details">
          <div class="history-wine">${item.wine_name} ${item.vintage || 'NV'}</div>
          <div class="history-meta">${item.style || ''} • ${item.country || ''}</div>
          ${item.occasion ? `<div class="history-occasion">📍 ${item.occasion}</div>` : ''}
          ${item.pairing_dish ? `<div class="history-pairing">🍽️ ${item.pairing_dish}</div>` : ''}
          ${item.consumption_notes ? `<div class="history-notes">${item.consumption_notes}</div>` : ''}
        </div>
        <div class="history-rating">
          ${stars ? `<span class="history-stars">${stars}</span>` : ''}
          ${item.purchase_stars ? `<span class="history-external">Pro: ${item.purchase_stars}★</span>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// Add to switchView function
if (viewName === 'history') loadHistory();
```

#### Add styles to public/css/styles.css

```css
/* History View */
.history-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.history-item {
  display: flex;
  gap: 1rem;
  padding: 1rem;
  background: var(--bg-slot);
  border-radius: 8px;
  border-left: 4px solid var(--text-muted);
}

.history-item.red {
  border-left-color: var(--red-wine);
}

.history-item.white {
  border-left-color: var(--white-wine);
}

.history-item.rose {
  border-left-color: var(--rose-wine);
}

.history-date {
  min-width: 80px;
  font-size: 0.85rem;
  color: var(--text-muted);
}

.history-details {
  flex: 1;
}

.history-wine {
  font-weight: 600;
  margin-bottom: 0.25rem;
}

.history-meta {
  font-size: 0.85rem;
  color: var(--text-muted);
}

.history-occasion,
.history-pairing {
  font-size: 0.85rem;
  margin-top: 0.25rem;
}

.history-notes {
  font-size: 0.85rem;
  font-style: italic;
  color: var(--text-muted);
  margin-top: 0.5rem;
}

.history-rating {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.25rem;
}

.history-stars {
  color: var(--accent);
}

.history-external {
  font-size: 0.75rem;
  color: var(--text-muted);
}
```

---

## Feature 5: Drink Window

Add fields to track when a wine is ready to drink, at its peak, and when it will decline.

### Backend

#### Database migration

Add to `data/migrations/002_personal_ratings.sql`:

```sql
-- Drink window fields
ALTER TABLE wines ADD COLUMN drink_from INTEGER;    -- Year wine is ready
ALTER TABLE wines ADD COLUMN drink_peak INTEGER;    -- Year wine is at peak
ALTER TABLE wines ADD COLUMN drink_until INTEGER;   -- Year wine will decline
```

#### Update src/routes/wines.js

Include drink window in update:

```javascript
/**
 * Update wine including drink window.
 * @route PUT /api/wines/:id
 */
router.put('/:id', (req, res) => {
  const { 
    style, colour, wine_name, vintage, vivino_rating, price_eur, country,
    drink_from, drink_peak, drink_until
  } = req.body;
  
  db.prepare(`
    UPDATE wines 
    SET style = ?, colour = ?, wine_name = ?, vintage = ?, 
        vivino_rating = ?, price_eur = ?, country = ?,
        drink_from = ?, drink_peak = ?, drink_until = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    style, colour, wine_name, vintage || null, 
    vivino_rating || null, price_eur || null, country || null,
    drink_from || null, drink_peak || null, drink_until || null,
    req.params.id
  );
  
  res.json({ message: 'Wine updated' });
});
```

### Frontend

#### Add drink window to bottle form

In the new wine section of the bottle modal:

```html
<div class="form-row">
  <div class="form-field">
    <label>Drink From</label>
    <input type="number" id="wine-drink-from" min="2000" max="2100" placeholder="e.g., 2025" />
  </div>
  <div class="form-field">
    <label>Peak</label>
    <input type="number" id="wine-drink-peak" min="2000" max="2100" placeholder="e.g., 2028" />
  </div>
  <div class="form-field">
    <label>Drink Until</label>
    <input type="number" id="wine-drink-until" min="2000" max="2100" placeholder="e.g., 2032" />
  </div>
</div>
```

#### Show drink window status on wine cards

In `public/js/grid.js`, update `createSlotElement`:

```javascript
// Add drink window indicator
if (slot.drink_until) {
  const currentYear = new Date().getFullYear();
  
  if (currentYear > slot.drink_until) {
    el.classList.add('past-peak');
  } else if (slot.drink_peak && currentYear >= slot.drink_peak) {
    el.classList.add('at-peak');
  } else if (slot.drink_from && currentYear >= slot.drink_from) {
    el.classList.add('ready');
  } else {
    el.classList.add('too-young');
  }
}
```

#### Add drink window styles

```css
/* Drink Window Indicators */
.slot.at-peak::after {
  content: '🌟';
  position: absolute;
  top: 2px;
  right: 2px;
  font-size: 0.7rem;
}

.slot.past-peak::after {
  content: '⚠️';
  position: absolute;
  top: 2px;
  right: 2px;
  font-size: 0.7rem;
}

.slot.too-young {
  opacity: 0.7;
}

.slot.too-young::after {
  content: '💤';
  position: absolute;
  top: 2px;
  right: 2px;
  font-size: 0.7rem;
}
```

#### Update layout endpoint to include drink window

In `src/routes/stats.js`, add to the SELECT:

```sql
w.drink_from,
w.drink_peak,
w.drink_until
```

---

## Files Summary

### Create

| File | Purpose |
|------|---------|
| `data/migrations/002_personal_ratings.sql` | Personal rating + drink window columns |

### Modify

| File | Changes |
|------|---------|
| `src/db/index.js` | Run new migration |
| `src/routes/wines.js` | Personal rating endpoints, drink window in update |
| `src/routes/stats.js` | Enhanced consumption endpoint, drink window in layout |
| `public/js/modals.js` | Add Another, Edit Wine, Personal Rating |
| `public/js/bottles.js` | Slot picker, edit mode improvements |
| `public/js/app.js` | History view loading |
| `public/js/grid.js` | Drink window indicators |
| `public/js/api.js` | Personal rating API call |
| `public/index.html` | History tab, personal rating section, drink window fields, slot picker |
| `public/css/styles.css` | All new styles |

---

## Testing

### Add Another
- [ ] Click wine → "Add Another" → select empty slot → bottle added
- [ ] Cancel picker → returns to normal mode

### Edit Wine
- [ ] Click wine → "Edit" → form shows with current values
- [ ] Change values → Save → wine updated
- [ ] All bottles of same wine show updated info

### Personal Rating
- [ ] Rate a wine → rating saved
- [ ] Add notes → notes saved
- [ ] Re-open modal → rating/notes displayed

### Consumption History
- [ ] Drink a wine (with occasion/notes)
- [ ] History tab shows consumed wines
- [ ] Date, occasion, pairing displayed

### Drink Window
- [ ] Add drink window to wine
- [ ] Wine shows appropriate indicator (💤 too young, 🌟 at peak, ⚠️ past peak)

---

## Deployment

```bash
git add .
git commit -m "feat: add refinements - add another, edit, personal ratings, history, drink window (Phase 5)"
git push

# Synology
ssh Lstrydom@100.121.86.46
cd ~/Apps/wine-cellar-app
sudo docker compose -f docker-compose.synology.yml pull
sudo docker compose -f docker-compose.synology.yml up -d
```
