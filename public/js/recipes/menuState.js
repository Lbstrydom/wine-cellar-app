/**
 * @fileoverview Menu builder state management using sessionStorage.
 * Tracks selected recipes for multi-recipe pairing.
 * @module recipes/menuState
 */

const STORAGE_KEY = 'wineapp.recipes.menu';

/** @type {{selectedIds: number[], selectedRecipes: Object[]}} */
export const menuState = {
  selectedIds: [],
  selectedRecipes: []
};

/**
 * Load menu state from sessionStorage.
 */
export function loadMenuState() {
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      menuState.selectedIds = parsed.selectedIds || [];
      menuState.selectedRecipes = parsed.selectedRecipes || [];
    }
  } catch { /* ignore corrupt storage */ }
}

/**
 * Persist menu state to sessionStorage.
 */
export function persistMenuState() {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      selectedIds: menuState.selectedIds,
      selectedRecipes: menuState.selectedRecipes
    }));
  } catch { /* ignore */ }
}

/**
 * Toggle a recipe in the menu selection.
 * @param {Object} recipe - Recipe object {id, name, categories}
 * @returns {boolean} True if added, false if removed
 */
export function toggleMenuRecipe(recipe) {
  const idx = menuState.selectedIds.indexOf(recipe.id);
  if (idx >= 0) {
    menuState.selectedIds.splice(idx, 1);
    menuState.selectedRecipes.splice(idx, 1);
    persistMenuState();
    return false;
  } else {
    menuState.selectedIds.push(recipe.id);
    menuState.selectedRecipes.push({
      id: recipe.id,
      name: recipe.name,
      categories: recipe.categories
    });
    persistMenuState();
    return true;
  }
}

/**
 * Check if a recipe is selected for the menu.
 * @param {number} recipeId - Recipe ID
 * @returns {boolean}
 */
export function isInMenu(recipeId) {
  return menuState.selectedIds.includes(recipeId);
}

/**
 * Clear the menu selection.
 */
export function clearMenu() {
  menuState.selectedIds = [];
  menuState.selectedRecipes = [];
  persistMenuState();
}
