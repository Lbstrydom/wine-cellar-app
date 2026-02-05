/**
 * @fileoverview Wine CRUD, search, parsing, bottles, and slot operations.
 * @module api/wines
 */

import { API_BASE, apiFetch, handleResponse } from './base.js';

const fetch = apiFetch;

/**
 * Fetch all wines.
 * @returns {Promise<Array>}
 */
export async function fetchWines() {
  const res = await fetch(`${API_BASE}/api/wines`);
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
 * Get external IDs for a wine.
 * @param {number} id - Wine ID
 * @returns {Promise<Object>}
 */
export async function getWineExternalIds(id) {
  const res = await fetch(`${API_BASE}/api/wines/${id}/external-ids`);
  return handleResponse(res, 'Failed to fetch external IDs');
}

/**
 * Confirm an external ID candidate.
 * @param {number} id - Wine ID
 * @param {Object} payload - Confirmation payload
 * @returns {Promise<Object>}
 */
export async function confirmWineExternalId(id, payload) {
  const res = await fetch(`${API_BASE}/api/wines/${id}/confirm-external-id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return handleResponse(res, 'Failed to confirm external ID');
}

/**
 * Set Vivino URL for a wine.
 * @param {number} id - Wine ID
 * @param {string} vivinoUrl - Vivino URL
 * @returns {Promise<Object>}
 */
export async function setWineVivinoUrl(id, vivinoUrl) {
  const res = await fetch(`${API_BASE}/api/wines/${id}/set-vivino-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vivino_url: vivinoUrl })
  });
  return handleResponse(res, 'Failed to set Vivino URL');
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
 * @returns {Promise<{message: string, locations: string[]}>}
 */
export async function addBottles(wineId, startLocation, quantity) {
  const res = await fetch(`${API_BASE}/api/bottles/add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wine_id: wineId, start_location: startLocation, quantity })
  });
  return handleResponse(res, 'Failed to add bottles');
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
  return handleResponse(res, 'Failed to remove bottle');
}

/**
 * Move bottle between slots.
 * @param {string} from - Source location
 * @param {string} to - Target location
 * @returns {Promise<Object>}
 */
export async function moveBottle(from, to) {
  const res = await fetch(`${API_BASE}/api/slots/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from_location: from, to_location: to })
  });
  return handleResponse(res, 'Move failed');
}

/**
 * Swap bottles between slots (3-way swap).
 * @param {string} slotA - First slot (bottle being dragged)
 * @param {string} slotB - Second slot (occupied target)
 * @param {string} displacedTo - Where to move the displaced bottle
 * @returns {Promise<Object>}
 */
export async function swapBottles(slotA, slotB, displacedTo) {
  const res = await fetch(`${API_BASE}/api/slots/swap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slot_a: slotA, slot_b: slotB, displaced_to: displacedTo })
  });
  return handleResponse(res, 'Swap failed');
}

/**
 * Direct swap between two occupied slots.
 * @param {string} slotA - First slot
 * @param {string} slotB - Second slot
 * @returns {Promise<Object>}
 */
export async function directSwapBottles(slotA, slotB) {
  const res = await fetch(`${API_BASE}/api/slots/direct-swap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slot_a: slotA, slot_b: slotB })
  });
  return handleResponse(res, 'Swap failed');
}

/**
 * Drink bottle from slot.
 * @param {string} location - Slot location
 * @param {Object} details - Consumption details
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
 * @returns {Promise<Object>}
 */
export async function openBottle(location) {
  const res = await fetch(`${API_BASE}/api/slots/${location}/open`, {
    method: 'PUT'
  });
  return handleResponse(res, 'Failed to mark bottle as open');
}

/**
 * Mark bottle as sealed (undo open).
 * @param {string} location - Slot location
 * @returns {Promise<Object>}
 */
export async function sealBottle(location) {
  const res = await fetch(`${API_BASE}/api/slots/${location}/seal`, {
    method: 'PUT'
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
 * Get serving temperature recommendation for a wine.
 * @param {number} wineId - Wine ID
 * @param {string} [unit='celsius'] - Temperature unit ('celsius' or 'fahrenheit')
 * @returns {Promise<Object>} Temperature recommendation
 */
export async function getServingTemperature(wineId, unit = 'celsius') {
  const res = await fetch(`${API_BASE}/api/wines/${wineId}/serving-temperature?unit=${unit}`);
  return handleResponse(res, 'Failed to fetch serving temperature');
}

/**
 * Get structured tasting notes for a wine.
 * @param {number} wineId - Wine ID
 * @param {boolean} [includeSources=false] - Include source attribution
 * @returns {Promise<Object>}
 */
export async function getTastingNotes(wineId, includeSources = false) {
  const query = includeSources ? '?include_sources=true' : '';
  const res = await fetch(`${API_BASE}/api/wines/${wineId}/tasting-notes${query}`);
  return handleResponse(res, 'Failed to fetch tasting notes');
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
 * Search Vivino for wines (for confirmation workflow).
 * @param {Object} params - Search parameters
 * @param {string} params.wineName - Wine name
 * @param {string} [params.producer] - Producer name
 * @param {number} [params.vintage] - Vintage year
 * @param {string} [params.country] - Country
 * @param {string} [params.colour] - Wine colour
 * @returns {Promise<{query: Object, matches: Array, error: string|null}>}
 */
export async function searchVivinoWines({ wineName, producer, vintage, country, colour }) {
  const res = await fetch(`${API_BASE}/api/wine-search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wineName, producer, vintage, country, colour })
  });
  return handleResponse(res, 'Failed to search Vivino');
}

/**
 * Get Vivino wine details by ID.
 * @param {number} vivinoId - Vivino wine ID
 * @returns {Promise<Object>}
 */
export async function getVivinoWineDetails(vivinoId) {
  const res = await fetch(`${API_BASE}/api/wine-search/vivino/${vivinoId}`);
  return handleResponse(res, 'Failed to fetch Vivino wine details');
}

/**
 * Get wine search service status.
 * @returns {Promise<{available: boolean, message?: string}>}
 */
export async function getWineSearchStatus() {
  const res = await fetch(`${API_BASE}/api/wine-search/status`);
  return handleResponse(res, 'Failed to fetch wine search status');
}

/**
 * Get wine search metrics summary.
 * @returns {Promise<Object>}
 */
export async function getSearchMetrics() {
  const res = await fetch(`${API_BASE}/api/search/metrics`);
  return handleResponse(res, 'Failed to fetch search metrics');
}
