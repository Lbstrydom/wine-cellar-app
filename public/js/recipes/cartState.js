/**
 * @fileoverview Cart state management for buying guide items.
 * Holds items, summary, and loading state. Provides reactive updates.
 * @module recipes/cartState
 */

import {
  listCartItems,
  getCartSummary,
  createCartItem,
  updateCartItem,
  updateCartItemStatus,
  deleteCartItem,
  batchUpdateStatus,
  arriveItem as apiArriveItem,
  convertToCellar as apiConvertToCellar
} from '../api/buyingGuideItems.js';

/** @type {{ items: Array, summary: Object, total: number, loading: boolean }} */
const state = {
  items: [],
  summary: { counts: {}, totals: {} },
  total: 0,
  loading: false
};

/** @type {Set<Function>} */
const listeners = new Set();

/**
 * Subscribe to state changes.
 * @param {Function} fn - Listener called with current state
 * @returns {Function} Unsubscribe function
 */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Notify all listeners of state change. */
function notify() {
  const snapshot = getCartState();
  for (const fn of listeners) {
    try { fn(snapshot); } catch (_) { /* swallow listener errors */ }
  }
}

/**
 * Get a snapshot of current cart state.
 * @returns {{ items: Array, summary: Object, total: number, loading: boolean }}
 */
export function getCartState() {
  return {
    items: state.items,
    summary: state.summary,
    total: state.total,
    loading: state.loading
  };
}

/**
 * Load cart items + summary from server.
 * @param {Object} [filters] - Optional filters (status, style_id)
 */
export async function loadCart(filters = {}) {
  state.loading = true;
  notify();

  try {
    const [itemsResult, summaryResult] = await Promise.all([
      listCartItems(filters),
      getCartSummary()
    ]);

    state.items = itemsResult.data?.items || [];
    state.total = itemsResult.data?.total || 0;
    state.summary = summaryResult.data || { counts: {}, totals: {} };
  } catch (err) {
    console.error('[cartState] load failed:', err);
  } finally {
    state.loading = false;
    notify();
  }
}

/**
 * Refresh only the summary (lighter than full reload).
 */
export async function refreshSummary() {
  try {
    const result = await getCartSummary();
    state.summary = result.data || { counts: {}, totals: {} };
    notify();
  } catch (err) {
    console.error('[cartState] summary refresh failed:', err);
  }
}

/**
 * Add an item with optimistic insert.
 * @param {Object} data - Item data
 * @returns {Promise<Object>} Created item
 */
export async function addItem(data) {
  const result = await createCartItem(data);
  const item = result.data;
  if (item) {
    state.items.unshift(item);
    state.total++;
    notify();
    // Refresh summary in background for updated totals
    refreshSummary();
  }
  return item;
}

/**
 * Update an existing item.
 * @param {number} id - Item ID
 * @param {Object} data - Fields to update
 * @returns {Promise<Object|null>} Updated item
 */
export async function editItem(id, data) {
  const result = await updateCartItem(id, data);
  const updated = result.data;
  if (updated) {
    const idx = state.items.findIndex(i => i.id === id);
    if (idx >= 0) state.items[idx] = updated;
    notify();
  }
  return updated;
}

/**
 * Transition an item's status.
 * @param {number} id - Item ID
 * @param {string} status - Target status
 * @returns {Promise<Object|null>} Updated item
 */
export async function transitionStatus(id, status) {
  const result = await updateCartItemStatus(id, status);
  const updated = result.data;
  if (updated) {
    const idx = state.items.findIndex(i => i.id === id);
    if (idx >= 0) state.items[idx] = updated;
    notify();
    refreshSummary();
  }
  return updated;
}

/**
 * Remove an item.
 * @param {number} id - Item ID
 * @returns {Promise<boolean>}
 */
export async function removeItem(id) {
  await deleteCartItem(id);
  state.items = state.items.filter(i => i.id !== id);
  state.total = Math.max(0, state.total - 1);
  notify();
  refreshSummary();
  return true;
}

/**
 * Batch transition status for selected items.
 * @param {number[]} ids - Item IDs
 * @param {string} status - Target status
 * @returns {Promise<{updated: number, skipped: Array}>}
 */
export async function batchTransition(ids, status) {
  const result = await batchUpdateStatus(ids, status);
  // Reload full list to get accurate state
  await loadCart();
  return result.data;
}

/**
 * Mark an item as arrived + get placement suggestion.
 * @param {number} id - Item ID
 * @returns {Promise<{item: Object, placement: Object|null}>}
 */
export async function arriveItem(id) {
  const result = await apiArriveItem(id);
  const data = result.data;
  if (data?.item) {
    const idx = state.items.findIndex(i => i.id === id);
    if (idx >= 0) state.items[idx] = data.item;
    notify();
    refreshSummary();
  }
  return data;
}

/**
 * Convert an arrived item to a cellar wine.
 * @param {number} id - Item ID
 * @param {Object} [body] - Optional { confirmed, convertQuantity }
 * @returns {Promise<Object>} Conversion result or partial confirmation prompt
 */
export async function convertToCellar(id, body = {}) {
  const result = await apiConvertToCellar(id, body);
  const data = result.data;
  // If partial confirmation needed, return without state update
  if (data?.requiresConfirmation) return data;
  // Successful conversion — reload for accurate state
  await loadCart();
  return data;
}
