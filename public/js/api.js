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
