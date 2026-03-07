/**
 * @fileoverview Wine CRUD, search, parsing, bottles, and slot operations.
 * @module api/wines
 */

import { API_BASE, apiFetch, handleResponse } from './base.js';

const fetch = apiFetch;

/**
 * Fetch all wines (up to 500 for full table view).
 * @returns {Promise<Array>}
 */
export async function fetchWines() {
  const res = await fetch(`${API_BASE}/api/wines?limit=500`);
  return handleResponse(res, 'Failed to fetch wines');
}

/**
 * Fetch single wine.
 * @param {number} id - Wine ID
 * @returns {Promise<Object>}
 */
export async function fetchWine(id) {
  const res = await fetch(`${API_BASE}/api/wines/${id}`);
  return handleResponse(res, 'Failed to fetch wine');
}

/**
 * Search wines by name.
 * @param {string} query - Search query
 * @returns {Promise<Array>}
 */
export async function searchWines(query) {
  const res = await fetch(`${API_BASE}/api/wines/search?q=${encodeURIComponent(query)}`);
  return handleResponse(res, 'Failed to search wines');
}

/**
 * Get wine styles for autocomplete.
 * @returns {Promise<string[]>}
 */
export async function fetchWineStyles() {
  const res = await fetch(`${API_BASE}/api/wines/styles`);
  return handleResponse(res, 'Failed to fetch wine styles');
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
  return handleResponse(res, 'Failed to create wine');
}

/**
 * Check for duplicate wines and external matches.
 * @param {Object} wineData - Wine details
 * @returns {Promise<Object>}
 */
export async function checkWineDuplicate(wineData) {
  const res = await fetch(`${API_BASE}/api/wines/check-duplicate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(wineData)
  });
  return handleResponse(res, 'Failed to check duplicates');
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
  return handleResponse(res, 'Failed to update wine');
}

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
  return handleResponse(res, 'Failed to parse wine');
}

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
  return handleResponse(res, 'Failed to parse image');
}

/**
 * Add bottles to slots.
 * @param {number} wineId - Wine ID
 * @param {string} startLocation - Starting slot
 * @param {number} quantity - Number of bottles
 * @param {string|null} [storageAreaId] - Storage area ID (optional)
 * @returns {Promise<{message: string, locations: string[]}>}
 */
export async function addBottles(wineId, startLocation, quantity, storageAreaId = null) {
  const res = await fetch(`${API_BASE}/api/bottles/add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wine_id: wineId,
      start_location: startLocation,
      quantity,
      storage_area_id: storageAreaId
    })
  });
  return handleResponse(res, 'Failed to add bottles');
}

/**
 * Remove bottle from slot (no consumption log).
 * @param {string} location - Slot location
 * @param {string|null} [storageAreaId] - Storage area ID for area-scoped resolution
 * @returns {Promise<{message: string}>}
 */
export async function removeBottle(location, storageAreaId = null) {
  const res = await fetch(`${API_BASE}/api/slots/${location}/remove`, {
    method: 'DELETE',
    ...(storageAreaId ? {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storage_area_id: storageAreaId })
    } : {})
  });
  return handleResponse(res, 'Failed to remove bottle');
}

/**
 * Move bottle between slots.
 * @param {string} from - Source location
 * @param {string} to - Target location
 * @param {string|null} [fromAreaId] - Source storage area ID
 * @param {string|null} [toAreaId] - Target storage area ID
 * @returns {Promise<Object>}
 */
