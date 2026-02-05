/**
 * @fileoverview Client error logging API calls.
 * @module api/errors
 */

import { API_BASE, apiFetch, handleResponse } from './base.js';

const fetch = apiFetch;

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
