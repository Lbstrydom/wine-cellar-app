/**
 * @fileoverview Tests for enrichWineData error propagation.
 * Verifies that search failures (null return from unifiedWineSearch)
 * surface as explicit error messages rather than silent "no ratings found".
 * @module tests/unit/services/acquisitionWorkflow
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockUnifiedSearch, mockIsAvailable } = vi.hoisted(() => ({
  mockUnifiedSearch: vi.fn(),
  mockIsAvailable: vi.fn()
}));

vi.mock('../../../src/services/search/claudeWineSearch.js', () => ({
  unifiedWineSearch: mockUnifiedSearch,
  isUnifiedWineSearchAvailable: mockIsAvailable
}));

vi.mock('../../../src/services/ai/index.js', () => ({
  parseWineFromImage: vi.fn(),
  parseWineFromText: vi.fn(),
  saveExtractedWindows: vi.fn(() => Promise.resolve(0))
}));

vi.mock('../../../src/services/cellar/cellarPlacement.js', () => ({
  findBestZone: vi.fn(),
  findAvailableSlot: vi.fn()
}));

vi.mock('../../../src/services/cellar/fridgeStocking.js', () => ({
  categoriseWine: vi.fn(),
  getFridgeStatus: vi.fn()
}));

vi.mock('../../../src/db/index.js', () => ({
  default: { prepare: vi.fn(() => ({ get: vi.fn(), all: vi.fn(), run: vi.fn() })) }
}));

vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

vi.mock('../../../src/services/shared/consistencyChecker.js', () => ({
  checkWineConsistency: vi.fn(() => ({ isConsistent: true, issues: [] }))
}));

import { enrichWineData } from '../../../src/services/acquisitionWorkflow.js';

const testWine = {
  wine_name: 'Markovitis Alkemi',
  vintage: '2022',
  producer: 'Markovitis',
  country: 'Greece',
  colour: 'Rosé'
};

describe('enrichWineData()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns enrichment data when search succeeds', async () => {
    mockIsAvailable.mockReturnValue(true);
    mockUnifiedSearch.mockResolvedValue({
      ratings: [{ source: 'Vivino', raw_score: '4.1' }],
      _narrative: 'A fine Greek rosé.',
      _metadata: { method: 'unified_claude_search', duration_ms: 5000 }
    });

    const result = await enrichWineData(testWine);

    expect(result.error).toBeNull();
    expect(result.ratings.ratings).toHaveLength(1);
    expect(result.ratings._narrative).toBe('A fine Greek rosé.');
  });

  it('sets error when search is unavailable (no API key)', async () => {
    mockIsAvailable.mockReturnValue(false);
    mockUnifiedSearch.mockResolvedValue(null);

    const result = await enrichWineData(testWine);

    expect(result.error).toContain('ANTHROPIC_API_KEY');
    expect(result.ratings).toEqual({});
    expect(result.drinkingWindows).toBeNull();
  });

  it('sets error when search returns null (API available but search fails)', async () => {
    mockIsAvailable.mockReturnValue(true);
    mockUnifiedSearch.mockResolvedValue(null);

    const result = await enrichWineData(testWine);

    expect(result.error).toBeTruthy();
    expect(result.error).toContain('no results');
    expect(result.ratings).toEqual({});
  });

  it('surfaces structured search error userMessage when provided', async () => {
    mockIsAvailable.mockReturnValue(true);
    mockUnifiedSearch.mockResolvedValue({
      _error: {
        code: 'timeout',
        userMessage: 'Wine search timed out. Please try again.'
      }
    });

    const result = await enrichWineData(testWine);

    expect(result.error).toBe('Wine search timed out. Please try again.');
    expect(result.ratings).toEqual({});
    expect(result.drinkingWindows).toBeNull();
  });

  it('does not set error when search returns valid data with empty ratings', async () => {
    mockIsAvailable.mockReturnValue(true);
    mockUnifiedSearch.mockResolvedValue({
      ratings: [],
      _narrative: 'Limited information found for this wine.',
      _metadata: { method: 'unified_claude_search' }
    });

    const result = await enrichWineData(testWine);

    // No error — search succeeded, just no ratings found
    expect(result.error).toBeNull();
    expect(result.ratings._narrative).toBe('Limited information found for this wine.');
  });

  it('sets error when enrichment throws an unexpected exception', async () => {
    mockIsAvailable.mockReturnValue(true);
    mockUnifiedSearch.mockRejectedValue(new Error('Network timeout'));

    const result = await enrichWineData(testWine);

    expect(result.error).toBe('Network timeout');
  });

  it('extracts drinking windows from successful search', async () => {
    mockIsAvailable.mockReturnValue(true);
    mockUnifiedSearch.mockResolvedValue({
      ratings: [{
        source: 'Tim Atkin',
        raw_score: '94',
        drinking_window: { drink_from_year: 2024, drink_by_year: 2030 }
      }],
      _narrative: 'Excellent cellaring potential.'
    });

    const result = await enrichWineData(testWine);

    expect(result.drinkingWindows).toHaveLength(1);
    expect(result.drinkingWindows[0].source).toBe('Tim Atkin');
    expect(result.drinkingWindows[0].drink_from_year).toBe(2024);
  });
});
