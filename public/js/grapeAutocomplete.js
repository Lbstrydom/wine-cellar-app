/**
 * @fileoverview Searchable grape autocomplete dropdown component.
 * Multi-tag input with colour-category filter tabs, browseable list with
 * letter section headers, and colour-dot badges for each grape.
 * Supports individual grapes and named blends (e.g. "GSM", "Cape Blend").
 * @module grapeAutocomplete
 */

import {
  GRAPE_VARIETIES, WHITE_GRAPES, RED_GRAPES,
  COMMON_BLENDS, GRAPE_COLOUR_MAP, FILTER_CATEGORIES,
} from './grapeData.js';
import { escapeHtml } from './utils.js';

/** Max results in search mode (typing); browse mode has no limit */
const MAX_SEARCH_RESULTS = 15;

/**
 * Initialize the grape autocomplete on an existing text input.
 * Transforms the plain input into a multi-tag + filterable dropdown.
 * @param {string} inputId - ID of the target <input> element
 * @returns {{ destroy: Function, getValue: Function, setValue: Function } | null}
 */
export function initGrapeAutocomplete(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return null;

  // Prevent double-init
  if (input.dataset.grapeAcInit === '1') return null;
  input.dataset.grapeAcInit = '1';

  // ── DOM ──
  const wrapper = document.createElement('div');
  wrapper.className = 'grape-ac-wrapper';

  const tagContainer = document.createElement('div');
  tagContainer.className = 'grape-ac-tags';

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'grape-ac-search';
  searchInput.placeholder = 'Search grapes or blends…';
  searchInput.autocomplete = 'off';

  const dropdown = document.createElement('div');
  dropdown.className = 'grape-ac-dropdown';
  dropdown.style.display = 'none';

  // Filter tabs bar (inside dropdown, sticky at top)
  const filterBar = document.createElement('div');
  filterBar.className = 'grape-ac-filters';
  for (const cat of FILTER_CATEGORIES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'grape-ac-filter-btn' + (cat.key === 'all' ? ' active' : '');
    btn.textContent = cat.label;
    btn.dataset.filter = cat.key;
    filterBar.appendChild(btn);
  }

  // Scrollable results list (sits below the sticky filter bar)
  const listContainer = document.createElement('div');
  listContainer.className = 'grape-ac-list';

  dropdown.appendChild(filterBar);
  dropdown.appendChild(listContainer);

  // Hide original input visually
  input.style.display = 'none';

  wrapper.appendChild(tagContainer);
  wrapper.appendChild(searchInput);
  wrapper.appendChild(dropdown);
  input.parentNode.insertBefore(wrapper, input.nextSibling);

  // ── State ──
  let selectedGrapes = parseGrapesString(input.value);
  let activeFilter = 'all';

  // ── Render helpers ──
  function renderTags() {
    tagContainer.innerHTML = selectedGrapes.map((g, i) => {
      const colour = GRAPE_COLOUR_MAP.get(g) ?? '';
      const dotClass = colour ? ` grape-dot-${colour}` : '';
      return `<span class="grape-ac-tag${dotClass}">${escapeHtml(g)}<button type="button" class="grape-ac-tag-remove" data-idx="${i}" aria-label="Remove ${escapeHtml(g)}">&times;</button></span>`;
    }).join('');
    syncHiddenInput();
  }

  function syncHiddenInput() {
    input.value = selectedGrapes.join(', ');
  }

  /**
   * Render either search results or full browse list.
   * @param {string} query - trimmed search text (empty = browse mode)
   */
  function renderDropdown(query) {
    const isBrowse = query.length === 0;
    const results = isBrowse
      ? browse(activeFilter, selectedGrapes)
      : search(query, selectedGrapes, activeFilter);

    if (results.length === 0 && !isBrowse) {
      listContainer.innerHTML = '<div class="grape-ac-empty">No matches</div>';
      dropdown.style.display = 'block';
      dropdown._results = [];
      dropdown._highlightIdx = -1;
      return;
    }

    let html = '';
    let lastLetter = '';
    let itemIdx = 0;

    for (const item of results) {
      // Letter section headers in browse mode for grapes
      if (isBrowse && item.type === 'grape') {
        const letter = item.label.charAt(0).toUpperCase();
        if (letter !== lastLetter) {
          lastLetter = letter;
          html += `<div class="grape-ac-letter" aria-hidden="true">${letter}</div>`;
        }
      }

      if (item.type === 'blend') {
        const catClass = item.category ? ` grape-blend-${item.category}` : '';
        html += `<div class="grape-ac-option grape-ac-option-blend${catClass}" data-idx="${itemIdx}" role="option">` +
          `<span class="grape-ac-option-label">${escapeHtml(item.label)}</span>` +
          `<span class="grape-ac-option-detail">${escapeHtml(item.grapes)}</span></div>`;
      } else {
        const colour = GRAPE_COLOUR_MAP.get(item.label) ?? '';
        const dotHtml = colour ? `<span class="grape-ac-dot grape-dot-${colour}"></span>` : '';
        html += `<div class="grape-ac-option" data-idx="${itemIdx}" role="option">` +
          `${dotHtml}<span class="grape-ac-option-label">${escapeHtml(item.label)}</span></div>`;
      }
      itemIdx++;
    }

    listContainer.innerHTML = html;
    dropdown.style.display = 'block';
    dropdown._results = results;
    dropdown._highlightIdx = -1;
  }

  function hideDropdown() {
    dropdown.style.display = 'none';
    dropdown._results = [];
    dropdown._highlightIdx = -1;
  }

  function selectItem(item) {
    if (item.type === 'blend') {
      const blendGrapes = item.grapes.split(',').map(g => g.trim()).filter(Boolean);
      for (const g of blendGrapes) {
        if (!selectedGrapes.includes(g)) selectedGrapes.push(g);
      }
    } else {
      if (!selectedGrapes.includes(item.label)) selectedGrapes.push(item.label);
    }
    renderTags();
    searchInput.value = '';
    // Re-render browse after selection so just-added grapes disappear
    renderDropdown('');
    searchInput.focus();
  }

  function removeGrape(idx) {
    selectedGrapes.splice(idx, 1);
    renderTags();
  }

  function highlightOption(idx) {
    const options = listContainer.querySelectorAll('.grape-ac-option');
    options.forEach(o => o.classList.remove('grape-ac-option-active'));
    if (idx >= 0 && idx < options.length) {
      options[idx].classList.add('grape-ac-option-active');
      options[idx].scrollIntoView({ block: 'nearest' });
    }
    dropdown._highlightIdx = idx;
  }

  function setActiveFilter(key) {
    activeFilter = key;
    filterBar.querySelectorAll('.grape-ac-filter-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.filter === key);
    });
    renderDropdown(searchInput.value.trim());
  }

  // ── Events ──
  searchInput.addEventListener('input', () => {
    renderDropdown(searchInput.value.trim());
  });

  searchInput.addEventListener('focus', () => {
    renderDropdown(searchInput.value.trim());
  });

  searchInput.addEventListener('keydown', (e) => {
    const results = dropdown._results || [];

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (dropdown.style.display === 'none') {
        renderDropdown(searchInput.value.trim());
        return;
      }
      const next = Math.min((dropdown._highlightIdx ?? -1) + 1, results.length - 1);
      highlightOption(next);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = Math.max((dropdown._highlightIdx ?? 0) - 1, 0);
      highlightOption(prev);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const idx = dropdown._highlightIdx ?? -1;
      if (idx >= 0 && results[idx]) {
        selectItem(results[idx]);
      } else if (searchInput.value.trim()) {
        // Free-text entry
        const custom = searchInput.value.trim();
        if (!selectedGrapes.includes(custom)) {
          selectedGrapes.push(custom);
          renderTags();
        }
        searchInput.value = '';
        renderDropdown('');
      }
    } else if (e.key === 'Escape') {
      hideDropdown();
    } else if (e.key === 'Backspace' && !searchInput.value && selectedGrapes.length > 0) {
      selectedGrapes.pop();
      renderTags();
    }
  });

  // Dropdown click — options
  listContainer.addEventListener('click', (e) => {
    const option = e.target.closest('.grape-ac-option');
    if (!option) return;
    const idx = Number(option.dataset.idx);
    const results = dropdown._results || [];
    if (results[idx]) selectItem(results[idx]);
  });

  // Filter tab click
  filterBar.addEventListener('click', (e) => {
    const btn = e.target.closest('.grape-ac-filter-btn');
    if (!btn) return;
    e.stopPropagation();
    setActiveFilter(btn.dataset.filter);
    searchInput.focus();
  });

  // Tag remove click
  tagContainer.addEventListener('click', (e) => {
    const btn = e.target.closest('.grape-ac-tag-remove');
    if (!btn) return;
    e.stopPropagation();
    removeGrape(Number(btn.dataset.idx));
  });

  // Close dropdown on outside click
  function handleOutsideClick(e) {
    if (!wrapper.contains(e.target)) hideDropdown();
  }
  document.addEventListener('click', handleOutsideClick);

  // Initial render
  renderTags();

  // ── Public API ──
  return {
    getValue() { return input.value; },
    setValue(value) {
      selectedGrapes = parseGrapesString(value);
      renderTags();
      searchInput.value = '';
      hideDropdown();
    },
    /**
     * Commit any uncommitted text sitting in the search input.
     * Useful when the user types a grape name but clicks Save without
     * pressing Enter or selecting from the dropdown.
     * @returns {boolean} true if pending text was committed
     */
    commitPending() {
      const pending = searchInput.value.trim();
      if (!pending) return false;
      if (!selectedGrapes.includes(pending)) {
        selectedGrapes.push(pending);
        renderTags();
      }
      searchInput.value = '';
      hideDropdown();
      return true;
    },
    destroy() {
      document.removeEventListener('click', handleOutsideClick);
      input.style.display = '';
      input.dataset.grapeAcInit = '';
      if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
    },
  };
}

