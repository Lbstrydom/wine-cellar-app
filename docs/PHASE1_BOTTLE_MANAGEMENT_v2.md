# Phase 1: Core Bottle Management (Modular Structure)

## Overview

Add drag-and-drop bottle movement, manual entry form for new bottles, and editing capabilities for existing bottles.

**Prerequisites**: Codebase has been refactored into modular structure per `AGENTS.md`.

## Features

1. **Drag and drop** - Move bottles between slots visually
2. **Add new bottles** - Click empty slot → form to enter wine details
3. **Edit existing bottles** - Click filled slot → modify details
4. **Multi-bottle add** - Add multiple bottles of same wine to consecutive slots
5. **Delete bottles** - Remove bottle from slot without logging consumption

---

## Files to Create/Modify

### Backend (src/routes/)
- `src/routes/wines.js` - Add search and styles endpoints
- `src/routes/bottles.js` - Already exists, verify endpoints
- `src/routes/slots.js` - Add remove endpoint

### Frontend (public/js/)
- `public/js/dragdrop.js` - **NEW** - Drag and drop functionality
- `public/js/bottles.js` - **NEW** - Bottle add/edit modal
- `public/js/api.js` - Add new API calls
- `public/js/grid.js` - Update slot creation for drag-drop
- `public/js/app.js` - Import and initialise new modules

### Frontend (public/)
- `public/index.html` - Add bottle modal HTML
- `public/css/styles.css` - Add form and drag-drop styles

---

## Backend Implementation

### 1. Update src/routes/wines.js

Add these endpoints after the existing ones:

```javascript
/**
 * Get distinct wine styles for autocomplete.
 * @route GET /api/wines/styles
 */
router.get('/styles', (req, res) => {
  const styles = db.prepare('SELECT DISTINCT style FROM wines WHERE style IS NOT NULL ORDER BY style').all();
  res.json(styles.map(s => s.style));
});

/**
 * Search wines by name.
 * @route GET /api/wines/search
 */
router.get('/search', (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) {
    return res.json([]);
  }
  
  const wines = db.prepare(`
    SELECT id, wine_name, vintage, style, colour, vivino_rating, price_eur
    FROM wines
    WHERE wine_name LIKE ?
    ORDER BY wine_name
    LIMIT 10
  `).all(`%${q}%`);
  
  res.json(wines);
});
```

**Important**: Move these BEFORE the `/:id` route, otherwise `/styles` and `/search` will be caught by `/:id`.

The final route order in wines.js should be:
1. `GET /` - list all
2. `GET /styles` - get styles
3. `GET /search` - search
4. `GET /:id` - get single
5. `POST /` - create
6. `PUT /:id` - update

### 2. Update src/routes/slots.js

Add remove endpoint (if not already present):

```javascript
/**
 * Remove bottle from slot without logging consumption.
 * @route DELETE /api/slots/:location/remove
 */
router.delete('/:location/remove', (req, res) => {
  const { location } = req.params;
  
  const slot = db.prepare('SELECT wine_id FROM slots WHERE location_code = ?').get(location);
  if (!slot) {
    return res.status(404).json({ error: 'Slot not found' });
  }
  if (!slot.wine_id) {
    return res.status(400).json({ error: 'Slot is already empty' });
  }
  
  db.prepare('UPDATE slots SET wine_id = NULL WHERE location_code = ?').run(location);
  
  res.json({ message: `Bottle removed from ${location}` });
});
```

### 3. Verify src/routes/bottles.js

Ensure the `/add` endpoint exists and handles multi-bottle additions:

