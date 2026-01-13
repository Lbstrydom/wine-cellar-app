/**
 * @fileoverview API wrapper for all backend calls.
 * @module api
 */

const API_BASE = '';
const AUTH_TOKEN_KEY = 'access_token';
const ACTIVE_CELLAR_KEY = 'active_cellar_id';
const INVITE_CODE_KEY = 'invite_code';

let authErrorHandler = null;

/**
 * Register a handler for auth failures (401).
 * @param {Function|null} handler - Callback to run on 401 responses
 */
export function setAuthErrorHandler(handler) {
  authErrorHandler = handler;
}

/**
 * Get stored access token.
 * @returns {string|null}
 */
export function getAccessToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

/**
 * Store access token.
 * @param {string|null} token
 */
export function setAccessToken(token) {
  if (token) {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
  } else {
    localStorage.removeItem(AUTH_TOKEN_KEY);
  }
}

/**
 * Get active cellar ID.
 * @returns {string|null}
 */
export function getActiveCellarId() {
  return localStorage.getItem(ACTIVE_CELLAR_KEY);
}

/**
 * Store active cellar ID.
 * @param {string|null} cellarId
 */
export function setActiveCellarId(cellarId) {
  if (cellarId) {
    localStorage.setItem(ACTIVE_CELLAR_KEY, cellarId);
  } else {
    localStorage.removeItem(ACTIVE_CELLAR_KEY);
  }
}

/**
 * Get invite code (for first-time signup).
 * @returns {string|null}
 */
export function getInviteCode() {
  return localStorage.getItem(INVITE_CODE_KEY);
}

/**
 * Store invite code.
 * @param {string|null} code
 */
export function setInviteCode(code) {
  if (code) {
    localStorage.setItem(INVITE_CODE_KEY, code);
  } else {
    localStorage.removeItem(INVITE_CODE_KEY);
  }
}

/**
 * Clear all auth-related local storage.
 */
export function clearAuthState() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(ACTIVE_CELLAR_KEY);
  localStorage.removeItem(INVITE_CODE_KEY);
}

const baseFetch = window.fetch.bind(window);

/**
 * Fetch wrapper that attaches auth + cellar headers.
 * @param {string} url
 * @param {RequestInit} options
 * @returns {Promise<Response>}
 */
async function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = getAccessToken();
  const cellarId = getActiveCellarId();
  const inviteCode = getInviteCode();

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  if (cellarId) {
    headers.set('X-Cellar-ID', cellarId);
  }

  if (inviteCode) {
    headers.set('X-Invite-Code', inviteCode);
  }

  const hasBody = Object.prototype.hasOwnProperty.call(options, 'body');
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  if (hasBody && options.body && !isFormData && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await baseFetch(url, { ...options, headers });

  if (response.status === 401 && typeof authErrorHandler === 'function') {
    authErrorHandler();
  }

  return response;
}

// Shadow global fetch in this module with auth-aware wrapper
const fetch = apiFetch;

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
      // Handle both string and object error formats
      // Object format: { error: { code, message, details } } (from validation middleware)
      // String format: { error: "message" }
      let errorMessage = defaultError;
      if (typeof data.error === 'string') {
        errorMessage = data.error;
      } else if (data.error?.message) {
        // Structured error from validation middleware
        errorMessage = data.error.message;
        if (data.error.details?.length) {
          // Include first validation issue for context
          const firstIssue = data.error.details[0];
          errorMessage += `: ${firstIssue.field} ${firstIssue.message}`;
        }
      }
      throw new Error(errorMessage);
    } catch (e) {
      // If it's already our error, rethrow it
      if (e instanceof Error && e.message !== 'Unexpected end of JSON input') {
        throw e;
      }
      // If JSON parsing fails, use status text
      throw new Error(res.statusText || defaultError);
    }
  }

  // Handle empty responses
  const text = await res.text();
  if (!text) {
    // Empty response body - return empty object
    return {};
  }

  try {
    return JSON.parse(text);
  } catch (_e) {
    console.error('Failed to parse response:', text.slice(0, 100));
    throw new Error('Invalid server response');
  }
}

