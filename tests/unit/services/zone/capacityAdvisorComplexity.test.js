/**
 * @fileoverview Tests for zone capacity advisor complexity scoring.
 * @module tests/unit/services/zone/capacityAdvisorComplexity.test
 */

import { computeCapacityComplexity } from '../../../../src/services/zone/zoneCapacityAdvisor.js';

// Mock dependencies to avoid importing full module tree
vi.mock('../../../../src/services/ai/claudeClient.js', () => ({ default: {} }));
vi.mock('../../../../src/services/ai/claudeResponseUtils.js', () => ({
  extractText: vi.fn()
}));
vi.mock('../../../../src/services/ai/openaiReviewer.js', () => ({
  reviewZoneCapacityAdvice: vi.fn().mockResolvedValue({ skipped: true }),
  isZoneCapacityReviewEnabled: vi.fn(() => false)
}));
vi.mock('../../../../src/config/cellarZones.js', () => ({
  CELLAR_ZONES: { zones: [] },
  getZoneById: () => null
}));
vi.mock('../../../../src/db/index.js', () => ({ default: {} }));
vi.mock('../../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

describe('computeCapacityComplexity', () => {
  it('returns 0 for a simple scenario (few wines, free rows, few zones)', () => {
    const { score, factors, useOpus } = computeCapacityComplexity({
      wineCount: 2,
      adjacentZoneCount: 1,
      availableRowCount: 3,
      totalAllocatedZones: 4,
      hasOverflowZone: true
    });
    expect(score).toBe(0);
    expect(Object.keys(factors)).toHaveLength(0);
    expect(useOpus).toBe(false);
  });

  it('adds 0.25 for >5 wines needing placement', () => {
    const { score, factors } = computeCapacityComplexity({
      wineCount: 8,
      adjacentZoneCount: 1,
      availableRowCount: 3,
      totalAllocatedZones: 4
    });
    expect(score).toBe(0.25);
    expect(factors.manyWines).toBe(8);
  });

  it('adds 0.25 for >3 adjacent zones', () => {
    const { score, factors } = computeCapacityComplexity({
      wineCount: 2,
      adjacentZoneCount: 5,
      availableRowCount: 3,
      totalAllocatedZones: 4
    });
    expect(score).toBe(0.25);
    expect(factors.manyAdjacentZones).toBe(5);
  });

  it('adds 0.3 for no free rows', () => {
    const { score, factors } = computeCapacityComplexity({
      wineCount: 2,
      adjacentZoneCount: 1,
      availableRowCount: 0,
      totalAllocatedZones: 4
    });
    expect(score).toBe(0.3);
    expect(factors.noFreeRows).toBe(true);
  });

  it('adds 0.2 for crowded cellar (>8 allocated zones)', () => {
    const { score, factors } = computeCapacityComplexity({
      wineCount: 2,
      adjacentZoneCount: 1,
      availableRowCount: 3,
      totalAllocatedZones: 10
    });
    expect(score).toBe(0.2);
    expect(factors.crowdedCellar).toBe(10);
  });

  it('escalates to Opus when score >= 0.5 (no free rows + many wines)', () => {
    const { score, useOpus } = computeCapacityComplexity({
      wineCount: 8,
      adjacentZoneCount: 1,
      availableRowCount: 0,
      totalAllocatedZones: 4
    });
    expect(score).toBe(0.55);
    expect(useOpus).toBe(true);
  });

  it('stays on Sonnet for moderate complexity below 0.5', () => {
    const { useOpus } = computeCapacityComplexity({
      wineCount: 8,
      adjacentZoneCount: 1,
      availableRowCount: 3,
      totalAllocatedZones: 4
    });
    expect(useOpus).toBe(false);
  });

  it('caps at 1.0 when all factors present', () => {
    const { score } = computeCapacityComplexity({
      wineCount: 20,
      adjacentZoneCount: 6,
      availableRowCount: 0,
      totalAllocatedZones: 12
    });
    expect(score).toBe(1.0);
  });

  it('handles missing/undefined inputs gracefully (noFreeRows triggers on default 0)', () => {
    const { score, useOpus } = computeCapacityComplexity({});
    // availableRowCount defaults to 0, triggering noFreeRows (0.3)
    expect(score).toBe(0.3);
    expect(useOpus).toBe(false); // 0.3 < 0.5 threshold
  });
});