export async function moveBottle(from, to, fromAreaId = null, toAreaId = null) {
  const res = await fetch(`${API_BASE}/api/slots/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from_location: from,
      to_location: to,
      from_storage_area_id: fromAreaId,
      to_storage_area_id: toAreaId
    })
  });
  return handleResponse(res, 'Move failed');
}

/**
 * Swap bottles between slots (3-way swap).
 * @param {string} slotA - First slot (bottle being dragged)
 * @param {string} slotB - Second slot (occupied target)
 * @param {string} displacedTo - Where to move the displaced bottle
 * @param {string|null} [areaA] - Storage area ID for slotA
 * @param {string|null} [areaB] - Storage area ID for slotB
 * @param {string|null} [areaDisplaced] - Storage area ID for displacedTo
 * @returns {Promise<Object>}
 */
export async function swapBottles(slotA, slotB, displacedTo, areaA = null, areaB = null, areaDisplaced = null) {
  const res = await fetch(`${API_BASE}/api/slots/swap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      slot_a: slotA,
      slot_b: slotB,
      displaced_to: displacedTo,
      slot_a_storage_area_id: areaA,
      slot_b_storage_area_id: areaB,
      displaced_to_storage_area_id: areaDisplaced
    })
  });
  return handleResponse(res, 'Swap failed');
}

/**
 * Direct swap between two occupied slots.
 * @param {string} slotA - First slot
 * @param {string} slotB - Second slot
 * @param {string|null} [areaA] - Storage area ID for slotA
 * @param {string|null} [areaB] - Storage area ID for slotB
 * @returns {Promise<Object>}
 */
export async function directSwapBottles(slotA, slotB, areaA = null, areaB = null) {
  const res = await fetch(`${API_BASE}/api/slots/direct-swap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      slot_a: slotA,
      slot_b: slotB,
      slot_a_storage_area_id: areaA,
      slot_b_storage_area_id: areaB
    })
  });
  return handleResponse(res, 'Swap failed');
}

/**
 * Drink bottle from slot.
 * @param {string} location - Slot location
 * @param {Object} details - Consumption details (may include storage_area_id)
 * @returns {Promise<Object>}
 */
export async function drinkBottle(location, details = {}) {
  const res = await fetch(`${API_BASE}/api/slots/${location}/drink`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(details)
  });
  return handleResponse(res, 'Failed to record drink');
}

/**
 * Mark bottle as open.
 * @param {string} location - Slot location
 * @param {string|null} [storageAreaId] - Storage area ID for area-scoped resolution
 * @returns {Promise<Object>}
 */
export async function openBottle(location, storageAreaId = null) {
  const res = await fetch(`${API_BASE}/api/slots/${location}/open`, {
    method: 'PUT',
    ...(storageAreaId ? {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storage_area_id: storageAreaId })
    } : {})
  });
  return handleResponse(res, 'Failed to mark bottle as open');
}

/**
 * Mark bottle as sealed (undo open).
 * @param {string} location - Slot location
 * @param {string|null} [storageAreaId] - Storage area ID for area-scoped resolution
 * @returns {Promise<Object>}
 */
export async function sealBottle(location, storageAreaId = null) {
  const res = await fetch(`${API_BASE}/api/slots/${location}/seal`, {
    method: 'PUT',
    ...(storageAreaId ? {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storage_area_id: storageAreaId })
    } : {})
  });
  return handleResponse(res, 'Failed to seal bottle');
}

/**
 * Get all open bottles.
 * @returns {Promise<Object>}
 */
export async function getOpenBottles() {
  const res = await fetch(`${API_BASE}/api/slots/open`);
  return handleResponse(res, 'Failed to fetch open bottles');
}

/**
 * Report an issue with tasting notes.
 * @param {number} wineId - Wine ID
 * @param {Object} data - Report payload
 * @returns {Promise<Object>}
 */
export async function reportTastingNotes(wineId, data) {
  const res = await fetch(`${API_BASE}/api/wines/${wineId}/tasting-notes/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return handleResponse(res, 'Failed to report tasting notes');
}

/**
 * Get wine search metrics summary.
 * @returns {Promise<Object>}
 */
export async function getSearchMetrics() {
  const res = await fetch(`${API_BASE}/api/search/metrics`);
  return handleResponse(res, 'Failed to fetch search metrics');
}
