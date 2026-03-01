/**
 * @fileoverview Pending ratings API client.
 * Used by the rating reminder bar to fetch/resolve drink-now-rate-later items.
 * @module api/pendingRatings
 */

import { API_BASE, apiFetch, handleResponse } from './base.js';

const fetch = apiFetch;

/**
 * Get pending ratings (consumed wines awaiting rating).
 * @returns {Promise<{needsRating: Object[], alreadyRated: Object[]}>}
 */
export async function getPendingRatings() {
  const res = await fetch(`${API_BASE}/api/pending-ratings`);
  return handleResponse(res, 'Failed to fetch pending ratings');
}

/**
 * Resolve a single pending rating (rate or dismiss).
 * @param {number} id - Pending rating ID
 * @param {string} status - 'rated' or 'dismissed'
 * @param {number} [rating] - Rating value (1-5), required when status='rated'
 * @param {string} [notes] - Optional notes
 * @returns {Promise<{success: boolean}>}
 */
export async function resolvePendingRating(id, status, rating, notes) {
  const res = await fetch(`${API_BASE}/api/pending-ratings/${id}/resolve`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, rating, notes })
  });
  return handleResponse(res, 'Failed to resolve pending rating');
}

/**
 * Dismiss all pending ratings at once.
 * @returns {Promise<{success: boolean}>}
 */
export async function dismissAllPendingRatings() {
  const res = await fetch(`${API_BASE}/api/pending-ratings/dismiss-all`, {
    method: 'PUT'
  });
  return handleResponse(res, 'Failed to dismiss pending ratings');
}