/**
 * Get current user profile.
 * @returns {Promise<Object>}
 */
export async function getProfile() {
  const res = await fetch(`${API_BASE}/api/profile`);
  return handleResponse(res, 'Failed to fetch profile');
}

/**
 * Get all cellars for the current user.
 * @returns {Promise<Object>}
 */
export async function getCellars() {
  const res = await fetch(`${API_BASE}/api/cellars`);
  return handleResponse(res, 'Failed to fetch cellars');
}

/**
 * Set the active cellar for the current user.
 * @param {string} cellarId
 * @returns {Promise<Object>}
 */
export async function setActiveCellar(cellarId) {
  const res = await fetch(`${API_BASE}/api/cellars/active`, {
    method: 'POST',
    body: JSON.stringify({ cellar_id: cellarId })
  });
  return handleResponse(res, 'Failed to set active cellar');
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
 * Get personal rating for a wine.
 * @param {number} wineId - Wine ID
 * @returns {Promise<Object>}
 */
export async function getPersonalRating(wineId) {
  const res = await fetch(`${API_BASE}/api/wines/${wineId}/personal-rating`);
  return handleResponse(res, 'Failed to fetch personal rating');
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
 * Record chosen wine for a pairing session.
 * @param {string} sessionId - Pairing session ID
 * @param {number} wineId - Wine ID
 * @param {number} rank - Recommendation rank
 * @returns {Promise<Object>}
 */
export async function choosePairingWine(sessionId, wineId, rank) {
  const res = await fetch(`${API_BASE}/api/pairing/sessions/${sessionId}/choose`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wineId, rank })
  });
  return handleResponse(res, 'Failed to record wine choice');
}

/**
 * Submit feedback for a pairing session.
 * @param {string} sessionId - Pairing session ID
 * @param {Object} data - Feedback payload
 * @returns {Promise<Object>}
 */
export async function submitPairingFeedback(sessionId, data) {
  const res = await fetch(`${API_BASE}/api/pairing/sessions/${sessionId}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return handleResponse(res, 'Failed to submit pairing feedback');
}

/**
 * Send follow-up message to sommelier chat.
 * @param {string} chatId - Chat session ID from askSommelier response
 * @param {string} message - Follow-up question/message
 * @returns {Promise<Object>}
 */
export async function sommelierChat(chatId, message) {
  const res = await fetch(`${API_BASE}/api/pairing/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId, message })
  });
  return handleResponse(res, 'Chat request failed');
}

/**
 * Clear sommelier chat session.
 * @param {string} chatId - Chat session ID
 * @returns {Promise<Object>}
 */
export async function clearSommelierChat(chatId) {
  const res = await fetch(`${API_BASE}/api/pairing/chat/${chatId}`, {
    method: 'DELETE'
  });
  return handleResponse(res, 'Failed to clear chat');
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

// ============================================
// Cellar Zone Management API
// ============================================

/**
 * Get all zone definitions.
 * @returns {Promise<Object>}
 */
export async function getCellarZones() {
  const res = await fetch(`${API_BASE}/api/cellar/zones`);
  return handleResponse(res, 'Failed to fetch zones');
}

/**
 * Get current zone → row mapping.
 * @returns {Promise<Object>}
 */
export async function getZoneMap() {
  const res = await fetch(`${API_BASE}/api/cellar/zone-map`);
  return handleResponse(res, 'Failed to fetch zone map');
}

/**
 * Get placement suggestion for a wine.
 * @param {number} wineId - Wine ID
 * @returns {Promise<Object>}
 */
export async function getSuggestedPlacement(wineId) {
  const res = await fetch(`${API_BASE}/api/cellar/suggest-placement/${wineId}`);
  return handleResponse(res, 'Failed to get placement suggestion');
}

/**
 * Get placement suggestion for a new wine (not yet in DB).
 * @param {Object} wine - Wine details
 * @returns {Promise<Object>}
 */
export async function suggestPlacement(wine) {
  const res = await fetch(`${API_BASE}/api/cellar/suggest-placement`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wine })
  });
  return handleResponse(res, 'Failed to get placement suggestion');
}

