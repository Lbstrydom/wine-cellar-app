/**
 * @fileoverview Test helpers for integration tests.
 * Provides utilities for API calls with proper auth headers and cellar context.
 * NOTE: NODE_ENV must be set to 'test' for auth bypass to work.
 *
 * In TEST_MODE, the auth middleware accepts base64-encoded JSON tokens
 * and creates mock profiles, so we don't need to set up real DB records.
 */

// Test user/cellar IDs - these are mock values used for TEST_MODE
const TEST_USER_ID = '00000000-0000-0000-0000-000000000099';
const TEST_CELLAR_ID = '00000000-0000-0000-0000-000000000001';
const TEST_EMAIL = 'test-integration@example.com';

let testToken = null;

/**
 * Set up test auth token for integration tests.
 * In TEST_MODE, the auth middleware accepts any base64-encoded JSON token.
 *
 * @returns {Promise<{userId: string, cellarId: string, token: string}>}
 */
export async function setupTestAuth() {
  if (testToken) {
    return { userId: TEST_USER_ID, cellarId: TEST_CELLAR_ID, token: testToken };
  }

  // Check NODE_ENV to ensure test mode is enabled
  if (process.env.NODE_ENV !== 'test') {
    console.warn('[Test Helper] Warning: NODE_ENV is not "test", auth bypass may not work');
  }

  // Generate a test token (base64-encoded JSON)
  // When NODE_ENV=test, the auth middleware will accept this format
  // and create a mock profile if one doesn't exist in the DB
  testToken = Buffer.from(
    JSON.stringify({ id: TEST_USER_ID, email: TEST_EMAIL })
  ).toString('base64');

  return { userId: TEST_USER_ID, cellarId: TEST_CELLAR_ID, token: testToken };
}

/**
 * Make an authenticated API call with cellar context.
 *
 * @param {string} method - HTTP method (GET, POST, etc.)
 * @param {string} path - API path (without /api prefix)
 * @param {Object} options - Fetch options (body, headers, etc.)
 * @returns {Promise<Response>}
 */
export async function apiCall(method, path, options = {}) {
  const { cellarId, token } = await setupTestAuth();
  const baseUrl = process.env.TEST_API_URL || 'http://localhost:3000/api';
  const url = `${baseUrl}${path.startsWith('/') ? path : '/' + path}`;

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    'X-Cellar-ID': cellarId,
    ...options.headers,
  };

  const fetchOptions = {
    method,
    headers,
    ...options,
  };

  if (options.body) {
    fetchOptions.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  }

  return fetch(url, fetchOptions);
}

/**
 * Clean up test data after tests.
 * Resets the cached token so next test run starts fresh.
 */
export async function cleanupTestAuth() {
  testToken = null;
}
