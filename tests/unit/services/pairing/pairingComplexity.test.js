/**
 * @fileoverview Tests for pairing engine complexity scoring.
 * @module tests/unit/services/pairing/pairingComplexity.test
 */

import { computePairingComplexity } from '../../../../src/services/pairing/pairingEngine.js';

// Mock dependencies to avoid importing full module tree
vi.mock('../../../../src/services/ai/claudeClient.js', () => ({ default: {} }));
vi.mock('../../../../src/services/ai/claudeResponseUtils.js', () => ({
  extractText: vi.fn()
}));
vi.mock('../../../../src/config/pairingRules.js', () => ({
  FOOD_SIGNALS: {},
  WINE_STYLES: {},
  DEFAULT_HOUSE_STYLE: {
    acidPreference: 1, oakPreference: 1, tanninPreference: 1,
    reduceNowBonus: 1.5, fridgeBonus: 1.2, diversityPenalty: 0.85
  }
}));
vi.mock('../../../../src/services/shared/inputSanitizer.js', () => ({
  sanitizeDishDescription: vi.fn(d => d),
  sanitizeWineList: vi.fn(w => w)
}));
vi.mock('../../../../src/services/shared/responseValidator.js', () => ({
  parseAndValidate: vi.fn()
}));
vi.mock('../../../../src/services/cellar/cellarAnalysis.js', () => ({
  getEffectiveDrinkByYear: vi.fn(() => null)
}));
vi.mock('../../../../src/utils/wineNormalization.js', () => ({
  grapeMatchesText: vi.fn(() => false)
}));
vi.mock('../../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

describe('computePairingComplexity', () => {
  const makeWine = (styleId, confidence = 'high') => ({
    styleMatch: { styleId, confidence }
  });

  it('returns 0 for a simple pairing (few signals, high confidence)', () => {
    const { score, factors, useOpus } = computePairingComplexity(
      ['beef', 'grilled'],
      [makeWine('red_full'), makeWine('red_medium')]
    );
    expect(score).toBe(0);
    expect(Object.keys(factors)).toHaveLength(0);
    expect(useOpus).toBe(false);
  });

  it('adds 0.25 for >= 6 signals', () => {
    const signals = ['beef', 'grilled', 'smoky', 'umami', 'pepper', 'garlic_onion'];
    const { score, factors } = computePairingComplexity(signals, [makeWine('red_full')]);
    expect(score).toBe(0.25);
    expect(factors.manySignals).toBe(6);
  });

  it('adds 0.2 per conflicting signal pair (max 2)', () => {
    // creamy + acid is a conflict
    const { score, factors } = computePairingComplexity(
      ['creamy', 'acid'],
      [makeWine('white_crisp')]
    );
    expect(score).toBe(0.2);
    expect(factors.conflictingSignals).toBe(1);
  });

  it('caps conflict contribution at 2 pairs', () => {
    // creamy+acid, sweet+spicy, sweet+acid = 3 conflicts, capped at 0.4
    const { score, factors } = computePairingComplexity(
      ['creamy', 'acid', 'sweet', 'spicy'],
      [makeWine('white_crisp')]
    );
    expect(factors.conflictingSignals).toBe(3);
    expect(score).toBe(0.4); // 0.2 * min(3, 2) = 0.4
  });

  it('adds 0.2 for >= 2 low-confidence matches', () => {
    const { score, factors } = computePairingComplexity(
      ['beef'],
      [makeWine('red_full', 'low'), makeWine('red_medium', 'low')]
    );
    expect(score).toBe(0.2);
    expect(factors.lowConfidenceMatches).toBe(2);
  });

  it('adds 0.15 for >= 3 diverse styles', () => {
    const { score, factors } = computePairingComplexity(
      ['beef'],
      [makeWine('red_full'), makeWine('white_crisp'), makeWine('rose_dry')]
    );
    expect(score).toBe(0.15);
    expect(factors.diverseStyles).toBe(3);
  });

  it('escalates to Opus when score >= 0.5', () => {
    // 6 signals (0.25) + conflicts (0.2) + low confidence (0.2) = 0.65
    const { useOpus } = computePairingComplexity(
      ['creamy', 'acid', 'sweet', 'spicy', 'umami', 'pepper'],
      [makeWine('white_crisp', 'low'), makeWine('red_medium', 'low')]
    );
    expect(useOpus).toBe(true);
  });

  it('stays on Sonnet for moderate complexity below 0.5', () => {
    const { useOpus } = computePairingComplexity(
      ['beef', 'grilled', 'smoky'],
      [makeWine('red_full')]
    );
    expect(useOpus).toBe(false);
  });

  it('caps at 1.0', () => {
    // Many signals + many conflicts + low confidence + diverse styles
    const { score } = computePairingComplexity(
      ['creamy', 'acid', 'sweet', 'spicy', 'raw', 'smoky'],
      [
        makeWine('red_full', 'low'),
        makeWine('white_crisp', 'low'),
        makeWine('rose_dry', 'low')
      ]
    );
    expect(score).toBeLessThanOrEqual(1.0);
  });
});
