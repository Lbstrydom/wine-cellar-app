/**
 * @fileoverview Circuit breaker pattern for external service calls.
 * Prevents cascading failures when external sources are down.
 * @module services/shared/circuitBreaker
 */

import logger from '../../utils/logger.js';

/**
 * Circuit states.
 */
export const CIRCUIT_STATE = {
  CLOSED: 'closed',     // Normal operation
  OPEN: 'open',         // Failing - reject requests
  HALF_OPEN: 'half_open' // Testing if service recovered
};

/**
 * Configuration options.
 */
const CONFIG = {
  // Number of failures before opening circuit
  failureThreshold: 3,
  // Time to wait before trying again (ms)
  resetTimeoutMs: 60 * 60 * 1000, // 1 hour
  // Extended timeout for repeated failures (ms)
  extendedTimeoutMs: 24 * 60 * 60 * 1000, // 24 hours
  // Number of failures before extended timeout
  extendedThreshold: 5
};

/**
 * Circuit state for each source.
 * @type {Map<string, { state: string, failures: number, lastFailure: number, openUntil: number }>}
 */
const circuitState = new Map();

/**
 * Get or initialize circuit state for a source.
 * @param {string} sourceId - Source identifier
 * @returns {Object} Circuit state
 */
function getState(sourceId) {
  if (!circuitState.has(sourceId)) {
    circuitState.set(sourceId, {
      state: CIRCUIT_STATE.CLOSED,
      failures: 0,
      lastFailure: 0,
      openUntil: 0
    });
  }
  return circuitState.get(sourceId);
}

/**
 * Check if circuit is open (source is failing).
 * @param {string} sourceId - Source identifier
 * @returns {boolean} True if circuit is open (should not attempt)
 */
export function isCircuitOpen(sourceId) {
  const state = getState(sourceId);

  // If closed, circuit is not open
  if (state.state === CIRCUIT_STATE.CLOSED) {
    return false;
  }

  // Check if it's time to transition to half-open
  if (state.state === CIRCUIT_STATE.OPEN && Date.now() >= state.openUntil) {
    state.state = CIRCUIT_STATE.HALF_OPEN;
    logger.info(`[CircuitBreaker] ${sourceId}: transitioning to half-open`);
    return false; // Allow one attempt
  }

  // If open and not expired, circuit is open
  if (state.state === CIRCUIT_STATE.OPEN) {
    return true;
  }

  // Half-open allows attempts
  return false;
}

/**
 * Record a successful request.
 * Resets the circuit to closed state.
 *
 * @param {string} sourceId - Source identifier
 */
export function recordSuccess(sourceId) {
  const state = getState(sourceId);

  if (state.state !== CIRCUIT_STATE.CLOSED) {
    logger.info(`[CircuitBreaker] ${sourceId}: recovered, closing circuit`);
  }

  state.state = CIRCUIT_STATE.CLOSED;
  state.failures = 0;
  state.lastFailure = 0;
  state.openUntil = 0;
}

/**
 * Record a failed request.
 * May open the circuit if threshold is reached.
 *
 * @param {string} sourceId - Source identifier
 * @param {Error} [error] - Optional error for logging
 */
export function recordFailure(sourceId, error = null) {
  const state = getState(sourceId);

  state.failures += 1;
  state.lastFailure = Date.now();

  if (error) {
    logger.warn(`[CircuitBreaker] ${sourceId}: failure #${state.failures} - ${error.message}`);
  } else {
    logger.warn(`[CircuitBreaker] ${sourceId}: failure #${state.failures}`);
  }

  // Check if we should open the circuit
  if (state.failures >= CONFIG.failureThreshold) {
    state.state = CIRCUIT_STATE.OPEN;

    // Use extended timeout for repeated failures
    const timeout = state.failures >= CONFIG.extendedThreshold
      ? CONFIG.extendedTimeoutMs
      : CONFIG.resetTimeoutMs;

    state.openUntil = Date.now() + timeout;

    const timeoutStr = state.failures >= CONFIG.extendedThreshold ? '24 hours' : '1 hour';
    logger.warn(`[CircuitBreaker] ${sourceId}: circuit OPEN for ${timeoutStr}`);
  }
}

