/**
 * @fileoverview Buying guide cart item API calls.
 * @module api/buyingGuideItems
 */

import { API_BASE, apiFetch, handleResponse } from './base.js';

const fetch = apiFetch;

/**
 * List buying guide items with optional filters.
 * @param {Object} [params] - Query params (status, style_id, limit, offset)
 * @returns {Promise<{data: {items: Array, total: number}}>}
 */
export async function listCartItems(params = {}) {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') query.set(k, v);
  }
  const qs = query.toString();
  const res = await fetch(`${API_BASE}/api/buying-guide-items${qs ? '?' + qs : ''}`);
  return handleResponse(res, 'Failed to load cart items');
}

/**
 * Get cart summary (counts + currency-segmented totals).
 * @returns {Promise<{data: Object}>}
 */
export async function getCartSummary() {
  const res = await fetch(`${API_BASE}/api/buying-guide-items/summary`);
  return handleResponse(res, 'Failed to load cart summary');
}

/**
 * Get gap summary (lightweight, cached).
 * @returns {Promise<{data: Object}>}
 */
export async function getGapSummary() {
  const res = await fetch(`${API_BASE}/api/buying-guide-items/gaps`);
  return handleResponse(res, 'Failed to load gap summary');
}

/**
 * Get a single cart item.
 * @param {number} id - Item ID
 * @returns {Promise<{data: Object}>}
 */
export async function getCartItem(id) {
  const res = await fetch(`${API_BASE}/api/buying-guide-items/${id}`);
  return handleResponse(res, 'Failed to load cart item');
}

/**
 * Create a cart item (auto style inference).
 * @param {Object} data - Item data
 * @returns {Promise<{message: string, data: Object}>}
 */
export async function createCartItem(data) {
  const res = await fetch(`${API_BASE}/api/buying-guide-items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return handleResponse(res, 'Failed to create cart item');
}

/**
 * Update a cart item.
 * @param {number} id - Item ID
 * @param {Object} data - Fields to update
 * @returns {Promise<{message: string, data: Object}>}
 */
export async function updateCartItem(id, data) {
  const res = await fetch(`${API_BASE}/api/buying-guide-items/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return handleResponse(res, 'Failed to update cart item');
}

/**
 * Update item status (state machine validated).
 * @param {number} id - Item ID
 * @param {string} status - Target status
 * @returns {Promise<{message: string, data: Object}>}
 */
export async function updateCartItemStatus(id, status) {
  const res = await fetch(`${API_BASE}/api/buying-guide-items/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status })
  });
  return handleResponse(res, 'Failed to update item status');
}

/**
 * Batch status update.
 * @param {number[]} ids - Item IDs
 * @param {string} status - Target status
 * @returns {Promise<{data: {updated: number, skipped: Array}}>}
 */
export async function batchUpdateStatus(ids, status) {
  const res = await fetch(`${API_BASE}/api/buying-guide-items/batch-status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, status })
  });
  return handleResponse(res, 'Failed to batch update status');
}

/**
 * Delete a cart item.
 * @param {number} id - Item ID
 * @returns {Promise<{message: string}>}
 */
export async function deleteCartItem(id) {
  const res = await fetch(`${API_BASE}/api/buying-guide-items/${id}`, {
    method: 'DELETE'
  });
  return handleResponse(res, 'Failed to delete cart item');
}

/**
 * Infer style for partial wine data.
 * @param {Object} data - { wine_name, producer?, colour?, grapes?, region? }
 * @returns {Promise<{data: {styleId: string|null, confidence: string, label: string|null}}>}
 */
export async function inferStyle(data) {
  const res = await fetch(`${API_BASE}/api/buying-guide-items/infer-style`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return handleResponse(res, 'Failed to infer style');
}

/**
 * Mark item as arrived + get placement suggestion.
 * @param {number} id - Item ID
 * @returns {Promise<{data: {item: Object, placement: Object|null}}>}
 */
export async function arriveItem(id) {
  const res = await fetch(`${API_BASE}/api/buying-guide-items/${id}/arrive`, {
    method: 'POST'
  });
  return handleResponse(res, 'Failed to mark item as arrived');
}

/**
 * Convert arrived item to cellar wine.
 * @param {number} id - Item ID
 * @param {Object} [body] - Optional { confirmed, convertQuantity }
 * @returns {Promise<{data: Object}>}
 */
export async function convertToCellar(id, body = {}) {
  const res = await fetch(`${API_BASE}/api/buying-guide-items/${id}/to-cellar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return handleResponse(res, 'Failed to convert to cellar');
}
