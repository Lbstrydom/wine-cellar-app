/**
 * @fileoverview Unit tests for the Wine Data Extractor module (Phase 2 of two-phase pipeline).
 * Tests structured JSON extraction from narrative text, normalization, and prompt shape.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn()
}));

vi.mock('../../../../src/services/ai/claudeClient.js', () => ({
  default: { messages: { create: mockCreate } }
}));

vi.mock('../../../../src/config/aiModels.js', () => ({
  getModelForTask: vi.fn(() => 'claude-haiku-4-5-20251001')
}));

vi.mock('../../../../src/services/ai/claudeResponseUtils.js', () => ({
  extractText: vi.fn((response) => {
    const textBlocks = (response?.content || []).filter(b => b.type === 'text');
    return textBlocks.length > 0 ? textBlocks[textBlocks.length - 1].text : '';
  })
}));

vi.mock('../../../../src/utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

import {
  extractWineData,
  normalizeExtraction,
  EXTRACTION_SYSTEM_PROMPT,
  MAX_NARRATIVE_CHARS
} from '../../../../src/services/search/wineDataExtractor.js';
import { getModelForTask } from '../../../../src/config/aiModels.js';
import logger from '../../../../src/utils/logger.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a Phase 2 extraction response (non-streaming). */
function makeExtractionResponse(data = {}) {
  const merged = {
    ratings: [],
    tasting_notes: null,
    drinking_window: null,
    food_pairings: [],
    style_summary: '',
    grape_varieties: [],
    producer_info: null,
    awards: [],
    ...data
  };
  // The response text should NOT include the leading "{" — that's the prefill
  const jsonStr = JSON.stringify(merged);
  const textWithoutLeadingBrace = jsonStr.slice(1);
  return {
    content: [{ type: 'text', text: textWithoutLeadingBrace }]
  };
}

const mockWine = {
  wine_name: 'Kanonkop Pinotage',
  vintage: '2020',
  producer: 'Kanonkop',
  country: 'South Africa',
  colour: 'Red'
};

// ---------------------------------------------------------------------------
// extractWineData() — API call shape
// ---------------------------------------------------------------------------

describe('extractWineData() — API call shape', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls anthropic.messages.create with Haiku model', async () => {
    mockCreate.mockResolvedValue(makeExtractionResponse());

    await extractWineData('Research narrative.', [], mockWine);

    expect(mockCreate).toHaveBeenCalledOnce();
    const [params] = mockCreate.mock.calls[0];
    expect(params.model).toBe('claude-haiku-4-5-20251001');
    expect(getModelForTask).toHaveBeenCalledWith('wineExtraction');
  });

  it('uses max_tokens: 8192', async () => {
    mockCreate.mockResolvedValue(makeExtractionResponse());

    await extractWineData('Narrative.', [], mockWine);

    const [params] = mockCreate.mock.calls[0];
    expect(params.max_tokens).toBe(8192);
  });

  it('uses assistant prefill with "{"', async () => {
    mockCreate.mockResolvedValue(makeExtractionResponse());

    await extractWineData('Narrative.', [], mockWine);

    const [params] = mockCreate.mock.calls[0];
    const messages = params.messages;
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].content).toBe('{');
  });

  it('system prompt contains JSON schema keywords', async () => {
    mockCreate.mockResolvedValue(makeExtractionResponse());

    await extractWineData('Narrative.', [], mockWine);

    const [params] = mockCreate.mock.calls[0];
    expect(params.system).toContain('"ratings"');
    expect(params.system).toContain('raw_score_numeric');
    expect(params.system).toContain('SOURCE REFERENCE');
  });

  it('includes SOURCE REFERENCE with URLs when sourceUrls provided', async () => {
    mockCreate.mockResolvedValue(makeExtractionResponse());

    await extractWineData('Narrative.', [
      { url: 'https://timatkin.com/review', title: 'Tim Atkin' },
      { url: 'https://vivino.com/wine', title: 'Vivino' }
    ], mockWine);

    const [params] = mockCreate.mock.calls[0];
    const userContent = params.messages[0].content;
    expect(userContent).toContain('SOURCE REFERENCE');
    expect(userContent).toContain('[1] https://timatkin.com/review');
    expect(userContent).toContain('[2] https://vivino.com/wine');
  });

  it('omits SOURCE REFERENCE when no sourceUrls', async () => {
    mockCreate.mockResolvedValue(makeExtractionResponse());

    await extractWineData('Narrative.', [], mockWine);

    const [params] = mockCreate.mock.calls[0];
    const userContent = params.messages[0].content;
    expect(userContent).not.toContain('SOURCE REFERENCE');
  });

  it('includes wine identity in user message', async () => {
    mockCreate.mockResolvedValue(makeExtractionResponse());

    await extractWineData('Narrative.', [], mockWine);

    const [params] = mockCreate.mock.calls[0];
    const userContent = params.messages[0].content;
    expect(userContent).toContain('Kanonkop');
    expect(userContent).toContain('Kanonkop Pinotage');
    expect(userContent).toContain('2020');
  });

  it('includes narrative text in user message', async () => {
    const narrative = 'Tim Atkin scored this wine 94/100. Vivino community rating 4.3/5.';
    mockCreate.mockResolvedValue(makeExtractionResponse());

    await extractWineData(narrative, [], mockWine);

    const [params] = mockCreate.mock.calls[0];
    const userContent = params.messages[0].content;
    expect(userContent).toContain('Tim Atkin scored this wine 94/100');
    expect(userContent).toContain('Vivino community rating 4.3/5');
  });

  it('handles wine with name field instead of wine_name', async () => {
    mockCreate.mockResolvedValue(makeExtractionResponse());

    await extractWineData('Narrative.', [], { name: 'Rust en Vrede', vintage: '2019', producer: 'Rust en Vrede' });

    const [params] = mockCreate.mock.calls[0];
    const userContent = params.messages[0].content;
    expect(userContent).toContain('Rust en Vrede');
    expect(userContent).toContain('2019');
  });

  it('handles wine with no vintage (defaults to NV)', async () => {
    mockCreate.mockResolvedValue(makeExtractionResponse());

    await extractWineData('Narrative.', [], { wine_name: 'MCC Brut', producer: 'Graham Beck' });

    const [params] = mockCreate.mock.calls[0];
    const userContent = params.messages[0].content;
    expect(userContent).toContain('NV');
  });
});