// ── Browse & search helpers ──

/**
 * Build browseable list for the given colour filter (no search query).
 * Returns all matching grapes sorted alphabetically with blends first.
 * @param {string} filter - 'all'|'red'|'white'|'rosé'|'sparkling'|'blends'
 * @param {string[]} exclude - Already selected grapes to exclude
 * @returns {Array<{type: 'grape'|'blend', label: string, grapes?: string, category?: string}>}
 */
export function browse(filter, exclude = []) {
  const results = [];

  // Blends (always shown first when relevant)
  if (filter === 'all' || filter === 'blends' || filter === 'red' || filter === 'white' ||
      filter === 'rosé' || filter === 'sparkling') {
    for (const blend of COMMON_BLENDS) {
      if (filter !== 'all' && filter !== 'blends' && blend.category !== filter) continue;
      results.push({ type: 'blend', label: blend.label, grapes: blend.grapes, category: blend.category });
    }
  }

  // Blends-only filter stops here
  if (filter === 'blends') return results;

  // Individual grapes
  const grapeList = filter === 'red' ? RED_GRAPES
    : filter === 'white' ? WHITE_GRAPES
    : GRAPE_VARIETIES;

  const sorted = [...grapeList].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  for (const grape of sorted) {
    if (exclude.includes(grape)) continue;
    results.push({ type: 'grape', label: grape });
  }

  return results;
}

