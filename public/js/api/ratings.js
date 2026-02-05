/**
 * @fileoverview Ratings, drinking windows, and personal rating API calls.
 * @module api/ratings
 */

import { API_BASE, apiFetch, handleResponse } from './base.js';

const fetch = apiFetch;

/**
 * Get personal rating for a wine.
 * @param {number} wineId - Wine ID
 * @returns {Promise<Object>}
 */
export async function getPersonalRating(wineId) {
  const res = await fetch(`${API_BASE}/api/wines/${wineId}/personal-rating`);
  return handleResponse(res, 'Failed to fetch personal rating');
}

/**
 * Update personal rating for a wine.
 * @param {number} wineId - Wine ID
 * @param {number|string} rating - Rating value (0-5)
 * @param {string} notes - Tasting notes
 * @returns {Promise<Object>}
 */
export async function updatePersonalRating(wineId, rating, notes) {
  const res = await fetch(`${API_BASE}/api/wines/${wineId}/personal-rating`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rating, notes })
  });
  return handleResponse(res, 'Failed to update personal rating');
}

/**
 * Get ratings for a wine.
 * @param {number} wineId - Wine ID
 * @returns {Promise<Object>}
 */
export async function getWineRatings(wineId) {
  const res = await fetch(`${API_BASE}/api/wines/${wineId}/ratings`);
  return handleResponse(res, 'Failed to get wine ratings');
}

/**
 * Fetch ratings from web using Claude.
 * @param {number} wineId - Wine ID
 * @returns {Promise<Object>}
 */
export async function fetchWineRatingsFromApi(wineId) {
  const res = await fetch(`${API_BASE}/api/wines/${wineId}/ratings/fetch`, {
    method: 'POST'
  });
  return handleResponse(res, 'Failed to fetch ratings');
}

/**
 * Queue async ratings fetch job.
 * @param {number} wineId - Wine ID
 * @returns {Promise<{jobId: number}>}
 */
export async function fetchRatingsAsync(wineId) {
  const res = await fetch(`${API_BASE}/api/wines/${wineId}/ratings/fetch-async`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ forceRefresh: true })
  });
  return handleResponse(res, 'Failed to queue ratings fetch');
}

/**
 * Get status for a ratings job.
 * @param {number} jobId - Job ID
 * @returns {Promise<Object>}
 */
export async function getRatingsJobStatus(jobId) {
  const res = await fetch(`${API_BASE}/api/ratings/jobs/${jobId}/status`);
  return handleResponse(res, 'Failed to get ratings job status');
}

/**
 * Get identity diagnostics for a wine's ratings.
 * @param {number} wineId - Wine ID
 * @returns {Promise<Object>}
 */
export async function getIdentityDiagnostics(wineId) {
  const res = await fetch(`${API_BASE}/api/wines/${wineId}/ratings/identity-diagnostics`);
  return handleResponse(res, 'Failed to fetch identity diagnostics');
}

/**
 * Add manual rating.
 * @param {number} wineId - Wine ID
 * @param {Object} rating - Rating details
 * @returns {Promise<Object>}
 */
export async function addManualRating(wineId, rating) {
  const res = await fetch(`${API_BASE}/api/wines/${wineId}/ratings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rating)
  });
  return handleResponse(res, 'Failed to add rating');
}

/**
 * Delete a rating.
 * @param {number} wineId - Wine ID
 * @param {number} ratingId - Rating ID
 * @returns {Promise<Object>}
 */
export async function deleteRating(wineId, ratingId) {
  const res = await fetch(`${API_BASE}/api/wines/${wineId}/ratings/${ratingId}`, {
    method: 'DELETE'
  });
  return handleResponse(res, 'Failed to delete rating');
}

/**
 * Refresh ratings for a wine with backoff.
 * @param {number} id - Wine ID
 * @returns {Promise<Object>}
 */
export async function refreshWineRatings(id) {
  const res = await fetch(`${API_BASE}/api/wines/${id}/refresh-ratings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  return handleResponse(res, 'Failed to refresh ratings');
}

// ============================================
// Drinking Windows API
// ============================================

/**
 * Get all drinking windows for a wine.
 * @param {number} wineId - Wine ID
 * @returns {Promise<Array>} Array of drinking window objects
 */
export async function getDrinkingWindows(wineId) {
  const res = await fetch(`${API_BASE}/api/wines/${wineId}/drinking-windows`);
  return handleResponse(res, 'Failed to fetch drinking windows');
}

/**
 * Save a drinking window for a wine.
 * @param {number} wineId - Wine ID
 * @param {Object} windowData - Window data (source, drink_from_year, drink_by_year, peak_year, confidence, raw_text)
 * @returns {Promise<{success: boolean}>}
 */
export async function saveDrinkingWindow(wineId, windowData) {
  const res = await fetch(`${API_BASE}/api/wines/${wineId}/drinking-windows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(windowData)
  });
  return handleResponse(res, 'Failed to save drinking window');
}

/**
 * Delete a drinking window for a wine.
 * @param {number} wineId - Wine ID
 * @param {string} source - Source identifier
 * @returns {Promise<{success: boolean}>}
 */
export async function deleteDrinkingWindow(wineId, source) {
  const res = await fetch(`${API_BASE}/api/wines/${wineId}/drinking-windows/${source}`, {
    method: 'DELETE'
  });
  return handleResponse(res, 'Failed to delete drinking window');
}

/**
 * Get the best/primary drinking window for a wine.
 * @param {number} wineId - Wine ID
 * @returns {Promise<Object|null>} Best drinking window or null
 */
export async function getBestDrinkingWindow(wineId) {
  const res = await fetch(`${API_BASE}/api/wines/${wineId}/drinking-window/best`);
  return handleResponse(res, 'Failed to fetch best drinking window');
}

/**
 * Get wines with urgent drinking windows.
 * @param {number} months - Urgency threshold in months (default: 12)
 * @returns {Promise<Array>} Array of urgent wine objects
 */
export async function getUrgentWines(months = 12) {
  const res = await fetch(`${API_BASE}/api/drinking-windows/urgent?months=${months}`);
  return handleResponse(res, 'Failed to fetch urgent wines');
}
