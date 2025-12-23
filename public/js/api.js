/**
 * @fileoverview API wrapper for all backend calls.
 * @module api
 */

const API_BASE = '';

/**
 * Handle API response with error checking.
 * @param {Response} res - Fetch response
 * @param {string} defaultError - Default error message
 * @returns {Promise<Object>}
 * @throws {Error} If response is not ok
 */
async function handleResponse(res, defaultError = 'Request failed') {
  if (!res.ok) {
    try {
      const data = await res.json();
      throw new Error(data.error || defaultError);
    } catch (e) {
      // If it's already our error, rethrow it
      if (e instanceof Error && e.message !== 'Unexpected end of JSON input') {
        throw e;
      }
      // If JSON parsing fails, use status text
      throw new Error(res.statusText || defaultError);
    }
  }
  return res.json();
}

/**
 * Fetch cellar layout.
 * @returns {Promise<Object>}
 */
export async function fetchLayout() {
  const res = await fetch(`${API_BASE}/api/stats/layout`);
  return handleResponse(res, 'Failed to fetch layout');
}

/**
 * Fetch statistics.
 * @returns {Promise<Object>}
 */
export async function fetchStats() {
  const res = await fetch(`${API_BASE}/api/stats`);
  return handleResponse(res, 'Failed to fetch stats');
}

/**
 * Fetch reduce-now list.
 * @returns {Promise<Array>}
 */
export async function fetchReduceNow() {
  const res = await fetch(`${API_BASE}/api/reduce-now`);
  return handleResponse(res, 'Failed to fetch reduce-now list');
}

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
 * Get sommelier pairing recommendation.
 * @param {string} dish - Dish description
 * @param {string} source - 'all' or 'reduce_now'
 * @param {string} colour - 'any', 'red', 'white', 'rose'
 * @returns {Promise<Object>}
 */
export async function askSommelier(dish, source, colour) {
  const res = await fetch(`${API_BASE}/api/pairing/natural`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dish, source, colour })
  });
  return handleResponse(res, 'Sommelier request failed');
}

/**
 * Get manual pairing suggestions.
 * @param {string[]} signals - Food signals
 * @returns {Promise<Object>}
 */
export async function getPairingSuggestions(signals) {
  const res = await fetch(`${API_BASE}/api/pairing/suggest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signals, prefer_reduce_now: true, limit: 5 })
  });
  return handleResponse(res, 'Failed to get pairing suggestions');
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
 * Get user settings.
 * @returns {Promise<Object>}
 */
export async function getSettings() {
  const res = await fetch(`${API_BASE}/api/settings`);
  return handleResponse(res, 'Failed to get settings');
}

/**
 * Update a setting.
 * @param {string} key - Setting key
 * @param {string} value - Setting value
 * @returns {Promise<Object>}
 */
export async function updateSetting(key, value) {
  const res = await fetch(`${API_BASE}/api/settings/${key}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value })
  });
  return handleResponse(res, 'Failed to update setting');
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
 * Fetch consumption history.
 * @param {number} limit - Max items to fetch
 * @param {number} offset - Offset for pagination
 * @returns {Promise<{items: Array, total: number}>}
 */
export async function fetchConsumptionHistory(limit = 50, offset = 0) {
  const res = await fetch(`${API_BASE}/api/stats/consumption?limit=${limit}&offset=${offset}`);
  return handleResponse(res, 'Failed to fetch consumption history');
}

// ============================================
// Credential Management API
// ============================================

/**
 * Get configured credentials (status only, no secrets).
 * @returns {Promise<{encryption_configured: boolean, credentials: Array}>}
 */
export async function getCredentials() {
  const res = await fetch(`${API_BASE}/api/settings/credentials`);
  return handleResponse(res, 'Failed to get credentials');
}

/**
 * Save credentials for a source.
 * @param {string} source - Source ID (vivino, decanter, cellartracker)
 * @param {string} username - Username/email
 * @param {string} password - Password
 * @returns {Promise<Object>}
 */
export async function saveCredentials(source, username, password) {
  const res = await fetch(`${API_BASE}/api/settings/credentials/${source}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  return handleResponse(res, 'Failed to save credentials');
}

/**
 * Delete credentials for a source.
 * @param {string} source - Source ID
 * @returns {Promise<Object>}
 */
export async function deleteCredentials(source) {
  const res = await fetch(`${API_BASE}/api/settings/credentials/${source}`, {
    method: 'DELETE'
  });
  return handleResponse(res, 'Failed to delete credentials');
}

/**
 * Test credentials for a source.
 * @param {string} source - Source ID
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function testCredentials(source) {
  const res = await fetch(`${API_BASE}/api/settings/credentials/${source}/test`, {
    method: 'POST'
  });
  return handleResponse(res, 'Failed to test credentials');
}

// ============================================
// Reduce-Now Auto Rules API
// ============================================

/**
 * Evaluate wines against auto-rules.
 * @returns {Promise<{enabled: boolean, rules: Object, candidates: Array}>}
 */
export async function evaluateReduceRules() {
  const res = await fetch(`${API_BASE}/api/reduce-now/evaluate`, {
    method: 'POST'
  });
  return handleResponse(res, 'Failed to evaluate rules');
}

/**
 * Batch add wines to reduce-now.
 * @param {number[]} wineIds - Wine IDs to add
 * @param {number} priority - Priority level (1-5)
 * @param {string} reasonPrefix - Reason prefix text
 * @returns {Promise<{message: string, added: number}>}
 */
export async function batchAddReduceNow(wineIds, priority = 3, reasonPrefix = '') {
  const res = await fetch(`${API_BASE}/api/reduce-now/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wine_ids: wineIds, priority, reason_prefix: reasonPrefix })
  });
  return handleResponse(res, 'Failed to add wines');
}