/**
 * Search grape varieties and blends by query text, optionally limited to a colour filter.
 * @param {string} query - User search text
 * @param {string[]} exclude - Already selected grapes to exclude
 * @param {string} [filter='all'] - Colour filter
 * @returns {Array<{type: 'grape'|'blend', label: string, grapes?: string, category?: string}>}
 */
export function search(query, exclude = [], filter = 'all') {
  const q = query.toLowerCase();
  const results = [];

  // Search blends first (more specific)
  for (const blend of COMMON_BLENDS) {
    if (results.length >= MAX_SEARCH_RESULTS) break;
    if (filter !== 'all' && filter !== 'blends' && blend.category !== filter) continue;
    if (blend.label.toLowerCase().includes(q) ||
        blend.grapes.toLowerCase().includes(q)) {
      results.push({ type: 'blend', label: blend.label, grapes: blend.grapes, category: blend.category });
    }
  }

  // Then individual grapes
  const grapeList = filter === 'red' ? RED_GRAPES
    : filter === 'white' ? WHITE_GRAPES
    : filter === 'blends' ? []  // blends-only → no individual grapes
    : GRAPE_VARIETIES;

  for (const grape of grapeList) {
    if (results.length >= MAX_SEARCH_RESULTS) break;
    if (exclude.includes(grape)) continue;
    if (grape.toLowerCase().includes(q)) {
      results.push({ type: 'grape', label: grape });
    }
  }

  return results;
}

/**
 * Parse comma-separated grape string into array.
 * @param {string} value - e.g. "Cabernet Sauvignon, Merlot"
 * @returns {string[]}
 */
export function parseGrapesString(value) {
  if (!value) return [];
  return value.split(',').map(g => g.trim()).filter(Boolean);
}
