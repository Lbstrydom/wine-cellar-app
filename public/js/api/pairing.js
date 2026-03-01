/**
 * @fileoverview Sommelier and pairing API calls.
 * @module api/pairing
 */

import { API_BASE, apiFetch, handleResponse } from './base.js';

const fetch = apiFetch;

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
 * Create a manual (user-initiated) pairing session.
 * @param {number} wineId - Wine to pair
 * @param {string} dish - Dish description
 * @param {number} [recipeId] - Recipe ID if from recipe library
 * @returns {Promise<{sessionId: number}>}
 */
export async function createManualPairing(wineId, dish, recipeId) {
  const body = { wineId, dish };
  if (recipeId) body.recipeId = recipeId;
  const res = await fetch(`${API_BASE}/api/pairing/sessions/manual`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return handleResponse(res, 'Failed to create manual pairing');
}
