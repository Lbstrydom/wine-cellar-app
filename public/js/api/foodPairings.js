/**
 * @fileoverview Food pairings API module.
 * @module api/foodPairings
 */

import { apiFetch, handleResponse } from './base.js';

/**
 * Get all food pairings for a wine (AI-suggested + manual, with user ratings).
 * @param {number} wineId
 * @returns {Promise<{data: Array, count: number}>}
 */
export async function getFoodPairings(wineId) {
  const res = await apiFetch(`/api/wines/${wineId}/food-pairings`);
  return handleResponse(res);
}

/**
 * Rate an existing food pairing.
 * @param {number} wineId
 * @param {number} pairingId
 * @param {number} userRating - 1 to 5
 * @param {string} [notes]
 * @returns {Promise<{message: string, data: Object}>}
 */
export async function rateFoodPairing(wineId, pairingId, userRating, notes) {
  const res = await apiFetch(`/api/wines/${wineId}/food-pairings/${pairingId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_rating: userRating, notes })
  });
  return handleResponse(res);
}

/**
 * Add a manual food pairing for a wine.
 * @param {number} wineId
 * @param {string} pairing - Food description
 * @param {number} [userRating] - Optional 1-5 rating
 * @param {string} [notes]
 * @returns {Promise<{message: string, data: Object}>}
 */
export async function addFoodPairing(wineId, pairing, userRating, notes) {
  const res = await apiFetch(`/api/wines/${wineId}/food-pairings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pairing, user_rating: userRating, notes })
  });
  return handleResponse(res);
}