```javascript
/**
 * @fileoverview Bottle management (add multiple, etc.).
 * @module routes/bottles
 */

import { Router } from 'express';
import db from '../db/index.js';

const router = Router();

/**
 * Add bottle(s) to consecutive slots.
 * @route POST /api/bottles/add
 */
router.post('/add', (req, res) => {
  const { wine_id, start_location, quantity = 1 } = req.body;
  
  if (!wine_id || !start_location) {
    return res.status(400).json({ error: 'wine_id and start_location required' });
  }
  
  // Verify wine exists
  const wine = db.prepare('SELECT id FROM wines WHERE id = ?').get(wine_id);
  if (!wine) {
    return res.status(404).json({ error: 'Wine not found' });
  }
  
  // Parse start location and find consecutive slots
  const isFridge = start_location.startsWith('F');
  let slots = [];
  
  if (isFridge) {
    const startNum = parseInt(start_location.substring(1));
    for (let i = 0; i < quantity; i++) {
      const slotNum = startNum + i;
      if (slotNum > 9) break;
      slots.push(`F${slotNum}`);
    }
  } else {
    const match = start_location.match(/R(\d+)C(\d+)/);
    if (!match) {
      return res.status(400).json({ error: 'Invalid location format' });
    }
    
    let row = parseInt(match[1]);
    let col = parseInt(match[2]);
    
    for (let i = 0; i < quantity; i++) {
      const maxCol = row === 1 ? 7 : 9;
      if (col > maxCol) {
        row++;
        col = 1;
        if (row > 19) break;
      }
      slots.push(`R${row}C${col}`);
      col++;
    }
  }
  
  // Check which slots are empty
  const placeholders = slots.map(() => '?').join(',');
  const existingSlots = db.prepare(`
    SELECT location_code, wine_id FROM slots WHERE location_code IN (${placeholders})
  `).all(...slots);
  
  const emptySlots = slots.filter(loc => {
    const slot = existingSlots.find(s => s.location_code === loc);
    return slot && !slot.wine_id;
  });
  
  if (emptySlots.length < quantity) {
    return res.status(400).json({ 
      error: `Not enough consecutive empty slots. Found ${emptySlots.length}, need ${quantity}.`
    });
  }
  
  // Fill slots
  const slotsToFill = emptySlots.slice(0, quantity);
  const updateStmt = db.prepare('UPDATE slots SET wine_id = ? WHERE location_code = ?');
  
  for (const loc of slotsToFill) {
    updateStmt.run(wine_id, loc);
  }
  
  res.json({
    message: `Added ${slotsToFill.length} bottle(s)`,
    locations: slotsToFill
  });
});

export default router;
```

---

## Frontend Implementation

### 1. Update public/js/api.js

Add these functions:

```javascript
/**
 * Get wine styles for autocomplete.
 * @returns {Promise<string[]>}
 */
export async function fetchWineStyles() {
  const res = await fetch(`${API_BASE}/api/wines/styles`);
  return res.json();
}

/**
 * Search wines by name.
 * @param {string} query - Search query
 * @returns {Promise<Array>}
 */
export async function searchWines(query) {
  if (!query || query.length < 2) return [];
  const res = await fetch(`${API_BASE}/api/wines/search?q=${encodeURIComponent(query)}`);
  return res.json();
}

/**
 * Create new wine.
 * @param {Object} wineData - Wine details
 * @returns {Promise<{id: number, message: string}>}
 */
export async function createWine(wineData) {
  const res = await fetch(`${API_BASE}/api/wines`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(wineData)
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to create wine');
  }
  return res.json();
}

/**
 * Update existing wine.
 * @param {number} id - Wine ID
 * @param {Object} wineData - Wine details
 * @returns {Promise<{message: string}>}
 */
export async function updateWine(id, wineData) {
  const res = await fetch(`${API_BASE}/api/wines/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(wineData)
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to update wine');
  }
  return res.json();
}

/**
 * Add bottles to slots.
 * @param {number} wineId - Wine ID
 * @param {string} startLocation - Starting slot
 * @param {number} quantity - Number of bottles
 * @returns {Promise<{message: string, locations: string[]}>}
 */