// ---------------------------------------------------------------------------
// extractWineData() — extraction results
// ---------------------------------------------------------------------------

describe('extractWineData() — extraction results', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns extracted data with ratings', async () => {
    mockCreate.mockResolvedValue(makeExtractionResponse({
      ratings: [{
        source: 'Tim Atkin SA',
        raw_score: '94',
        raw_score_numeric: 94
      }]
    }));

    const result = await extractWineData('Narrative.', [], mockWine);

    expect(result.extracted.ratings).toHaveLength(1);
    expect(result.extracted.ratings[0].source).toBe('Tim Atkin SA');
    expect(result.extracted.ratings[0].raw_score_numeric).toBe(94);
  });

  it('returns duration and modelId', async () => {
    mockCreate.mockResolvedValue(makeExtractionResponse());

    const result = await extractWineData('Narrative.', [], mockWine);

    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(result.modelId).toBe('claude-haiku-4-5-20251001');
  });

  it('throws when API call fails', async () => {
    mockCreate.mockRejectedValue(new Error('Haiku API error'));

    await expect(extractWineData('Narrative.', [], mockWine))
      .rejects.toThrow('Haiku API error');
  });
});

// ---------------------------------------------------------------------------
// extractWineData() — narrative truncation
// ---------------------------------------------------------------------------

describe('extractWineData() — narrative truncation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('truncates narrative exceeding MAX_NARRATIVE_CHARS', async () => {
    const longNarrative = 'A'.repeat(MAX_NARRATIVE_CHARS + 1000);
    mockCreate.mockResolvedValue(makeExtractionResponse());

    await extractWineData(longNarrative, [], mockWine);

    const [params] = mockCreate.mock.calls[0];
    const userContent = params.messages[0].content;
    expect(userContent).toContain('[TRUNCATED');
    expect(userContent.length).toBeLessThan(longNarrative.length);
  });

  it('logs warning when narrative is truncated', async () => {
    const longNarrative = 'A'.repeat(MAX_NARRATIVE_CHARS + 500);
    mockCreate.mockResolvedValue(makeExtractionResponse());

    await extractWineData(longNarrative, [], mockWine);

    expect(logger.warn).toHaveBeenCalledWith(
      'WineDataExtractor',
      expect.stringContaining('truncated')
    );
  });

  it('does not truncate narrative within MAX_NARRATIVE_CHARS', async () => {
    const normalNarrative = 'B'.repeat(1000);
    mockCreate.mockResolvedValue(makeExtractionResponse());

    await extractWineData(normalNarrative, [], mockWine);

    const [params] = mockCreate.mock.calls[0];
    const userContent = params.messages[0].content;
    expect(userContent).not.toContain('[TRUNCATED');
    expect(userContent).toContain(normalNarrative);
  });
});

// ---------------------------------------------------------------------------
// normalizeExtraction()
// ---------------------------------------------------------------------------

