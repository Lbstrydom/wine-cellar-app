/**
 * @fileoverview Restaurant pairing API calls.
 * @module api/restaurantPairing
 */

import { API_BASE, apiFetch, handleResponse } from './base.js';

const fetch = apiFetch;

/**
 * Parse a menu image or text into structured items.
 * Sends one image OR text per call (frontend controls concurrency).
 * @param {Object} payload - Parse request
 * @param {'wine_list'|'dish_menu'} payload.type - Menu section type
 * @param {string|null} [payload.text] - Menu text (mutually exclusive with image)
 * @param {string|null} [payload.image] - Base64-encoded image (mutually exclusive with text)
 * @param {string|null} [payload.mediaType] - MIME type when image is provided
 * @param {AbortSignal} [signal] - Optional abort signal for cancel-on-remove
 * @returns {Promise<Object>} Parsed items with confidence scores
 */
export async function parseMenu(payload, signal) {
  const res = await fetch(`${API_BASE}/api/restaurant-pairing/parse-menu`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal
  });
  return handleResponse(res, 'Menu parsing failed');
}

/**
 * Get wine pairing recommendations for restaurant menu items.
 * @param {Object} payload - Recommendation request
 * @param {Array} payload.wines - Selected wines with id, name, colour, price, by_the_glass
 * @param {Array} payload.dishes - Selected dishes with id, name, description, category
 * @param {string[]} [payload.colour_preferences] - Colour filter
 * @param {number|null} [payload.budget_max] - Max price
 * @param {number|null} [payload.party_size] - Party size (1-20)
 * @param {number|null} [payload.max_bottles] - Max bottles (1-10)
 * @param {boolean} [payload.prefer_by_glass] - Prefer by-the-glass wines
 * @returns {Promise<Object>} Pairings with table wine suggestion
 */
export async function getRecommendations(payload) {
  const res = await fetch(`${API_BASE}/api/restaurant-pairing/recommend`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return handleResponse(res, 'Recommendation request failed');
}

/**
 * Continue a restaurant pairing conversation with a follow-up question.
 * @param {string} chatId - Chat session ID from getRecommendations response
 * @param {string} message - Follow-up question
 * @returns {Promise<Object>} Chat response
 */
export async function restaurantChat(chatId, message) {
  const res = await fetch(`${API_BASE}/api/restaurant-pairing/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId, message })
  });
  return handleResponse(res, 'Chat request failed');
}
