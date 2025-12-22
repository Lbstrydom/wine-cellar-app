/**
 * @fileoverview API wrapper for all backend calls.
 * @module api
 */

const API_BASE = '';

/**
 * Fetch cellar layout.
 * @returns {Promise<Object>}
 */
export async function fetchLayout() {
  const res = await fetch(`${API_BASE}/api/stats/layout`);
  return res.json();
}

/**
 * Fetch statistics.
 * @returns {Promise<Object>}
 */
export async function fetchStats() {
  const res = await fetch(`${API_BASE}/api/stats`);
  return res.json();
}

/**
 * Fetch reduce-now list.
 * @returns {Promise<Array>}
 */
export async function fetchReduceNow() {
  const res = await fetch(`${API_BASE}/api/reduce-now`);
  return res.json();
}

/**
 * Fetch all wines.
 * @returns {Promise<Array>}
 */
export async function fetchWines() {
  const res = await fetch(`${API_BASE}/api/wines`);
  return res.json();
}

/**
 * Fetch single wine.
 * @param {number} id - Wine ID
 * @returns {Promise<Object>}
 */
export async function fetchWine(id) {
  const res = await fetch(`${API_BASE}/api/wines/${id}`);
  return res.json();
}

/**
 * Search wines by name.
 * @param {string} query - Search query
 * @returns {Promise<Array>}
 */
export async function searchWines(query) {
  const res = await fetch(`${API_BASE}/api/wines/search?q=${encodeURIComponent(query)}`);
  return res.json();
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
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Move failed');
  }
  return res.json();
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
  return res.json();
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
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Request failed');
  }
  return res.json();
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
  return res.json();
}

/**
 * Get wine styles for autocomplete.
 * @returns {Promise<string[]>}
 */
export async function fetchWineStyles() {
  const res = await fetch(`${API_BASE}/api/wines/styles`);
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
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to parse wine');
  }
  return res.json();
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
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to parse image');
  }
  return res.json();
}

/**
 * Get ratings for a wine.
 * @param {number} wineId - Wine ID
 * @returns {Promise<Object>}
 */
export async function getWineRatings(wineId) {
  const res = await fetch(`${API_BASE}/api/wines/${wineId}/ratings`);
  return res.json();
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
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to fetch ratings');
  }
  return res.json();
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
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to add rating');
  }
  return res.json();
}

/**
 * Get user settings.
 * @returns {Promise<Object>}
 */
export async function getSettings() {
  const res = await fetch(`${API_BASE}/api/settings`);
  return res.json();
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
  return res.json();
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
  return res.json();
}

/**
 * Fetch consumption history.
 * @param {number} limit - Max items to fetch
 * @param {number} offset - Offset for pagination
 * @returns {Promise<{items: Array, total: number}>}
 */
export async function fetchConsumptionHistory(limit = 50, offset = 0) {
  const res = await fetch(`${API_BASE}/api/stats/consumption?limit=${limit}&offset=${offset}`);
  return res.json();
}