/**
 * Get full cellar analysis.
 * @param {boolean} [forceRefresh=false] - Force fresh analysis ignoring cache
 * @returns {Promise<Object>}
 */
export async function analyseCellar(forceRefresh = false, options = {}) {
  const { allowFallback = false } = options;
  const params = new URLSearchParams();
  if (forceRefresh) params.set('refresh', 'true');
  if (allowFallback) params.set('allowFallback', 'true');
  const qs = params.toString();
  const url = qs
    ? `${API_BASE}/api/cellar/analyse?${qs}`
    : `${API_BASE}/api/cellar/analyse`;
  const res = await fetch(url);
  return handleResponse(res, 'Failed to analyse cellar');
}

/**
 * Get AI advice for a zone capacity issue.
 * @param {Object} payload
 * @returns {Promise<Object>}
 */
export async function getZoneCapacityAdvice(payload) {
  const res = await fetch(`${API_BASE}/api/cellar/zone-capacity-advice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return handleResponse(res, 'Failed to get zone capacity advice');
}

/**
 * Allocate a new row to a zone.
 * @param {string} zoneId
 * @returns {Promise<Object>}
 */
export async function allocateZoneRow(zoneId) {
  const res = await fetch(`${API_BASE}/api/cellar/zones/allocate-row`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ zoneId })
  });
  return handleResponse(res, 'Failed to allocate row to zone');
}

/**
 * Merge one zone into another.
 * @param {string} sourceZoneId
 * @param {string} targetZoneId
 * @returns {Promise<Object>}
 */
export async function mergeZones(sourceZoneId, targetZoneId) {
  const res = await fetch(`${API_BASE}/api/cellar/zones/merge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceZoneId, targetZoneId })
  });
  return handleResponse(res, 'Failed to merge zones');
}

/**
 * Generate a holistic reconfiguration plan.
 * @param {{includeRetirements?: boolean, includeNewZones?: boolean, stabilityBias?: 'low'|'moderate'|'high'}} options
 * @returns {Promise<Object>}
 */
export async function getReconfigurationPlan(options = {}) {
  const res = await fetch(`${API_BASE}/api/cellar/reconfiguration-plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options)
  });
  return handleResponse(res, 'Failed to generate reconfiguration plan');
}

/**
 * Apply a previously generated reconfiguration plan.
 * @param {string} planId
 * @param {number[]} [skipActions]
 * @returns {Promise<Object>}
 */
export async function applyReconfigurationPlan(planId, skipActions = []) {
  const res = await fetch(`${API_BASE}/api/cellar/reconfiguration-plan/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ planId, skipActions })
  });
  return handleResponse(res, 'Failed to apply reconfiguration plan');
}

/**
 * Undo an applied reconfiguration.
 * @param {number} reconfigurationId
 * @returns {Promise<Object>}
 */
