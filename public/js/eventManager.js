/**
 * @fileoverview Centralized event listener management for cleanup.
 * Prevents memory leaks by tracking and removing event listeners.
 * @module eventManager
 */

/**
 * Event listener registry.
 * @type {Map<string, Array<{target: EventTarget, event: string, handler: Function, options: any}>>}
 */
const listenerRegistry = new Map();

/**
 * Register an event listener with tracking.
 * @param {string} namespace - Module namespace (e.g., 'grid', 'dragdrop')
 * @param {EventTarget} target - DOM element or other event target
 * @param {string} event - Event type (e.g., 'click', 'dragstart')
 * @param {Function} handler - Event handler function
 * @param {Object} [options] - addEventListener options
 */
export function addTrackedListener(namespace, target, event, handler, options) {
  if (!listenerRegistry.has(namespace)) {
    listenerRegistry.set(namespace, []);
  }

  target.addEventListener(event, handler, options);
  listenerRegistry.get(namespace).push({ target, event, handler, options });
}

/**
 * Remove all event listeners for a namespace.
 * @param {string} namespace - Module namespace to clean up
 */
export function cleanupNamespace(namespace) {
  const listeners = listenerRegistry.get(namespace);
  if (!listeners) return;

  for (const { target, event, handler, options } of listeners) {
    try {
      target.removeEventListener(event, handler, options);
    } catch (_e) {
      // Element may have been removed from DOM
    }
  }

  listenerRegistry.set(namespace, []);
}

/**
 * Clean up all tracked event listeners.
 */
export function cleanupAll() {
  for (const namespace of listenerRegistry.keys()) {
    cleanupNamespace(namespace);
  }
}

/**
 * Get count of registered listeners for a namespace.
 * @param {string} namespace - Module namespace
 * @returns {number} Number of registered listeners
 */
export function getListenerCount(namespace) {
  const listeners = listenerRegistry.get(namespace);
  return listeners ? listeners.length : 0;
}

/**
 * Get total count of all registered listeners.
 * @returns {number} Total listener count
 */
export function getTotalListenerCount() {
  let total = 0;
  for (const listeners of listenerRegistry.values()) {
    total += listeners.length;
  }
  return total;
}

export default {
  addTrackedListener,
  cleanupNamespace,
  cleanupAll,
  getListenerCount,
  getTotalListenerCount
};