export async function addBottles(wineId, startLocation, quantity) {
  const res = await fetch(`${API_BASE}/api/bottles/add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wine_id: wineId, start_location: startLocation, quantity })
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to add bottles');
  }
  return res.json();
}

/**
 * Remove bottle from slot (no consumption log).
 * @param {string} location - Slot location
 * @returns {Promise<{message: string}>}
 */
export async function removeBottle(location) {
  const res = await fetch(`${API_BASE}/api/slots/${location}/remove`, {
    method: 'DELETE'
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to remove bottle');
  }
  return res.json();
}
```

### 2. Create public/js/dragdrop.js

```javascript
/**
 * @fileoverview Drag and drop functionality for bottle movement.
 * @module dragdrop
 */

import { moveBottle } from './api.js';
import { showToast } from './utils.js';
import { refreshData } from './app.js';

let draggedSlot = null;

/**
 * Setup drag and drop on all slots.
 */
export function setupDragAndDrop() {
  document.querySelectorAll('.slot').forEach(slot => {
    const hasWine = slot.dataset.wineId;
    
    if (hasWine) {
      // Filled slots are draggable
      slot.setAttribute('draggable', 'true');
      slot.classList.add('draggable');
      
      slot.addEventListener('dragstart', handleDragStart);
      slot.addEventListener('dragend', handleDragEnd);
    }
    
    // All slots can be drop targets
    slot.addEventListener('dragover', handleDragOver);
    slot.addEventListener('dragleave', handleDragLeave);
    slot.addEventListener('drop', handleDrop);
  });
}

/**
 * Handle drag start.
 * @param {DragEvent} e
 */
function handleDragStart(e) {
  draggedSlot = this;
  this.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', this.dataset.location);
  
  // Highlight valid drop targets
  document.querySelectorAll('.slot.empty').forEach(slot => {
    slot.classList.add('drag-target');
  });
}

/**
 * Handle drag end.
 * @param {DragEvent} e
 */
function handleDragEnd(e) {
  this.classList.remove('dragging');
  draggedSlot = null;
  
  // Remove all drag indicators
  document.querySelectorAll('.slot').forEach(slot => {
    slot.classList.remove('drag-target', 'drag-over', 'drag-over-invalid');
  });
}

/**
 * Handle drag over.
 * @param {DragEvent} e
 */
function handleDragOver(e) {
  e.preventDefault();
  
  if (!draggedSlot || this === draggedSlot) return;
  
  const isEmpty = this.classList.contains('empty');
  
  if (isEmpty) {
    e.dataTransfer.dropEffect = 'move';
    this.classList.add('drag-over');
    this.classList.remove('drag-over-invalid');
  } else {
    e.dataTransfer.dropEffect = 'none';
    this.classList.add('drag-over-invalid');
    this.classList.remove('drag-over');
  }
}

/**
 * Handle drag leave.
 * @param {DragEvent} e
 */
function handleDragLeave(e) {
  this.classList.remove('drag-over', 'drag-over-invalid');
}

/**
 * Handle drop.
 * @param {DragEvent} e
 */
async function handleDrop(e) {
  e.preventDefault();
  this.classList.remove('drag-over', 'drag-over-invalid');
  
  if (!draggedSlot || this === draggedSlot) return;
  
  const fromLocation = draggedSlot.dataset.location;
  const toLocation = this.dataset.location;
  
  // Only allow drop on empty slots
  if (!this.classList.contains('empty')) {
    showToast('Cannot drop on occupied slot');
    return;
  }
  
  try {
    const data = await moveBottle(fromLocation, toLocation);
    showToast(`Moved to ${toLocation}`);
    await refreshData();
  } catch (err) {
    showToast('Error: ' + err.message);
  }
}

/**
 * Check if drag is in progress.
 * @returns {boolean}
 */
export function isDragging() {
  return draggedSlot !== null;
}
```

### 3. Create public/js/bottles.js

```javascript
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
  removeBottle 
} from './api.js';
import { showToast } from './utils.js';
import { refreshData, state } from './app.js';
import { showWineModal } from './modals.js';
import { isDragging } from './dragdrop.js';

let bottleModalMode = 'add'; // 'add' or 'edit'
let editingLocation = null;
let editingWineId = null;
let wineStyles = [];
let searchTimeout = null;

/**
 * Initialise bottle management.
 */
export async function initBottles() {
  // Load wine styles for datalist
  try {
    wineStyles = await fetchWineStyles();
    const datalist = document.getElementById('style-list');
    if (datalist) {
      datalist.innerHTML = wineStyles.map(s => `<option value="${s}">`).join('');
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
}

/**
 * Handle slot click - show appropriate modal.
 * @param {HTMLElement} slotEl - Slot element
 */
export function handleSlotClick(slotEl) {
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
  
  document.getElementById('bottle-modal-title').textContent = 'Edit Bottle';
  document.getElementById('bottle-modal-subtitle').textContent = `Location: ${location}`;
  document.getElementById('bottle-save-btn').textContent = 'Save Changes';
  document.getElementById('bottle-delete-btn').style.display = 'block';
  document.getElementById('quantity-section').style.display = 'none';
  
  // Load wine details
  try {
    const wine = await fetchWine(wineId);
    document.getElementById('wine-name').value = wine.wine_name || '';
    document.getElementById('wine-vintage').value = wine.vintage || '';
    document.getElementById('wine-colour').value = wine.colour || 'white';
    document.getElementById('wine-style').value = wine.style || '';
    document.getElementById('wine-rating').value = wine.vivino_rating || '';
    document.getElementById('wine-price').value = wine.price_eur || '';
    document.getElementById('selected-wine-id').value = wineId;
  } catch (err) {
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
}

/**
 * Set bottle form mode (existing wine search vs new wine entry).
 * @param {string} mode - 'existing' or 'new'
 */
function setBottleFormMode(mode) {
  const existingBtn = document.querySelector('.toggle-btn[data-mode="existing"]');
  const newBtn = document.querySelector('.toggle-btn[data-mode="new"]');
  const existingSection = document.getElementById('existing-wine-section');
  const newSection = document.getElementById('new-wine-section');
  
  if (mode === 'existing') {
    existingBtn?.classList.add('active');
    newBtn?.classList.remove('active');
    if (existingSection) existingSection.style.display = 'block';
    if (newSection) newSection.style.display = 'none';
  } else {
    existingBtn?.classList.remove('active');
    newBtn?.classList.add('active');
    if (existingSection) existingSection.style.display = 'none';
    if (newSection) newSection.style.display = 'block';
  }
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
        <div class="search-result-item" data-wine-id="${wine.id}">
          <div class="search-result-name">${wine.wine_name} ${wine.vintage || 'NV'}</div>
          <div class="search-result-meta">${wine.style || ''} • ${wine.colour}</div>
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
  const quantity = parseInt(document.getElementById('bottle-quantity')?.value) || 1;
  
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
        price_eur: document.getElementById('wine-price').value || null
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
      const result = await addBottles(wineId, editingLocation, quantity);
      showToast(result.message);
    }
    
    closeBottleModal();
    await refreshData();
    
  } catch (err) {
    showToast('Error: ' + err.message);
  }
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
```

### 4. Update public/js/grid.js

Replace the entire file:

```javascript
/**
 * @fileoverview Cellar and fridge grid rendering.
 * @module grid
 */

import { shortenWineName } from './utils.js';
import { state } from './app.js';
import { setupDragAndDrop } from './dragdrop.js';
import { handleSlotClick } from './bottles.js';

/**
 * Render the fridge grid.
 */
export function renderFridge() {
  const grid = document.getElementById('fridge-grid');
  if (!grid || !state.layout) return;
  
  grid.innerHTML = '';
  
  state.layout.fridge.rows.forEach((row) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'fridge-row';
    
    row.slots.forEach(slot => {
      rowEl.appendChild(createSlotElement(slot));
    });
    
    grid.appendChild(rowEl);
  });
  
  setupInteractions();
}

/**
 * Render the cellar grid.
 */
export function renderCellar() {
  const grid = document.getElementById('cellar-grid');
  if (!grid || !state.layout) return;
  
  grid.innerHTML = '';
  
  state.layout.cellar.rows.forEach((row) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'cellar-row';
    
    const label = document.createElement('div');
    label.className = 'row-label';
    label.textContent = `R${row.row}`;
    rowEl.appendChild(label);
    
    row.slots.forEach(slot => {
      rowEl.appendChild(createSlotElement(slot));
    });
    
    grid.appendChild(rowEl);
  });
  
  setupInteractions();
}

/**
 * Setup click handlers and drag-drop after rendering.
 */
function setupInteractions() {
  // Setup drag and drop
  setupDragAndDrop();
  
  // Setup click handlers
  document.querySelectorAll('.slot').forEach(slot => {
    slot.addEventListener('click', () => handleSlotClick(slot));
  });
}

/**
 * Create a slot DOM element.
 * @param {Object} slot - Slot data
 * @returns {HTMLElement}
 */
export function createSlotElement(slot) {
  const el = document.createElement('div');
  el.className = 'slot';
  el.dataset.location = slot.location_code;
  el.dataset.slotId = slot.slot_id;
  
  if (slot.wine_id) {
    el.classList.add(slot.colour || 'white');
    el.dataset.wineId = slot.wine_id;
    
    if (slot.reduce_priority) {
      el.classList.add(`priority-${Math.min(slot.reduce_priority, 3)}`);
    }
    
    const shortName = shortenWineName(slot.wine_name);
    
    el.innerHTML = `
      <div class="slot-name">${shortName}</div>
      <div class="slot-vintage">${slot.vintage || 'NV'}</div>
      <div class="slot-loc">${slot.location_code}</div>
    `;
  } else {
    el.classList.add('empty');
    el.innerHTML = `<div class="slot-loc">${slot.location_code}</div>`;
  }
  
  return el;
}
```

### 5. Update public/js/app.js

Add imports and initialisation:

```javascript
/**
 * @fileoverview Main application initialisation and state.
 * @module app
 */

import { fetchLayout, fetchStats, fetchReduceNow, fetchWines } from './api.js';
import { renderFridge, renderCellar } from './grid.js';
import { initModals } from './modals.js';
import { initSommelier } from './sommelier.js';
import { initBottles } from './bottles.js';

/**
 * Application state.
 */
export const state = {
  layout: null,
  stats: null,
  currentView: 'grid'
};

/**
 * Load cellar layout.
 */
export async function loadLayout() {
  state.layout = await fetchLayout();
  renderFridge();
  renderCellar();
}

/**
 * Load statistics.
 */
export async function loadStats() {
  const stats = await fetchStats();
  state.stats = stats;
  document.getElementById('stat-total').textContent = stats.total_bottles;
  document.getElementById('stat-reduce').textContent = stats.reduce_now_count;
  document.getElementById('stat-empty').textContent = stats.empty_slots;
}

/**
 * Load reduce-now list.
 */
export async function loadReduceNow() {
  const list = await fetchReduceNow();
  renderReduceList(list);
}

/**
 * Load all wines.
 */
export async function loadWines() {
  const wines = await fetchWines();
  renderWineList(wines);
}

/**
 * Refresh all data (layout and stats).
 */
export async function refreshData() {
  await loadLayout();
  await loadStats();
}

/**
 * Render reduce-now list.
 * @param {Array} list - Reduce-now wines
 */
function renderReduceList(list) {
  const container = document.getElementById('reduce-list');
  if (!container) return;
  
  if (list.length === 0) {
    container.innerHTML = '<p style="color: var(--text-muted);">No wines in reduce-now list</p>';
    return;
  }
  
  container.innerHTML = list.map(item => `
    <div class="reduce-item p${item.priority}">
      <div class="reduce-priority">${item.priority}</div>
      <div class="reduce-info">
        <div class="reduce-name">${item.wine_name} ${item.vintage || 'NV'}</div>
        <div class="reduce-meta">${item.style} • ${item.bottle_count} bottle${item.bottle_count > 1 ? 's' : ''}</div>
        <div class="reduce-meta">${item.reduce_reason || ''}</div>
        <div class="reduce-locations">${item.locations || ''}</div>
      </div>
    </div>
  `).join('');
}

/**
 * Render wine list.
 * @param {Array} wines - All wines
 */
function renderWineList(wines) {
  const container = document.getElementById('wine-list');
  if (!container) return;
  
  const withBottles = wines.filter(w => w.bottle_count > 0);
  
  container.innerHTML = withBottles.map(wine => `
    <div class="wine-card ${wine.colour}">
      <div class="wine-count">${wine.bottle_count}</div>
      <div class="wine-details">
        <div class="wine-name">${wine.wine_name}</div>
        <div class="wine-meta">${wine.style} • ${wine.vintage || 'NV'}</div>
        <div class="wine-meta" style="color: var(--accent);">${wine.locations || ''}</div>
      </div>
    </div>
  `).join('');
}

/**
 * Switch view.
 * @param {string} viewName - View to switch to
 */
function switchView(viewName) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  
  document.getElementById(`view-${viewName}`)?.classList.add('active');
  document.querySelector(`[data-view="${viewName}"]`)?.classList.add('active');
  
  state.currentView = viewName;
  
  if (viewName === 'reduce') loadReduceNow();
  if (viewName === 'wines') loadWines();
}

/**
 * Initialise application.
 */
async function init() {
  // Setup navigation
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchView(tab.dataset.view));
  });
  
  // Initialise modules
  initModals();
  initSommelier();
  await initBottles();
  
  // Load initial data
  await loadLayout();
  await loadStats();
}

// Start app when DOM ready
document.addEventListener('DOMContentLoaded', init);
```

### 6. Update public/index.html

Add the bottle modal HTML (before the toast div):

```html
<!-- Add/Edit Bottle Modal -->
<div class="modal-overlay" id="bottle-modal-overlay">
  <div class="modal" id="bottle-modal" style="max-width: 500px;">
    <h2 id="bottle-modal-title">Add New Bottle</h2>
    <div class="modal-subtitle" id="bottle-modal-subtitle">Adding to slot: R1C1</div>
    
    <form id="bottle-form">
      <!-- Search existing wines or add new -->
      <div class="form-section">
        <div class="form-toggle">
          <button type="button" class="toggle-btn active" data-mode="existing">Existing Wine</button>
          <button type="button" class="toggle-btn" data-mode="new">New Wine</button>
        </div>
      </div>
      
      <!-- Existing wine search -->
      <div class="form-section" id="existing-wine-section">
        <label class="form-label">Search your wines:</label>
        <input type="text" id="wine-search" placeholder="Type to search..." autocomplete="off" />
        <div id="wine-search-results" class="search-results"></div>
        <input type="hidden" id="selected-wine-id" />
      </div>
      
      <!-- New wine form -->
      <div class="form-section" id="new-wine-section" style="display: none;">
        <div class="form-row">
          <div class="form-field">
            <label>Wine Name *</label>
            <input type="text" id="wine-name" />
          </div>
        </div>
        
        <div class="form-row">
          <div class="form-field">
            <label>Vintage</label>
            <input type="number" id="wine-vintage" min="1900" max="2030" placeholder="e.g., 2023" />
          </div>
          <div class="form-field">
            <label>Colour *</label>
            <select id="wine-colour">
              <option value="red">Red</option>
              <option value="white" selected>White</option>
              <option value="rose">Rosé</option>
              <option value="sparkling">Sparkling</option>
            </select>
          </div>
        </div>
        
        <div class="form-row">
          <div class="form-field">
            <label>Style</label>
            <input type="text" id="wine-style" placeholder="e.g., Sauvignon Blanc" list="style-list" />
            <datalist id="style-list"></datalist>
          </div>
        </div>
        
        <div class="form-row">
          <div class="form-field">
            <label>Rating</label>
            <input type="number" id="wine-rating" min="1" max="5" step="0.1" placeholder="e.g., 4.2" />
          </div>
          <div class="form-field">
            <label>Price (€)</label>
            <input type="number" id="wine-price" min="0" step="0.01" placeholder="e.g., 12.99" />
          </div>
        </div>
      </div>
      
      <!-- Quantity (for adding) -->
      <div class="form-section" id="quantity-section">
        <div class="form-row">
          <div class="form-field">
            <label>Quantity</label>
            <input type="number" id="bottle-quantity" min="1" max="20" value="1" />
            <span class="form-hint">Will fill consecutive slots from selected position</span>
          </div>
        </div>
      </div>
      
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary" id="bottle-save-btn">Add Bottle</button>
        <button type="button" class="btn btn-secondary" id="bottle-cancel-btn">Cancel</button>
        <button type="button" class="btn btn-danger" id="bottle-delete-btn" style="display: none; margin-left: auto;">Remove</button>
      </div>
    </form>
  </div>
</div>
```

### 7. Update public/css/styles.css

Add these styles at the end of the file:

```css
/* ============================================================
   DRAG AND DROP
   ============================================================ */

.slot.draggable {
  cursor: grab;
}

.slot.draggable:active {
  cursor: grabbing;
}

.slot.dragging {
  opacity: 0.5;
  transform: scale(1.05);
  z-index: 100;
}

.slot.drag-over {
  background: var(--accent) !important;
  opacity: 0.7;
  border: 2px dashed var(--text);
}

.slot.drag-over-invalid {
  background: var(--red-wine) !important;
  opacity: 0.5;
}

.slot.empty.drag-target {
  border: 2px dashed var(--accent);
  background: rgba(139, 115, 85, 0.2);
}

/* ============================================================
   BOTTLE FORM
   ============================================================ */

.form-section {
  margin-bottom: 1.25rem;
}

.form-toggle {
  display: flex;
  gap: 0;
  background: var(--bg-slot);
  border-radius: 8px;
  padding: 4px;
}

.toggle-btn {
  flex: 1;
  padding: 0.5rem 1rem;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: 6px;
  font-size: 0.9rem;
  transition: all 0.2s;
}

.toggle-btn.active {
  background: var(--accent);
  color: white;
}

.toggle-btn:hover:not(.active) {
  background: var(--bg-slot-hover);
}

.form-row {
  display: flex;
  gap: 1rem;
  margin-bottom: 1rem;
}

.form-field {
  flex: 1;
}

.form-field label,
.form-label {
  display: block;
  font-size: 0.75rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 0.4rem;
}

.form-field input,
.form-field select,
#wine-search {
  width: 100%;
  padding: 0.6rem 0.8rem;
  background: var(--bg-slot);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 0.95rem;
}

.form-field input:focus,
.form-field select:focus,
#wine-search:focus {
  outline: none;
  border-color: var(--accent);
}

.form-hint {
  display: block;
  font-size: 0.75rem;
  color: var(--text-muted);
  margin-top: 0.3rem;
}

/* Search Results */
.search-results {
  max-height: 200px;
  overflow-y: auto;
  background: var(--bg-slot);
  border: 1px solid var(--border);
  border-radius: 6px;
  margin-top: 0.5rem;
  display: none;
}

.search-results.active {
  display: block;
}

.search-result-item {
  padding: 0.6rem 0.8rem;
  cursor: pointer;
  border-bottom: 1px solid var(--border);
  transition: background 0.15s;
}

.search-result-item:last-child {
  border-bottom: none;
}

.search-result-item:hover {
  background: var(--bg-slot-hover);
}

.search-result-item.selected {
  background: var(--accent);
}

.search-result-name {
  font-weight: 500;
}

.search-result-meta {
  font-size: 0.8rem;
  color: var(--text-muted);
  margin-top: 0.2rem;
}

/* Modal action buttons */
#bottle-modal .modal-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

/* Responsive */
@media (max-width: 500px) {
  .form-row {
    flex-direction: column;
    gap: 0;
  }
  
  .form-field {
    margin-bottom: 1rem;
  }
}
```

---

## Verification Checklist

After implementation, test:

### Drag and Drop
- [ ] Drag filled slot → visual feedback (opacity, cursor)
- [ ] Drag over empty slot → highlights green
- [ ] Drag over filled slot → highlights red
- [ ] Drop on empty slot → bottle moves
- [ ] Drop on filled slot → shows error toast
- [ ] Drag cancelled → all highlighting removed

### Add New Bottle
- [ ] Click empty slot → modal appears
- [ ] "Existing Wine" tab → search works
- [ ] Select from search → wine ID stored
- [ ] "New Wine" tab → form fields appear
- [ ] Fill form → submit → bottle added
- [ ] Quantity > 1 → fills consecutive slots
- [ ] Cancel → modal closes, no changes

### Edit Existing Bottle
- [ ] Click filled slot → wine modal appears (existing)
- [ ] Add "Edit" button to wine modal if needed
- [ ] Or: long-press/right-click to edit (alternative)

### Delete Bottle
- [ ] "Remove" button visible in edit mode
- [ ] Confirm dialog appears
- [ ] Bottle removed from slot
- [ ] Not logged as consumption

---

## Deployment

After testing locally:

```bash
# Commit
git add .
git commit -m "feat: add drag-drop and bottle management"
git push

# Deploy to Synology
ssh Lstrydom@100.121.86.46
cd ~/Apps/wine-cellar-app
# Upload new files or git pull
sudo docker-compose down
sudo docker-compose up -d --build
```

---

## Notes

- The wine modal (for viewing details and drinking) remains separate from the bottle modal (for adding/editing)
- Click on filled slot → wine detail modal (drink button)
- Click on empty slot → add bottle modal
- To edit a wine's details, you could add an "Edit" button to the wine detail modal that opens the bottle modal in edit mode