export async function undoReconfiguration(reconfigurationId) {
  const res = await fetch(`${API_BASE}/api/cellar/reconfiguration/${reconfigurationId}/undo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  return handleResponse(res, 'Failed to undo reconfiguration');
}

/**
 * Get AI-enhanced cellar analysis.
 * AI analysis can take 60-120 seconds, so we use a long timeout.
 * @returns {Promise<Object>}
 */
export async function analyseCellarAI() {
  // Use cache: 'no-store' to bypass service worker caching
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 180000); // 3 minute timeout

  try {
    const res = await fetch(`${API_BASE}/api/cellar/analyse/ai`, {
      cache: 'no-store',
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return handleResponse(res, 'Failed to get AI analysis');
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('AI analysis timed out. Please try again.');
    }
    throw err;
  }
}

/**
 * Execute wine moves.
 * @param {Array} moves - Array of {wineId, from, to, zoneId}
 * @returns {Promise<Object>}
 */
export async function executeCellarMoves(moves) {
  const res = await fetch(`${API_BASE}/api/cellar/execute-moves`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ moves })
  });
  return handleResponse(res, 'Failed to execute moves');
}

/**
 * Manually assign a wine to a zone.
 * @param {number} wineId - Wine ID
 * @param {string} zoneId - Zone ID
 * @returns {Promise<Object>}
 */
export async function assignWineToZone(wineId, zoneId) {
  const res = await fetch(`${API_BASE}/api/cellar/assign-zone`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wineId, zoneId, confidence: 'manual' })
  });
  return handleResponse(res, 'Failed to assign zone');
}

/**
 * Get suggested moves to organize fridge by category.
 * @returns {Promise<Object>}
 */
export async function getFridgeOrganization() {
  const res = await fetch(`${API_BASE}/api/cellar/fridge-organize`);
  return handleResponse(res, 'Failed to get fridge organization');
}

/**
 * Get proposed zone layout based on collection.
 * @returns {Promise<Object>}
 */
export async function getZoneLayoutProposal() {
  const res = await fetch(`${API_BASE}/api/cellar/zone-layout/propose`);
  return handleResponse(res, 'Failed to get zone layout proposal');
}

/**
 * Get current saved zone layout.
 * @returns {Promise<Object>}
 */
export async function getZoneLayout() {
  const res = await fetch(`${API_BASE}/api/cellar/zone-layout`);
  return handleResponse(res, 'Failed to get zone layout');
}

/**
 * Confirm and save zone layout.
 * @param {Array} assignments - Array of { zoneId, assignedRows, bottleCount }
 * @returns {Promise<Object>}
 */
export async function confirmZoneLayout(assignments) {
  const res = await fetch(`${API_BASE}/api/cellar/zone-layout/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assignments })
  });
  return handleResponse(res, 'Failed to confirm zone layout');
}

/**
 * Get consolidation moves for confirmed zone layout.
 * @returns {Promise<Object>}
 */
export async function getConsolidationMoves() {
  const res = await fetch(`${API_BASE}/api/cellar/zone-layout/moves`);
  return handleResponse(res, 'Failed to get consolidation moves');
}

/**
 * Send zone classification chat message.
 * @param {string} message - User message
 * @param {Object} context - Previous chat context
 * @returns {Promise<Object>} AI response
 */
export async function zoneChatMessage(message, context = null) {
  const res = await fetch(`${API_BASE}/api/cellar/zone-chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, context })
  });
  return handleResponse(res, 'Failed to send zone chat message');
}

/**
 * Reassign a wine to a different zone.
 * @param {number} wineId - Wine ID
 * @param {string} newZoneId - New zone ID
 * @param {string} reason - Reason for reassignment
 * @returns {Promise<Object>}
 */
export async function reassignWineZone(wineId, newZoneId, reason = '') {
  const res = await fetch(`${API_BASE}/api/cellar/zone-reassign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wineId, newZoneId, reason })
  });
  return handleResponse(res, 'Failed to reassign wine zone');
}

// ============================================
// Awards Database API
// ============================================

/**
 * Get all known competitions.
 * @returns {Promise<Object>}
 */
export async function getAwardsCompetitions() {
  const res = await fetch(`${API_BASE}/api/awards/competitions`);
  return handleResponse(res, 'Failed to fetch competitions');
}

/**
 * Create a custom awards competition.
 * @param {Object} data - Competition data
 * @param {string} data.id - Competition ID
 * @param {string} data.name - Competition name
 * @returns {Promise<Object>}
 */
