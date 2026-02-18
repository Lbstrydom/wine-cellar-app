/**
 * @fileoverview Unit tests for Claude Web Search service.
 * Tests the Anthropic web_search tool integration for Tier 2 rating extraction.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

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

import { claudeWebSearch, isClaudeWebSearchAvailable } from '../../../../src/services/search/claudeWebSearch.js';
import { getModelForTask } from '../../../../src/config/aiModels.js';

describe('claudeWebSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isClaudeWebSearchAvailable()', () => {
    it('should return true when anthropic client is configured', () => {
      expect(isClaudeWebSearchAvailable()).toBe(true);
    });
  });

  describe('claudeWebSearch()', () => {
    const mockWine = {
      wine_name: 'Kanonkop Pinotage',
      vintage: '2020',
      producer: 'Kanonkop',
      country: 'South Africa',
      colour: 'Red'
    };

    it('should call anthropic.messages.create with web search tools', async () => {
      mockCreate.mockResolvedValue({
        content: [
          { type: 'web_search_tool_result', content: [
            { type: 'web_search_result', url: 'https://example.com', title: 'Test' }
          ]},
          { type: 'text', text: '{"ratings":[{"source":"Tim Atkin","source_lens":"critics","score_type":"points","raw_score":"93","raw_score_numeric":93,"reviewer_name":"Tim Atkin","tasting_notes":"","vintage_match":"exact","confidence":"high","source_url":"https://example.com"}],"tasting_notes":{"nose":[],"palate":[],"structure":{"body":"","tannins":"","acidity":""},"finish":""},"drinking_window":{"drink_from":null,"drink_by":null,"peak":null,"recommendation":""},"food_pairings":[],"style_summary":""}' }
        ]
      });

      const result = await claudeWebSearch(mockWine);

      expect(mockCreate).toHaveBeenCalledOnce();

      // Verify tools include web search and web fetch
      const callArgs = mockCreate.mock.calls[0];
      const params = callArgs[0];
      expect(params.tools).toEqual([
        { type: 'web_search_20260209', name: 'web_search' },
        { type: 'web_fetch_20260209', name: 'web_fetch' }
      ]);

      // Verify beta header is passed
      const options = callArgs[1];
      expect(options.headers['anthropic-beta']).toBe('code-execution-web-tools-2026-02-09');

      // Verify model from aiModels
      expect(params.model).toBe('claude-sonnet-4-6');
      expect(getModelForTask).toHaveBeenCalledWith('webSearch');
    });

    it('should extract ratings from response', async () => {
      mockCreate.mockResolvedValue({
        content: [
          { type: 'text', text: '{"ratings":[{"source":"Vivino","source_lens":"community","score_type":"points","raw_score":"4.2","raw_score_numeric":4.2,"reviewer_name":"","tasting_notes":"","vintage_match":"exact","confidence":"medium","source_url":"https://vivino.com/test"}],"tasting_notes":null,"drinking_window":null,"food_pairings":[],"style_summary":""}' }
        ]
      });

      const result = await claudeWebSearch(mockWine);

      expect(result).not.toBeNull();
      expect(result.ratings).toHaveLength(1);
      expect(result.ratings[0].source).toBe('Vivino');
      expect(result.ratings[0].raw_score_numeric).toBe(4.2);
    });

    it('should include source URLs from web_search_tool_result blocks', async () => {
      mockCreate.mockResolvedValue({
        content: [
          { type: 'web_search_tool_result', content: [
            { type: 'web_search_result', url: 'https://timatkin.com/review', title: 'Tim Atkin Review' },
            { type: 'web_search_result', url: 'https://vivino.com/wine', title: 'Vivino' }
          ]},
          { type: 'text', text: '{"ratings":[],"tasting_notes":null,"drinking_window":null,"food_pairings":[],"style_summary":""}' }
        ]
      });

      const result = await claudeWebSearch(mockWine);

      expect(result._sources).toHaveLength(2);
      expect(result._sources[0].url).toBe('https://timatkin.com/review');
      expect(result._sources[1].title).toBe('Vivino');
    });

    it('should include metadata in result', async () => {
      mockCreate.mockResolvedValue({
        content: [
          { type: 'text', text: '{"ratings":[],"tasting_notes":null,"drinking_window":null,"food_pairings":[],"style_summary":""}' }
        ]
      });

      const result = await claudeWebSearch(mockWine);

      expect(result._metadata).toBeDefined();
      expect(result._metadata.method).toBe('claude_web_search');
      expect(result._metadata.model).toBe('claude-sonnet-4-6');
      expect(result._metadata.duration_ms).toBeGreaterThanOrEqual(0);
    });

    it('should return null when no text block in response', async () => {
      mockCreate.mockResolvedValue({
        content: [
          { type: 'web_search_tool_result', content: [] }
        ]
      });

      const result = await claudeWebSearch(mockWine);
      expect(result).toBeNull();
    });

    it('should return null when response has no JSON', async () => {
      mockCreate.mockResolvedValue({
        content: [
          { type: 'text', text: 'I could not find any ratings for this wine.' }
        ]
      });

      const result = await claudeWebSearch(mockWine);
      expect(result).toBeNull();
    });

    it('should handle API errors gracefully', async () => {
      mockCreate.mockRejectedValue(new Error('API rate limited'));

      const result = await claudeWebSearch(mockWine);
      expect(result).toBeNull();
    });

    it('should repair truncated JSON', async () => {
      mockCreate.mockResolvedValue({
        content: [
          { type: 'text', text: '{"ratings":[{"source":"Test","source_lens":"critics","score_type":"points","raw_score":"90","raw_score_numeric":90,"reviewer_name":"","tasting_notes":"","vintage_match":"exact","confidence":"high","source_url":""}],"tasting_notes":null' }
        ]
      });

      const result = await claudeWebSearch(mockWine);

      expect(result).not.toBeNull();
      expect(result.ratings).toHaveLength(1);
    });

    it('should include wine context in prompt', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: '{"ratings":[],"tasting_notes":null,"drinking_window":null,"food_pairings":[],"style_summary":""}' }]
      });

      await claudeWebSearch(mockWine);

      const prompt = mockCreate.mock.calls[0][0].messages[0].content;
      expect(prompt).toContain('Kanonkop');
      expect(prompt).toContain('Pinotage');
      expect(prompt).toContain('2020');
      expect(prompt).toContain('South Africa');
      expect(prompt).toContain('Red');
      // Country-specific sources
      expect(prompt).toContain('Tim Atkin');
      expect(prompt).toContain('Platter Guide');
    });

    it('should handle NV wines correctly', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: '{"ratings":[],"tasting_notes":null,"drinking_window":null,"food_pairings":[],"style_summary":""}' }]
      });

      await claudeWebSearch({ ...mockWine, vintage: '' });

      const prompt = mockCreate.mock.calls[0][0].messages[0].content;
      expect(prompt).toContain('NV');
    });
  });
});
