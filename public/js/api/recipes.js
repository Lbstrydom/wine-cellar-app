/**
 * @fileoverview Recipe API calls.
 * @module api/recipes
 */

import { API_BASE, apiFetch, handleResponse } from './base.js';

const fetch = apiFetch;

/**
 * List recipes with optional filters.
 * @param {Object} [params] - Query params
 * @returns {Promise<{data: Array, total: number}>}
 */
export async function listRecipes(params = {}) {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') query.set(k, v);
  }
  const qs = query.toString();
  const res = await fetch(`${API_BASE}/api/recipes${qs ? '?' + qs : ''}`);
  return handleResponse(res, 'Failed to load recipes');
}

/**
 * Get a single recipe.
 * @param {number} id - Recipe ID
 * @returns {Promise<{data: Object}>}
 */
export async function getRecipe(id) {
  const res = await fetch(`${API_BASE}/api/recipes/${id}`);
  return handleResponse(res, 'Failed to load recipe');
}

/**
 * Create a manual recipe.
 * @param {Object} data - Recipe data
 * @returns {Promise<{message: string, data: {id: number}}>}
 */
export async function createRecipe(data) {
  const res = await fetch(`${API_BASE}/api/recipes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return handleResponse(res, 'Failed to create recipe');
}

/**
 * Update a recipe.
 * @param {number} id - Recipe ID
 * @param {Object} data - Fields to update
 * @returns {Promise<{message: string}>}
 */
export async function updateRecipe(id, data) {
  const res = await fetch(`${API_BASE}/api/recipes/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return handleResponse(res, 'Failed to update recipe');
}

/**
 * Delete (soft-delete) a recipe.
 * @param {number} id - Recipe ID
 * @returns {Promise<{message: string}>}
 */
export async function deleteRecipe(id) {
  const res = await fetch(`${API_BASE}/api/recipes/${id}`, { method: 'DELETE' });
  return handleResponse(res, 'Failed to delete recipe');
}

/**
 * Get recipe categories with counts.
 * @returns {Promise<{data: Array<{category: string, count: number}>}>}
 */
export async function getRecipeCategories() {
  const res = await fetch(`${API_BASE}/api/recipes/categories`);
  return handleResponse(res, 'Failed to load categories');
}

/**
 * Import recipes from a Paprika file.
 * @param {File} file - .paprikarecipes file
 * @returns {Promise<Object>}
 */
export async function importPaprikaFile(file) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${API_BASE}/api/recipes/import/paprika`, {
    method: 'POST',
    body: formData
  });
  return handleResponse(res, 'Failed to import Paprika file');
}

/**
 * Import recipes from a RecipeSage JSON export.
 * @param {File} file - JSON file
 * @returns {Promise<Object>}
 */
export async function importRecipeSageFile(file) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${API_BASE}/api/recipes/import/recipesage`, {
    method: 'POST',
    body: formData
  });
  return handleResponse(res, 'Failed to import RecipeSage file');
}

/**
 * Import recipes from a CSV file.
 * @param {File} file - CSV file
 * @returns {Promise<Object>}
 */
export async function importCsvFile(file) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${API_BASE}/api/recipes/import/csv`, {
    method: 'POST',
    body: formData
  });
  return handleResponse(res, 'Failed to import CSV file');
}

/**
 * Import a recipe from a URL.
 * @param {string} url - Recipe page URL
 * @returns {Promise<Object>}
 */
export async function importRecipeFromUrl(url) {
  const res = await fetch(`${API_BASE}/api/recipes/import/url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url })
  });
  return handleResponse(res, 'Failed to import recipe from URL');
}

/**
 * Trigger recipe sync for a provider.
 * @param {string} provider - 'paprika' or 'mealie'
 * @returns {Promise<Object>}
 */
export async function triggerRecipeSync(provider) {
  const res = await fetch(`${API_BASE}/api/recipes/sync/${provider}`, {
    method: 'POST'
  });
  return handleResponse(res, 'Failed to sync recipes');
}

/**
 * Get sync status for a provider.
 * @param {string} provider - 'paprika' or 'mealie'
 * @returns {Promise<Object>}
 */
export async function getRecipeSyncStatus(provider) {
  const res = await fetch(`${API_BASE}/api/recipes/sync/${provider}/status`);
  return handleResponse(res, 'Failed to get sync status');
}

/**
 * Get wine pairing suggestions for a recipe.
 * @param {number} recipeId - Recipe ID
 * @param {Object} [options] - Optional filters (colour)
 * @returns {Promise<Object>}
 */
export async function getRecipePairing(recipeId, options = {}) {
  const res = await fetch(`${API_BASE}/api/recipes/${recipeId}/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options)
  });
  return handleResponse(res, 'Failed to get pairing suggestions');
}

/**
 * Save category frequency overrides.
 * @param {Object} overrides - {category: frequency} map
 * @returns {Promise<{message: string}>}
 */
export async function saveCategoryOverrides(overrides) {
  const res = await fetch(`${API_BASE}/api/recipes/categories/overrides`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ overrides })
  });
  return handleResponse(res, 'Failed to save overrides');
}

/**
 * Get cooking profile for the current cellar.
 * @returns {Promise<{data: Object}>}
 */
export async function getCookingProfile() {
  const res = await fetch(`${API_BASE}/api/recipes/profile`);
  return handleResponse(res, 'Failed to load cooking profile');
}

/**
 * Force refresh the cooking profile (cache-bust).
 * @returns {Promise<{data: Object}>}
 */
export async function refreshCookingProfile() {
  const res = await fetch(`${API_BASE}/api/recipes/profile/refresh`, {
    method: 'POST'
  });
  return handleResponse(res, 'Failed to refresh cooking profile');
}

/**
 * Multi-recipe pairing: combine signals from multiple recipes.
 * @param {number[]} recipeIds - Recipe IDs to pair
 * @param {Object} [options] - Optional filters (colour)
 * @returns {Promise<Object>}
 */
/**
 * Get buying guide (gap analysis) for the cellar.
 * @returns {Promise<{data: Object}>}
 */
export async function getBuyingGuide() {
  const res = await fetch(`${API_BASE}/api/recipes/buying-guide`);
  return handleResponse(res, 'Failed to load buying guide');
}

/**
 * Multi-recipe pairing: combine signals from multiple recipes.
 * @param {number[]} recipeIds - Recipe IDs to pair
 * @param {Object} [options] - Optional filters (colour)
 * @returns {Promise<Object>}
 */
export async function getMenuPairing(recipeIds, options = {}) {
  const res = await fetch(`${API_BASE}/api/recipes/menu-pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipe_ids: recipeIds, ...options })
  });
  return handleResponse(res, 'Failed to get menu pairing');
}