describe('normalizeExtraction()', () => {
  it('passes through valid data unchanged', () => {
    const input = {
      ratings: [{ source: 'Vivino', raw_score: '4.2' }],
      grape_varieties: ['Pinotage'],
      food_pairings: ['Braised beef'],
      awards: [{ competition: 'Veritas', year: 2020, award: 'Gold', category: 'Red' }],
      tasting_notes: { nose: ['dark fruit'], palate: ['earthy'], structure: {}, finish: 'long' },
      drinking_window: { drink_from: 2022, drink_by: 2030, peak: null, recommendation: 'Hold' },
      producer_info: { name: 'Kanonkop', region: 'Stellenbosch', country: 'South Africa', description: 'Iconic estate' },
      style_summary: 'Full-bodied red'
    };

    const result = normalizeExtraction(input);

    expect(result.ratings).toEqual(input.ratings);
    expect(result.grape_varieties).toEqual(input.grape_varieties);
    expect(result.tasting_notes).toEqual(input.tasting_notes);
    expect(result.producer_info).toEqual(input.producer_info);
    expect(result.style_summary).toBe('Full-bodied red');
  });

  it('normalizes null arrays to empty arrays', () => {
    const result = normalizeExtraction({
      ratings: null,
      grape_varieties: null,
      food_pairings: null,
      awards: null,
      tasting_notes: null,
      drinking_window: null,
      producer_info: null,
      style_summary: null
    });

    expect(result.ratings).toEqual([]);
    expect(result.grape_varieties).toEqual([]);
    expect(result.food_pairings).toEqual([]);
    expect(result.awards).toEqual([]);
    expect(result.tasting_notes).toBeNull();
    expect(result.drinking_window).toBeNull();
    expect(result.producer_info).toBeNull();
    expect(result.style_summary).toBe('');
  });

  it('normalizes undefined fields to defaults', () => {
    const result = normalizeExtraction({});

    expect(result.ratings).toEqual([]);
    expect(result.grape_varieties).toEqual([]);
    expect(result.food_pairings).toEqual([]);
    expect(result.awards).toEqual([]);
    expect(result.tasting_notes).toBeNull();
    expect(result.drinking_window).toBeNull();
    expect(result.producer_info).toBeNull();
    expect(result.style_summary).toBe('');
  });

  it('normalizes arrays masquerading as objects to null', () => {
    const result = normalizeExtraction({
      tasting_notes: ['not', 'an', 'object'],
      drinking_window: [],
      producer_info: []
    });

    expect(result.tasting_notes).toBeNull();
    expect(result.drinking_window).toBeNull();
    expect(result.producer_info).toBeNull();
  });

  it('normalizes non-string style_summary to empty string', () => {
    expect(normalizeExtraction({ style_summary: 123 }).style_summary).toBe('');
    expect(normalizeExtraction({ style_summary: true }).style_summary).toBe('');
    expect(normalizeExtraction({ style_summary: {} }).style_summary).toBe('');
  });

  it('normalizes non-array ratings to empty array', () => {
    expect(normalizeExtraction({ ratings: 'not an array' }).ratings).toEqual([]);
    expect(normalizeExtraction({ ratings: 42 }).ratings).toEqual([]);
    expect(normalizeExtraction({ ratings: {} }).ratings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// EXTRACTION_SYSTEM_PROMPT — structural assertions
// ---------------------------------------------------------------------------

describe('EXTRACTION_SYSTEM_PROMPT', () => {
  it('contains all expected schema fields', () => {
    expect(EXTRACTION_SYSTEM_PROMPT).toContain('"ratings"');
    expect(EXTRACTION_SYSTEM_PROMPT).toContain('"source_lens"');
    expect(EXTRACTION_SYSTEM_PROMPT).toContain('"raw_score_numeric"');
    expect(EXTRACTION_SYSTEM_PROMPT).toContain('"tasting_notes"');
    expect(EXTRACTION_SYSTEM_PROMPT).toContain('"drinking_window"');
    expect(EXTRACTION_SYSTEM_PROMPT).toContain('"food_pairings"');
    expect(EXTRACTION_SYSTEM_PROMPT).toContain('"grape_varieties"');
    expect(EXTRACTION_SYSTEM_PROMPT).toContain('"producer_info"');
    expect(EXTRACTION_SYSTEM_PROMPT).toContain('"awards"');
  });

  it('instructs to use SOURCE REFERENCE for URL resolution', () => {
    expect(EXTRACTION_SYSTEM_PROMPT).toContain('SOURCE REFERENCE');
    expect(EXTRACTION_SYSTEM_PROMPT).toContain('resolve source URLs');
  });

  it('instructs JSON-only output with no markdown fences', () => {
    expect(EXTRACTION_SYSTEM_PROMPT).toContain('Output ONLY valid JSON');
    expect(EXTRACTION_SYSTEM_PROMPT).toContain('No markdown code fences');
  });
});