export async function createAwardsCompetition(data) {
  const res = await fetch(`${API_BASE}/api/awards/competitions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return handleResponse(res, 'Failed to add competition');
}

/**
 * Get all award sources.
 * @returns {Promise<Object>}
 */
export async function getAwardsSources() {
  const res = await fetch(`${API_BASE}/api/awards/sources`);
  return handleResponse(res, 'Failed to fetch award sources');
}

/**
 * Get awards for a specific source.
 * @param {string} sourceId - Source ID
 * @returns {Promise<Object>}
 */
export async function getSourceAwards(sourceId) {
  const res = await fetch(`${API_BASE}/api/awards/sources/${encodeURIComponent(sourceId)}`);
  return handleResponse(res, 'Failed to fetch source awards');
}

/**
 * Import awards from a webpage.
 * @param {string} url - Webpage URL
 * @param {string} competitionId - Competition ID
 * @param {number} year - Competition year
 * @returns {Promise<Object>}
 */
export async function importAwardsFromWebpage(url, competitionId, year) {
  const res = await fetch(`${API_BASE}/api/awards/import/webpage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, competitionId, year })
  });
  return handleResponse(res, 'Failed to import awards from webpage');
}

/**
 * Import awards from a PDF file.
 * @param {File} pdfFile - PDF file
 * @param {string} competitionId - Competition ID
 * @param {number} year - Competition year
 * @returns {Promise<Object>}
 */
export async function importAwardsFromPDF(pdfFile, competitionId, year) {
  const formData = new FormData();
  formData.append('pdf', pdfFile);
  formData.append('competitionId', competitionId);
  formData.append('year', year);

  const res = await fetch(`${API_BASE}/api/awards/import/pdf`, {
    method: 'POST',
    body: formData
  });
  return handleResponse(res, 'Failed to import awards from PDF');
}

/**
 * Import awards from pasted text.
 * @param {string} text - Text content
 * @param {string} competitionId - Competition ID
 * @param {number} year - Competition year
 * @param {string} sourceType - Source type (manual, csv, magazine)
 * @returns {Promise<Object>}
 */
export async function importAwardsFromText(text, competitionId, year, sourceType = 'manual') {
  const res = await fetch(`${API_BASE}/api/awards/import/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, competitionId, year, sourceType })
  });
  return handleResponse(res, 'Failed to import awards from text');
}

/**
 * Delete an award source.
 * @param {string} sourceId - Source ID
 * @returns {Promise<Object>}
 */
export async function deleteAwardsSource(sourceId) {
  const res = await fetch(`${API_BASE}/api/awards/sources/${encodeURIComponent(sourceId)}`, {
    method: 'DELETE'
  });
  return handleResponse(res, 'Failed to delete source');
}

/**
 * Re-run matching for a source.
 * @param {string} sourceId - Source ID
 * @returns {Promise<Object>}
 */
export async function rematchAwardsSource(sourceId) {
  const res = await fetch(`${API_BASE}/api/awards/sources/${encodeURIComponent(sourceId)}/match`, {
    method: 'POST'
  });
  return handleResponse(res, 'Failed to rematch awards');
}

/**
 * Link an award to a wine.
 * @param {number} awardId - Award ID
 * @param {number} wineId - Wine ID
 * @returns {Promise<Object>}
 */
export async function linkAwardToWine(awardId, wineId) {
  const res = await fetch(`${API_BASE}/api/awards/${awardId}/link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wineId })
  });
  return handleResponse(res, 'Failed to link award');
}

/**
 * Get awards for a wine.
 * @param {number} wineId - Wine ID
 * @returns {Promise<Object>}
 */
export async function getWineAwards(wineId) {
  const res = await fetch(`${API_BASE}/api/awards/wine/${wineId}`);
  return handleResponse(res, 'Failed to fetch wine awards');
}

// ============================================
// Wine Confirmation Search API (Vivino)
// ============================================

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

// ============================================
// Serving Temperature API
// ============================================

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

// ============================================
// Tasting Notes API
// ============================================

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

// ============================================
// Acquisition Workflow API
// ============================================

/**
 * Parse wine from image with per-field confidence.
 * @param {string} base64Image - Base64 encoded image
 * @param {string} mediaType - MIME type
 * @returns {Promise<Object>} Parsed wines with confidence data
 */
