/**
 * @fileoverview Recipe view state management with localStorage persistence.
 * @module recipes/state
 */

const STORAGE_PREFIX = 'wineapp.recipes.';

/** @type {Object} */
export const recipeState = {
  recipes: [],
  categories: [],
  total: 0,
  currentPage: 1,
  pageSize: 24,
  searchQuery: '',
  categoryFilter: '',
  ratingFilter: 0,
  sourceFilter: '',
  selectedRecipeId: null,
  importInProgress: false
};

/**
 * Load persisted filter state from localStorage.
 */
export function loadPersistedState() {
  try {
    const saved = localStorage.getItem(STORAGE_PREFIX + 'filters');
    if (saved) {
      const parsed = JSON.parse(saved);
      recipeState.searchQuery = parsed.searchQuery || '';
      recipeState.categoryFilter = parsed.categoryFilter || '';
      recipeState.ratingFilter = parsed.ratingFilter || 0;
      recipeState.sourceFilter = parsed.sourceFilter || '';
      recipeState.pageSize = parsed.pageSize || 24;
    }
  } catch { /* ignore corrupt storage */ }
}

/**
 * Persist filter state to localStorage.
 */
export function persistState() {
  try {
    localStorage.setItem(STORAGE_PREFIX + 'filters', JSON.stringify({
      searchQuery: recipeState.searchQuery,
      categoryFilter: recipeState.categoryFilter,
      ratingFilter: recipeState.ratingFilter,
      sourceFilter: recipeState.sourceFilter,
      pageSize: recipeState.pageSize
    }));
  } catch { /* ignore quota exceeded */ }
}

/**
 * Reset filters to defaults.
 */
export function resetFilters() {
  recipeState.searchQuery = '';
  recipeState.categoryFilter = '';
  recipeState.ratingFilter = 0;
  recipeState.sourceFilter = '';
  recipeState.currentPage = 1;
  persistState();
}
