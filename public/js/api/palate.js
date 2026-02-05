/**
 * @fileoverview Palate profile and feedback API calls.
 * @module api/palate
 */

import { API_BASE, apiFetch, handleResponse } from './base.js';

const fetch = apiFetch;

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