export async function parseWineImageWithConfidence(base64Image, mediaType) {
  const res = await fetch(`${API_BASE}/api/acquisition/parse-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: base64Image, mediaType })
  });
  return handleResponse(res, 'Failed to parse image');
}

/**
 * Get placement suggestion for a wine.
 * @param {Object} wine - Wine data
 * @returns {Promise<Object>} Placement suggestions
 */
export async function getAcquisitionPlacement(wine) {
  const res = await fetch(`${API_BASE}/api/acquisition/suggest-placement`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wine })
  });
  return handleResponse(res, 'Failed to get placement suggestion');
}

/**
 * Enrich wine with ratings and drinking windows.
 * @param {Object} wine - Wine data
 * @returns {Promise<Object>} Enrichment data
 */
export async function enrichWine(wine) {
  const res = await fetch(`${API_BASE}/api/acquisition/enrich`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wine })
  });
  return handleResponse(res, 'Failed to enrich wine');
}

/**
 * Run complete acquisition workflow.
 * @param {Object} options - Workflow options
 * @returns {Promise<Object>} Workflow result
 */
export async function runAcquisitionWorkflow(options) {
  const res = await fetch(`${API_BASE}/api/acquisition/workflow`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options)
  });
  return handleResponse(res, 'Acquisition workflow failed');
}

/**
 * Save wine from acquisition workflow.
 * @param {Object} wine - Wine data
 * @param {Object} options - Save options (slot, quantity, addToFridge)
 * @returns {Promise<Object>} Save result
 */
export async function saveAcquiredWine(wine, options = {}) {
  const res = await fetch(`${API_BASE}/api/acquisition/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wine, ...options })
  });
  return handleResponse(res, 'Failed to save wine');
}

/**
 * Get confidence level definitions.
 * @returns {Promise<Object>} Confidence levels
 */
export async function getConfidenceLevels() {
  const res = await fetch(`${API_BASE}/api/acquisition/confidence-levels`);
  return handleResponse(res, 'Failed to get confidence levels');
}

// ============================================
// Palate Profile API
// ============================================

/**
 * Record consumption feedback for a wine.
 * @param {Object} feedback - Feedback data
 * @returns {Promise<Object>}
 */
export async function recordFeedback(feedback) {
  const res = await fetch(`${API_BASE}/api/palate/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(feedback)
  });
  return handleResponse(res, 'Failed to record feedback');
}

/**
 * Get feedback for a wine.
 * @param {number} wineId - Wine ID
 * @returns {Promise<Object>}
 */
export async function getWineFeedback(wineId) {
  const res = await fetch(`${API_BASE}/api/palate/feedback/${wineId}`);
  return handleResponse(res, 'Failed to get feedback');
}

/**
 * Get palate profile.
 * @returns {Promise<Object>}
 */
export async function getPalateProfile() {
  const res = await fetch(`${API_BASE}/api/palate/profile`);
  return handleResponse(res, 'Failed to get palate profile');
}

/**
 * Get personalized score for a wine.
 * @param {number} wineId - Wine ID
 * @returns {Promise<Object>}
 */
export async function getPersonalizedScore(wineId) {
  const res = await fetch(`${API_BASE}/api/palate/score/${wineId}`);
  return handleResponse(res, 'Failed to get personalized score');
}

/**
 * Get personalized wine recommendations.
 * @param {number} [limit=10] - Max recommendations
 * @returns {Promise<Object>}
 */
export async function getPersonalizedRecommendations(limit = 10) {
  const res = await fetch(`${API_BASE}/api/palate/recommendations?limit=${limit}`);
  return handleResponse(res, 'Failed to get recommendations');
}

/**
 * Get available food tags for pairing feedback.
 * @returns {Promise<Object>}
 */
export async function getFoodTags() {
  const res = await fetch(`${API_BASE}/api/palate/food-tags`);
  return handleResponse(res, 'Failed to get food tags');
}

/**
 * Get available occasion types.
 * @returns {Promise<Object>}
 */
export async function getOccasionTypes() {
  const res = await fetch(`${API_BASE}/api/palate/occasions`);
  return handleResponse(res, 'Failed to get occasion types');
}

// ============================================
// Cellar Health Dashboard API
// ============================================

/**
 * Get full cellar health report.
 * @returns {Promise<Object>} Health report with metrics, alerts, and actions
 */
export async function getCellarHealth() {
  const res = await fetch(`${API_BASE}/api/health`);
  return handleResponse(res, 'Failed to get cellar health');
}

/**
 * Get health score only.
 * @returns {Promise<Object>} Health score and breakdown
 */
export async function getCellarHealthScore() {
  const res = await fetch(`${API_BASE}/api/health/score`);
  return handleResponse(res, 'Failed to get health score');
}

/**
 * Get health alerts only.
 * @returns {Promise<Object>} Active alerts
 */
export async function getCellarHealthAlerts() {
  const res = await fetch(`${API_BASE}/api/health/alerts`);
  return handleResponse(res, 'Failed to get health alerts');
}

/**
 * Get at-risk wines (approaching or past drinking windows).
 * @param {number} [limit=20] - Max wines to return
 * @returns {Promise<Object>} At-risk wines list
 */
export async function getAtRiskWines(limit = 20) {
  const res = await fetch(`${API_BASE}/api/health/at-risk?limit=${limit}`);
  return handleResponse(res, 'Failed to get at-risk wines');
}

/**
 * Execute fill fridge action - move ready-to-drink wines to fridge.
 * @param {number} [maxMoves=5] - Maximum wines to move
 * @returns {Promise<Object>} Moves executed
 */
export async function executeFillFridge(maxMoves = 5) {
  const res = await fetch(`${API_BASE}/api/health/fill-fridge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ maxMoves })
  });
  return handleResponse(res, 'Failed to fill fridge');
}

