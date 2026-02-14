/**
 * @fileoverview Tests for award extraction complexity scoring.
 * @module tests/unit/services/awards/awardExtractionComplexity.test
 */

import { computeAwardExtractionComplexity } from '../../../../src/services/awards/awardExtractorWeb.js';

// Mock dependencies to avoid importing full module tree
vi.mock('../../../../src/services/ai/claudeClient.js', () => ({ default: {} }));
vi.mock('../../../../src/services/ai/claudeResponseUtils.js', () => ({
  extractStreamText: vi.fn()
}));
vi.mock('../../../../src/services/search/searchProviders.js', () => ({
  fetchPageContent: vi.fn()
}));
vi.mock('../../../../src/services/awards/awardParser.js', () => ({
  buildExtractionPrompt: vi.fn(),
  parseAwardsResponse: vi.fn()
}));
vi.mock('../../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

describe('computeAwardExtractionComplexity', () => {
  it('returns low complexity for structured tabular content', () => {
    const lines = [];
    for (let i = 0; i < 20; i++) {
      lines.push(`Wine ${i} | 2020 | Gold | 92pts`);
    }
    const content = lines.join('\n');
    const { score, factors, useOpus } = computeAwardExtractionComplexity(content);
    expect(factors.tabularContent).toBe(true);
    expect(factors.narrativeContent).toBeUndefined();
    expect(useOpus).toBe(false);
  });

  it('returns higher complexity for narrative content', () => {
    const content = `The following wines were awarded at the 2024 competition.
    Château Margaux received a gold medal for their exceptional 2018 vintage.
    The judges were impressed by the depth and complexity of flavours.
    Meanwhile, Ridge Monte Bello also scored highly with 95 points.
    A remarkable showing from New World producers this year.`.repeat(10);
    const { score, factors } = computeAwardExtractionComplexity(content);
    expect(factors.narrativeContent).toBe(true);
    expect(score).toBeGreaterThanOrEqual(0.3);
  });

  it('adds 0.2 for large content (>30000 chars)', () => {
    // Build structured but large content
    const lines = [];
    for (let i = 0; i < 1200; i++) {
      lines.push(`Wine Producer Estate Reserve ${i} | 2020 | Gold Medal | 92/100`);
    }
    const content = lines.join('\n');
    expect(content.length).toBeGreaterThan(30000);
    const { factors } = computeAwardExtractionComplexity(content);
    expect(factors.largeContent).toBe(content.length);
  });

  it('adds 0.2 for few vintage indicators in large text', () => {
    // Large text with few vintages
    const content = 'No vintages mentioned here. Just descriptive wine text. '.repeat(200);
    expect(content.length).toBeGreaterThan(5000);
    const { factors } = computeAwardExtractionComplexity(content);
    expect(factors.fewVintageIndicators).toBeDefined();
  });

  it('detects many awards and adds factor', () => {
    const awards = [];
    for (let i = 0; i < 60; i++) {
      awards.push(`Wine ${i} | 2020 | Gold Medal`);
    }
    const content = awards.join('\n');
    const { factors } = computeAwardExtractionComplexity(content);
    expect(factors.manyAwards).toBeDefined();
  });

  it('escalates to Opus for narrative + large + few vintages', () => {
    const content = 'The panel gathered to discuss this remarkable collection of wines. '.repeat(600);
    const { useOpus, score } = computeAwardExtractionComplexity(content);
    // narrative (0.3) + large (0.2) + few vintages (0.2) = 0.7
    expect(score).toBeGreaterThanOrEqual(0.4);
    expect(useOpus).toBe(true);
  });

  it('stays on Sonnet for small structured content', () => {
    const content = `Wine A | 2020 | Gold | 92/100
Wine B | 2019 | Silver | 88/100
Wine C | 2021 | Bronze | 85/100`;
    const { useOpus } = computeAwardExtractionComplexity(content);
    expect(useOpus).toBe(false);
  });

  it('caps at 1.0', () => {
    // Worst case: narrative + large + multi-language + few vintages
    const content = ('Descriptive wine text with àáâ and 中文 characters. ').repeat(1000);
    const { score } = computeAwardExtractionComplexity(content);
    expect(score).toBeLessThanOrEqual(1.0);
  });

  it('handles empty content gracefully', () => {
    const { score, useOpus } = computeAwardExtractionComplexity('');
    expect(score).toBeGreaterThanOrEqual(0); // narrative flag hits but small content
    expect(typeof useOpus).toBe('boolean');
  });
});