/**
 * Get the current status of a source's circuit.
 *
 * @param {string} sourceId - Source identifier
 * @returns {Object} Circuit status
 */
export function getCircuitStatus(sourceId) {
  const state = getState(sourceId);

  // Update state if open timeout expired
  if (state.state === CIRCUIT_STATE.OPEN && Date.now() >= state.openUntil) {
    state.state = CIRCUIT_STATE.HALF_OPEN;
  }

  return {
    sourceId,
    state: state.state,
    failures: state.failures,
    lastFailure: state.lastFailure ? new Date(state.lastFailure).toISOString() : null,
    openUntil: state.openUntil ? new Date(state.openUntil).toISOString() : null,
    isOpen: state.state === CIRCUIT_STATE.OPEN
  };
}

/**
 * Get health status for a source.
 * Provides more detail than just open/closed.
 *
 * @param {string} sourceId - Source identifier
 * @returns {Object} Health status with message
 */
export function getHealthStatus(sourceId) {
  const state = getState(sourceId);

  if (state.state === CIRCUIT_STATE.CLOSED && state.failures === 0) {
    return { status: 'healthy', message: 'No recent failures' };
  }

  if (state.state === CIRCUIT_STATE.CLOSED) {
    return { status: 'recovering', message: `${state.failures} recent failures` };
  }

  if (state.state === CIRCUIT_STATE.HALF_OPEN) {
    return { status: 'testing', message: 'Testing if service recovered' };
  }

  // Open
  const remainingMs = state.openUntil - Date.now();
  const remainingMins = Math.ceil(remainingMs / 60000);
  return {
    status: 'unavailable',
    message: `Circuit open for ${remainingMins} more minutes`,
    retriesAt: new Date(state.openUntil).toISOString()
  };
}

/**
 * Manually reset a circuit to closed state.
 * Use for testing or manual intervention.
 *
 * @param {string} sourceId - Source identifier (or null to reset all)
 */
export function resetCircuit(sourceId = null) {
  if (sourceId) {
    const state = getState(sourceId);
    state.state = CIRCUIT_STATE.CLOSED;
    state.failures = 0;
    state.lastFailure = 0;
    state.openUntil = 0;
    logger.info(`[CircuitBreaker] ${sourceId}: manually reset`);
  } else {
    circuitState.clear();
    logger.info('[CircuitBreaker] All circuits reset');
  }
}

/**
 * Get statistics for all tracked circuits.
 * @returns {Object} Circuit breaker statistics
 */
export function getCircuitStats() {
  const stats = {
    total: circuitState.size,
    open: 0,
    halfOpen: 0,
    closed: 0,
    circuits: {}
  };

  for (const [sourceId, state] of circuitState.entries()) {
    // Update state if needed
    if (state.state === CIRCUIT_STATE.OPEN && Date.now() >= state.openUntil) {
      state.state = CIRCUIT_STATE.HALF_OPEN;
    }

    switch (state.state) {
      case CIRCUIT_STATE.OPEN:
        stats.open++;
        break;
      case CIRCUIT_STATE.HALF_OPEN:
        stats.halfOpen++;
        break;
      default:
        stats.closed++;
    }

    stats.circuits[sourceId] = getCircuitStatus(sourceId);
  }

  return stats;
}

/**
 * Execute a function with circuit breaker protection.
 * Automatically records success/failure.
 *
 * @param {string} sourceId - Source identifier
 * @param {Function} fn - Async function to execute
 * @returns {Promise<any>} Result of the function
 * @throws {Error} If circuit is open or function fails
 */
export async function withCircuitBreaker(sourceId, fn) {
  // Check if circuit is open
  if (isCircuitOpen(sourceId)) {
    const status = getHealthStatus(sourceId);
    throw new Error(`Circuit open for ${sourceId}: ${status.message}`);
  }

  try {
    const result = await fn();
    recordSuccess(sourceId);
    return result;
  } catch (error) {
    recordFailure(sourceId, error);
    throw error;
  }
}

export default {
  isCircuitOpen,
  recordSuccess,
  recordFailure,
  getCircuitStatus,
  getHealthStatus,
  resetCircuit,
  getCircuitStats,
  withCircuitBreaker,
  CIRCUIT_STATE,
  CONFIG
};
