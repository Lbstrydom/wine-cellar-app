/**
 * Simple in-flight request deduper. Ensures the same keyed operation only runs once
 * at a time and callers share the same promise.
 * @module utils/requestDedup
 */
export function createRequestDeduper() {
  const inFlight = new Map();

  return {
    /**
     * Run an async function keyed by identifier. If a matching call is already in flight,
     * returns the existing promise instead of invoking fn again.
     * @param {string} key - Stable identifier for the request
     * @param {() => Promise<any>} fn - Async function to run
     * @returns {Promise<any>} Shared promise for the keyed operation
     */
    run(key, fn) {
      const existing = inFlight.get(key);
      if (existing) return existing;

      const promise = (async () => {
        try {
          return await fn();
        } finally {
          inFlight.delete(key);
        }
      })();

      inFlight.set(key, promise);
      return promise;
    },

    /**
     * Number of in-flight keys, useful for debugging.
     * @returns {number}
     */
    size() {
      return inFlight.size;
    }
  };
}
