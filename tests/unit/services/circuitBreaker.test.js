/**
 * @fileoverview Unit tests for circuit breaker service.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isCircuitOpen,
  recordSuccess,
  recordFailure,
  getCircuitStatus,
  getHealthStatus,
  resetCircuit,
  getCircuitStats,
  withCircuitBreaker,
  CIRCUIT_STATE
} from '../../../src/services/circuitBreaker.js';

// Mock the logger
vi.mock('../../../src/utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }
}));

describe('CIRCUIT_STATE', () => {
  it('should define all circuit states', () => {
    expect(CIRCUIT_STATE.CLOSED).toBe('closed');
    expect(CIRCUIT_STATE.OPEN).toBe('open');
    expect(CIRCUIT_STATE.HALF_OPEN).toBe('half_open');
  });
});

describe('isCircuitOpen', () => {
  beforeEach(() => {
    resetCircuit();
  });

  it('should return false for new source', () => {
    expect(isCircuitOpen('new_source')).toBe(false);
  });

  it('should return false after success', () => {
    recordSuccess('test_source');
    expect(isCircuitOpen('test_source')).toBe(false);
  });

  it('should return false for few failures', () => {
    recordFailure('test_source');
    recordFailure('test_source');
    expect(isCircuitOpen('test_source')).toBe(false);
  });

  it('should return true after threshold failures', () => {
    recordFailure('test_source');
    recordFailure('test_source');
    recordFailure('test_source');
    expect(isCircuitOpen('test_source')).toBe(true);
  });
});

describe('recordSuccess', () => {
  beforeEach(() => {
    resetCircuit();
  });

  it('should keep circuit closed', () => {
    recordSuccess('test_source');
    const status = getCircuitStatus('test_source');
    expect(status.state).toBe(CIRCUIT_STATE.CLOSED);
    expect(status.failures).toBe(0);
  });

  it('should reset failures after previous failures', () => {
    recordFailure('test_source');
    recordFailure('test_source');
    recordSuccess('test_source');
    const status = getCircuitStatus('test_source');
    expect(status.failures).toBe(0);
  });

  it('should close open circuit', () => {
    // Open the circuit
    recordFailure('test_source');
    recordFailure('test_source');
    recordFailure('test_source');
    expect(isCircuitOpen('test_source')).toBe(true);

    // Success closes it
    recordSuccess('test_source');
    expect(isCircuitOpen('test_source')).toBe(false);
  });
});

describe('recordFailure', () => {
  beforeEach(() => {
    resetCircuit();
  });

  it('should increment failure count', () => {
    recordFailure('test_source');
    const status = getCircuitStatus('test_source');
    expect(status.failures).toBe(1);
  });

  it('should record last failure time', () => {
    recordFailure('test_source');
    const status = getCircuitStatus('test_source');
    expect(status.lastFailure).toBeDefined();
  });

  it('should open circuit at threshold', () => {
    recordFailure('test_source');
    recordFailure('test_source');
    recordFailure('test_source');
    const status = getCircuitStatus('test_source');
    expect(status.state).toBe(CIRCUIT_STATE.OPEN);
    expect(status.isOpen).toBe(true);
  });

  it('should accept optional error', () => {
    const error = new Error('Test error');
    recordFailure('test_source', error);
    const status = getCircuitStatus('test_source');
    expect(status.failures).toBe(1);
  });
});

describe('getCircuitStatus', () => {
  beforeEach(() => {
    resetCircuit();
  });

  it('should return status for new source', () => {
    const status = getCircuitStatus('new_source');
    expect(status.sourceId).toBe('new_source');
    expect(status.state).toBe(CIRCUIT_STATE.CLOSED);
    expect(status.failures).toBe(0);
    expect(status.isOpen).toBe(false);
  });

  it('should include openUntil for open circuit', () => {
    recordFailure('test_source');
    recordFailure('test_source');
    recordFailure('test_source');
    const status = getCircuitStatus('test_source');
    expect(status.openUntil).toBeDefined();
  });
});

describe('getHealthStatus', () => {
  beforeEach(() => {
    resetCircuit();
  });

  it('should return healthy for new source', () => {
    const health = getHealthStatus('new_source');
    expect(health.status).toBe('healthy');
  });

  it('should return recovering for source with some failures', () => {
    recordFailure('test_source');
    recordSuccess('test_source');
    recordFailure('test_source');
    const health = getHealthStatus('test_source');
    expect(health.status).toBe('recovering');
  });

  it('should return unavailable for open circuit', () => {
    recordFailure('test_source');
    recordFailure('test_source');
    recordFailure('test_source');
    const health = getHealthStatus('test_source');
    expect(health.status).toBe('unavailable');
    expect(health.retriesAt).toBeDefined();
  });
});

describe('resetCircuit', () => {
  beforeEach(() => {
    resetCircuit();
  });

  it('should reset specific source', () => {
    recordFailure('source1');
    recordFailure('source2');
    resetCircuit('source1');
    expect(getCircuitStatus('source1').failures).toBe(0);
    expect(getCircuitStatus('source2').failures).toBe(1);
  });

  it('should reset all sources when called with null', () => {
    recordFailure('source1');
    recordFailure('source2');
    resetCircuit();
    expect(getCircuitStats().total).toBe(0);
  });
});

describe('getCircuitStats', () => {
  beforeEach(() => {
    resetCircuit();
  });

  it('should return empty stats initially', () => {
    const stats = getCircuitStats();
    expect(stats.total).toBe(0);
    expect(stats.open).toBe(0);
    expect(stats.closed).toBe(0);
  });

  it('should count circuits by state', () => {
    recordSuccess('closed1');
    recordSuccess('closed2');
    recordFailure('failing');
    recordFailure('failing');
    recordFailure('failing');

    const stats = getCircuitStats();
    expect(stats.total).toBe(3);
    expect(stats.closed).toBe(2);
    expect(stats.open).toBe(1);
  });
});

describe('withCircuitBreaker', () => {
  beforeEach(() => {
    resetCircuit();
  });

  it('should execute function when circuit is closed', async () => {
    const result = await withCircuitBreaker('test_source', async () => 'success');
    expect(result).toBe('success');
  });

  it('should record success on successful execution', async () => {
    await withCircuitBreaker('test_source', async () => 'success');
    expect(getCircuitStatus('test_source').failures).toBe(0);
  });

  it('should record failure on error', async () => {
    try {
      await withCircuitBreaker('test_source', async () => {
        throw new Error('Test error');
      });
    } catch {
      // Expected
    }
    expect(getCircuitStatus('test_source').failures).toBe(1);
  });

  it('should throw when circuit is open', async () => {
    // Open the circuit
    recordFailure('test_source');
    recordFailure('test_source');
    recordFailure('test_source');

    await expect(
      withCircuitBreaker('test_source', async () => 'success')
    ).rejects.toThrow(/Circuit open/);
  });
});
