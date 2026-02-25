/**
 * @fileoverview API infrastructure: auth state, apiFetch wrapper, response handling.
 * @module api/base
 */

export const API_BASE = '';
export const AUTH_TOKEN_KEY = 'access_token';
export const ACTIVE_CELLAR_KEY = 'active_cellar_id';
export const INVITE_CODE_KEY = 'invite_code';

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
export async function apiFetch(url, options = {}) {
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
export const fetch = apiFetch;

/**
 * Handle API response with error checking.
 * @param {Response} res - Fetch response
 * @param {string} defaultError - Default error message
 * @returns {Promise<Object>}
 * @throws {Error} If response is not ok
 */
export async function handleResponse(res, defaultError = 'Request failed') {
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
      const error = new Error(errorMessage);
      // Attach structured data for callers that need rich error details
      if (data.validation) error.validation = data.validation;
      if (data.phase) error.phase = data.phase;
      if (data.moveCount != null) error.moveCount = data.moveCount;
      if (data.stateConflict) error.stateConflict = true;
      if (data.slotSnapshot) error.slotSnapshot = data.slotSnapshot;
      if (data.revalErrors) error.revalErrors = data.revalErrors;
      if (data.pgCode) error.pgCode = data.pgCode;
      if (data.constraint) error.constraint = data.constraint;
      error.status = res.status;
      throw error;
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
 * Helper to trigger file download from blob.
 * @param {Blob} blob - File blob
 * @param {string} filename - Download filename
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