/**
 * Generate shopping list based on cellar gaps.
 * @returns {Promise<Object>} Shopping suggestions
 */
export async function generateShoppingList() {
  const res = await fetch(`${API_BASE}/api/health/shopping-list`);
  return handleResponse(res, 'Failed to generate shopping list');
}

/**
 * Get backup metadata (counts for UI display).
 * @returns {Promise<Object>} Backup info with wine/slot/history counts
 */
export async function getBackupInfo() {
  const res = await fetch(`${API_BASE}/api/backup/info`);
  return handleResponse(res, 'Failed to get backup info');
}

/**
 * Export cellar data as JSON and trigger download.
 * @returns {Promise<void>}
 */
export async function exportBackupJSON() {
  const res = await fetch(`${API_BASE}/api/backup/export/json`);
  if (!res.ok) {
    throw new Error('Failed to export backup');
  }
  const blob = await res.blob();
  const filename = res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1]
    || `cellar-backup-${new Date().toISOString().split('T')[0]}.json`;
  downloadBlob(blob, filename);
}

/**
 * Export wine list as CSV and trigger download.
 * @returns {Promise<void>}
 */
export async function exportBackupCSV() {
  const res = await fetch(`${API_BASE}/api/backup/export/csv`);
  if (!res.ok) {
    throw new Error('Failed to export CSV');
  }
  const blob = await res.blob();
  const filename = res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1]
    || `wine-list-${new Date().toISOString().split('T')[0]}.csv`;
  downloadBlob(blob, filename);
}

/**
 * Import cellar data from backup.
 * @param {Object} backup - Backup payload
 * @param {Object} options - Import options
 * @returns {Promise<Object>}
 */
export async function importBackup(backup, options = {}) {
  const res = await fetch(`${API_BASE}/api/backup/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ backup, options })
  });
  return handleResponse(res, 'Failed to import backup');
}

/**
 * Log a client error to the server (optional auth).
 * @param {Object} payload - Error payload
 * @param {string} payload.context
 * @param {string} payload.message
 * @param {string} [payload.stack]
 * @param {string} [payload.userAgent]
 * @param {string} [payload.url]
 * @returns {Promise<Object>}
 */
export async function logClientError(payload) {
  const res = await fetch(`${API_BASE}/api/errors/log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return handleResponse(res, 'Failed to log error');
}

/**
 * Helper to trigger file download from blob.
 * @param {Blob} blob - File blob
 * @param {string} filename - Download filename
 */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
