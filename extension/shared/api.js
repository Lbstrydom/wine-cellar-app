/**
 * @fileoverview Typed API client for the Wine Cellar backend.
 * Used as an ES module by popup.js and settings.js.
 *
 * All calls add Authorization + X-Cellar-ID headers automatically.
 * Throws { message: 'AUTH_EXPIRED' } on 401 so callers can sign out gracefully.
 */

const API_BASE = 'https://cellar.creathyst.com/api';

/**
 * Make an authenticated API request.
 * @param {string} path - e.g. '/buying-guide-items/gaps'
 * @param {RequestInit} options - fetch options
 * @param {{ token: string, cellarId?: string|null }} auth
 * @returns {Promise<any>}
 */
async function apiFetch(path, options = {}, auth) {
  if (!auth?.token) throw new Error('Not authenticated');

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${auth.token}`,
    ...(auth.cellarId ? { 'X-Cellar-ID': auth.cellarId } : {}),
    ...(options.headers || {})
  };

  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (response.status === 401) throw new Error('AUTH_EXPIRED');

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Get all cellars the authenticated user belongs to.
 * Does NOT require X-Cellar-ID header — the backend accepts any authenticated call.
 * @param {{ token: string }} auth
 * @returns {Promise<{ data: Array<{ id: string, name: string, role: string }> }>}
 */
export async function getCellars(auth) {
  // Omit cellarId so the X-Cellar-ID header is not sent — endpoint is header-free
  return apiFetch('/cellars', {}, { token: auth.token, cellarId: null });
}

/**
 * Get the buying gap summary (projected coverage, top gaps).
 * Result is server-side cached (1 h TTL) so this is fast enough for popup open.
 * @param {{ token: string, cellarId: string }} auth
 * @returns {Promise<{ data: { gaps: any[], coveragePct: number, projectedCoveragePct: number } }>}
 */
export async function getGaps(auth) {
  return apiFetch('/buying-guide-items/gaps', {}, auth);
}

/**
 * Infer the style bucket for a wine name / producer.
 * @param {{ wine_name: string, producer?: string, colour?: string, grapes?: string }} wine
 * @param {{ token: string, cellarId: string }} auth
 * @returns {Promise<{ data: { styleId: string, confidence: string, label: string } }>}
 */
export async function inferStyle(wine, auth) {
  return apiFetch('/buying-guide-items/infer-style', {
    method: 'POST',
    body: JSON.stringify(wine)
  }, auth);
}

/**
 * Add a wine to the buying plan.
 * @param {{
 *   wine_name: string, producer?: string|null, vintage?: number|null,
 *   price?: number|null, currency?: string, vendor_url?: string,
 *   style_id?: string|null, source_gap_style?: string|null
 * }} item
 * @param {{ token: string, cellarId: string }} auth
 * @returns {Promise<{ data: { id: number }, message: string }>}
 */
export async function addToPlan(item, auth) {
  return apiFetch('/buying-guide-items', {
    method: 'POST',
    body: JSON.stringify({ ...item, source: 'extension' })
  }, auth);
}
