/**
 * @fileoverview Unit tests for SERP AI extraction service.
 * Tests Tier 1 quick extraction prompt construction and context enrichment.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCreate } = vi.hoisted(() => {
  // Set BRIGHTDATA env vars before module loads (captured at module level)
  process.env.BRIGHTDATA_API_KEY = 'test-brightdata-key';
  process.env.BRIGHTDATA_SERP_ZONE = 'test-serp-zone';
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

vi.mock('../../../../src/config/scraperConfig.js', () => ({
  TIMEOUTS: { SERP_API_TIMEOUT: 15000 }
}));

vi.mock('../../../../src/services/wine/wineIdentity.js', () => ({
  calculateIdentityScore: vi.fn(() => ({ valid: true, score: 5, matches: {} }))
}));

vi.mock('../../../../src/services/shared/fetchUtils.js', () => ({
  createTimeoutAbort: vi.fn(() => ({
    controller: new AbortController(),
    cleanup: vi.fn()
  }))
}));

vi.mock('../../../../src/services/shared/cacheService.js', () => ({
  getCachedSerpResults: vi.fn(() => null),
  cacheSerpResults: vi.fn()
}));

// Mock fetch to prevent real network calls
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { quickSerpAiExtraction, isSerpAiAvailable } from '../../../../src/services/search/serpAi.js';

describe('serpAi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('quickSerpAiExtraction() — prompt context', () => {
    const mockWine = {
      wine_name: 'Paul Sauer',
      vintage: '2019',
      producer: 'Kanonkop',
      country: 'South Africa',
      colour: 'Red',
      style: 'Full-bodied Bordeaux blend',
      grapes: 'Cabernet Sauvignon, Merlot, Cabernet Franc',
      region: 'Stellenbosch'
    };

    it('should include context line in extraction prompt when wine has profile fields', async () => {
      // Mock SERP API response with rich AI content
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          body: JSON.stringify({
            ai_overview: { text: 'Paul Sauer 2019 rated 95 by Tim Atkin. A Bordeaux-style blend from Stellenbosch.' },
            organic: [{ title: 'Test', description: 'Test desc' }]
          })
        })
      });

      // Mock Claude extraction
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: '{"ratings":[{"source":"Tim Atkin","score":"95","score_type":"points","confidence":"high"}],"has_ratings":true,"grape_varieties":["Cabernet Sauvignon"]}' }]
      });

      await quickSerpAiExtraction(mockWine);

      // Verify Claude was called and prompt includes context
      expect(mockCreate).toHaveBeenCalled();
      const prompt = mockCreate.mock.calls[0][0].messages[0].content;
      expect(prompt).toContain('CONTEXT:');
      expect(prompt).toContain('Red');
      expect(prompt).toContain('Full-bodied Bordeaux blend');
      expect(prompt).toContain('Cabernet Sauvignon, Merlot, Cabernet Franc');
      expect(prompt).toContain('Stellenbosch');
      expect(prompt).toContain('South Africa');
    });

    it('should sanitize profile fields with newlines and long strings', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          body: JSON.stringify({
            ai_overview: { text: 'Wine rated 90 points by Wine Spectator.' },
            organic: [{ title: 'Test', description: 'Test' }]
          })
        })
      });

      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: '{"ratings":[],"has_ratings":false,"grape_varieties":[]}' }]
      });

      await quickSerpAiExtraction({
        ...mockWine,
        style: 'Bold\nand\trich',
        grapes: 'X'.repeat(200)
      });

      expect(mockCreate).toHaveBeenCalled();
      const prompt = mockCreate.mock.calls[0][0].messages[0].content;
      // Newlines stripped
      expect(prompt).not.toContain('Bold\nand');
      expect(prompt).toContain('Bold and rich');
      // Truncated
      expect(prompt).not.toContain('X'.repeat(101));
    });
  });
});
