/**
 * @fileoverview Unit tests for Gemini Search service.
 * Tests Tier 2b prompt construction with wine profile context.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCreate } = vi.hoisted(() => {
  // Set GEMINI_API_KEY before module loads (captured at module level)
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  return { mockCreate: vi.fn() };
});

vi.mock('../../../../src/services/ai/claudeClient.js', () => ({
  default: { messages: { create: mockCreate } }
}));

vi.mock('../../../../src/config/aiModels.js', () => ({
  getModelForTask: vi.fn(() => 'claude-sonnet-4-6')
}));

vi.mock('../../../../src/utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

vi.mock('../../../../src/config/unifiedSources.js', () => ({
  getSourcesForCountry: vi.fn(() => [
    { name: 'Tim Atkin', relevance: 0.9, lens: 'critics' },
    { name: 'Platter Guide', relevance: 0.8, lens: 'critics' },
    { name: 'Michelangelo Awards', relevance: 0.7, lens: 'competition' }
  ])
}));

// Mock fetch to prevent real API calls
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { searchWineWithGemini, extractWineDataWithClaude } from '../../../../src/services/search/geminiSearch.js';

describe('geminiSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('searchWineWithGemini() — profile context', () => {
    const mockWine = {
      wine_name: 'Kanonkop Pinotage',
      vintage: '2020',
      producer: 'Kanonkop',
      country: 'South Africa',
      colour: 'Red',
      style: 'Full-bodied',
      grapes: 'Pinotage',
      region: 'Stellenbosch'
    };

    it('should include profile context in Gemini prompt when wine has style/grapes/region', async () => {
      // Set GEMINI_API_KEY to enable the function
      const origKey = process.env.GEMINI_API_KEY;
      process.env.GEMINI_API_KEY = 'test-key';

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          candidates: [{
            content: { parts: [{ text: 'Wine rated 93 points' }] },
            groundingMetadata: { groundingChunks: [], webSearchQueries: [] }
          }]
        })
      });

      try {
        await searchWineWithGemini(mockWine);

        // Verify the prompt sent to Gemini includes profile line
        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        const prompt = body.contents[0].parts[0].text;
        expect(prompt).toContain('Wine profile (for verification, not search terms):');
        expect(prompt).toContain('Full-bodied');
        expect(prompt).toContain('Pinotage');
        expect(prompt).toContain('Stellenbosch');
      } finally {
        process.env.GEMINI_API_KEY = origKey;
      }
    });

    it('should omit profile line when wine has no style/grapes/region', async () => {
      const origKey = process.env.GEMINI_API_KEY;
      process.env.GEMINI_API_KEY = 'test-key';

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          candidates: [{
            content: { parts: [{ text: 'Wine rated 93 points' }] },
            groundingMetadata: { groundingChunks: [], webSearchQueries: [] }
          }]
        })
      });

      try {
        await searchWineWithGemini({
          wine_name: 'Test Wine',
          vintage: '2020',
          producer: 'Test',
          country: 'France',
          colour: 'Red'
        });

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        const prompt = body.contents[0].parts[0].text;
        expect(prompt).not.toContain('Wine profile');
      } finally {
        process.env.GEMINI_API_KEY = origKey;
      }
    });
  });

  describe('extractWineDataWithClaude() — profile context', () => {
    const mockWine = {
      wine_name: 'Paul Sauer',
      vintage: '2019',
      colour: 'Red',
      style: 'Bordeaux blend',
      grapes: 'Cabernet Sauvignon, Merlot',
      region: 'Stellenbosch'
    };

    const mockGeminiResults = {
      content: 'Paul Sauer 2019 rated 95 by Tim Atkin. A premium Bordeaux blend.',
      sources: [{ title: 'Test', url: 'https://example.com', snippet: '' }],
      searchQueries: ['Paul Sauer 2019 rating'],
      groundingSupports: [],
      model: 'gemini-3.0-flash'
    };

    it('should include style/grapes/region in Claude extraction prompt', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: '{"ratings":[],"tasting_notes":null,"drinking_window":null,"food_pairings":[],"style_summary":"","grape_varieties":[]}' }]
      });

      await extractWineDataWithClaude(mockGeminiResults, mockWine);

      const prompt = mockCreate.mock.calls[0][0].messages[0].content;
      expect(prompt).toContain('STYLE: Bordeaux blend');
      expect(prompt).toContain('GRAPES: Cabernet Sauvignon, Merlot');
      expect(prompt).toContain('REGION: Stellenbosch');
    });

    it('should omit style/grapes/region fields when not present on wine', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: '{"ratings":[],"tasting_notes":null,"drinking_window":null,"food_pairings":[],"style_summary":"","grape_varieties":[]}' }]
      });

      await extractWineDataWithClaude(mockGeminiResults, {
        wine_name: 'Test Wine',
        vintage: '2020',
        colour: 'White'
      });

      const prompt = mockCreate.mock.calls[0][0].messages[0].content;
      expect(prompt).not.toContain('STYLE:');
      expect(prompt).not.toContain('GRAPES:');
      expect(prompt).not.toContain('REGION:');
    });
  });
});
