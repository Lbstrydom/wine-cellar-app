/**
 * @fileoverview Unit tests for the unified Claude Wine Search service.
 * Tests the single-call architecture: prompt construction, tool_use extraction,
 * preamble filtering, text fallback, source URL collection, and citation extraction.
 *
 * The search uses SSE streaming — mocks simulate the stream event protocol.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockStream } = vi.hoisted(() => ({ mockStream: vi.fn() }));

vi.mock('../../../../src/services/ai/claudeClient.js', () => ({
  default: { messages: { stream: mockStream } }
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
  getSourcesForCountry: vi.fn((country) => {
    if (!country) return [];
    // South Africa: mix of local and global sources
    return [
      { name: "Platter's Wine Guide", lens: 'panel_guide', home_regions: ['South Africa'], score_type: 'stars', score_scale: 5, credibility: 0.95 },
      { name: 'Veritas Awards', lens: 'competition', home_regions: ['South Africa'], score_type: 'medal', credibility: 0.9 },
      { name: 'Tim Atkin SA', lens: 'critic', home_regions: ['South Africa'], score_type: 'points', score_scale: 100, credibility: 0.9 },
      { name: 'Decanter World Wine Awards', lens: 'competition', home_regions: [], score_type: 'medal', credibility: 1.0 },
      { name: 'James Suckling', lens: 'critic', home_regions: [], score_type: 'points', score_scale: 100, credibility: 0.8 },
      { name: 'Vivino', lens: 'community', home_regions: [], credibility: 0.7 }
    ];
  })
}));

import {
  unifiedWineSearch,
  isUnifiedWineSearchAvailable,
  extractNarrative,
  extractSourceUrls,
  extractCitations
} from '../../../../src/services/search/claudeWineSearch.js';
import { getModelForTask } from '../../../../src/config/aiModels.js';

// ---------------------------------------------------------------------------
// Helpers — convert content blocks to SSE stream events
// ---------------------------------------------------------------------------

/**
 * Create a mock async iterable that yields SSE events for the given content blocks.
 * Simulates the Anthropic SDK's messages.stream() return value.
 */
function makeStreamFromContent(contentBlocks, stopReason = 'end_turn') {
  const events = [];

  for (let i = 0; i < contentBlocks.length; i++) {
    const block = contentBlocks[i];

    if (block.type === 'web_search_tool_result') {
      // web_search_tool_result arrives complete in content_block_start
      events.push({ type: 'content_block_start', index: i, content_block: block });
      events.push({ type: 'content_block_stop', index: i });
    } else if (block.type === 'text') {
      events.push({
        type: 'content_block_start',
        index: i,
        content_block: { type: 'text', text: '' }
      });
      // Emit text in one delta
      events.push({
        type: 'content_block_delta',
        index: i,
        delta: { type: 'text_delta', text: block.text || '' }
      });
      // Emit citations if present
      if (Array.isArray(block.citations)) {
        for (const cit of block.citations) {
          events.push({
            type: 'content_block_delta',
            index: i,
            delta: { type: 'citations_delta', citation: cit }
          });
        }
      }
      events.push({ type: 'content_block_stop', index: i });
    } else if (block.type === 'tool_use') {
      events.push({
        type: 'content_block_start',
        index: i,
        content_block: { type: 'tool_use', id: block.id || `tu_${i}`, name: block.name }
      });
      // Emit input JSON as a single delta
      events.push({
        type: 'content_block_delta',
        index: i,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input || {}) }
      });
      events.push({ type: 'content_block_stop', index: i });
    } else if (block.type === 'server_tool_use') {
      events.push({
        type: 'content_block_start',
        index: i,
        content_block: { type: 'server_tool_use', id: block.id || `stu_${i}`, name: block.name }
      });
      if (block.input) {
        events.push({
          type: 'content_block_delta',
          index: i,
          delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) }
        });
      }
      events.push({ type: 'content_block_stop', index: i });
    }
  }

  // message_delta with stop_reason (always last)
  events.push({ type: 'message_delta', delta: { stop_reason: stopReason } });

  // Return async iterable
  return {
    [Symbol.asyncIterator]() {
      let idx = 0;
      return {
        next() {
          if (idx < events.length) {
            return Promise.resolve({ value: events[idx++], done: false });
          }
          return Promise.resolve({ value: undefined, done: true });
        }
      };
    }
  };
}

const makeToolUseResponse = (input = {}, stopReason = 'tool_use') => makeStreamFromContent([
  {
    type: 'web_search_tool_result',
    content: [{ type: 'web_search_result', url: 'https://timatkin.com/review', title: 'Tim Atkin' }]
  },
  {
    type: 'text',
    text: 'Here is the research narrative for this wine.'
  },
  {
    type: 'tool_use',
    name: 'save_wine_profile',
    input: {
      ratings: [],
      tasting_notes: null,
      drinking_window: null,
      food_pairings: [],
      style_summary: '',
      grape_varieties: [],
      producer_info: null,
      awards: [],
      ...input
    }
  }
], stopReason);

const makeTextResponse = (text) => makeStreamFromContent([
  {
    type: 'web_search_tool_result',
    content: [{ type: 'web_search_result', url: 'https://vivino.com/wine', title: 'Vivino' }]
  },
  { type: 'text', text }
], 'end_turn');

const mockWine = {
  wine_name: 'Kanonkop Pinotage',
  vintage: '2020',
  producer: 'Kanonkop',
  country: 'South Africa',
  colour: 'Red'
};

// ---------------------------------------------------------------------------
// isUnifiedWineSearchAvailable
// ---------------------------------------------------------------------------

describe('isUnifiedWineSearchAvailable()', () => {
  it('returns true when anthropic client is configured', () => {
    expect(isUnifiedWineSearchAvailable()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// API call shape
// ---------------------------------------------------------------------------

describe('unifiedWineSearch() — API call shape', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls anthropic.messages.stream with correct tools and stream:true', async () => {
    mockStream.mockReturnValue(makeToolUseResponse());

    await unifiedWineSearch(mockWine);

    expect(mockStream).toHaveBeenCalledOnce();
    const [params] = mockStream.mock.calls[0];

    // Two tools: web_search (max 5) + save_wine_profile.
    // web_fetch removed — fetching full pages added 3-4 min per request.
    expect(params.tools).toHaveLength(2);
    expect(params.tools[0]).toEqual({ type: 'web_search_20260209', name: 'web_search', max_uses: 5 });
    expect(params.tools[1].name).toBe('save_wine_profile');

    // Streaming enabled
    expect(params.stream).toBe(true);

    // Model from aiModels
    expect(params.model).toBe('claude-sonnet-4-6');
    expect(getModelForTask).toHaveBeenCalledWith('webSearch');
  });

  it('includes producer, wine name, vintage, and country in prompt', async () => {
    mockStream.mockReturnValue(makeToolUseResponse());

    await unifiedWineSearch(mockWine);

    const prompt = mockStream.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain('Kanonkop');
    expect(prompt).toContain('Pinotage');
    expect(prompt).toContain('2020');
    expect(prompt).toContain('South Africa');
    expect(prompt).toContain('Red');
  });

  it('includes country-specific local sources in prompt', async () => {
    mockStream.mockReturnValue(makeToolUseResponse());

    await unifiedWineSearch(mockWine);

    const prompt = mockStream.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain("Platter's Wine Guide");
    expect(prompt).toContain('Veritas Awards');
    expect(prompt).toContain('Tim Atkin SA');
  });

  it('includes global competition and critic sources in prompt', async () => {
    mockStream.mockReturnValue(makeToolUseResponse());

    await unifiedWineSearch(mockWine);

    const prompt = mockStream.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain('Decanter World Wine Awards');
    expect(prompt).toContain('James Suckling');
  });

  it('always includes community sources (Vivino, CellarTracker) in prompt', async () => {
    mockStream.mockReturnValue(makeToolUseResponse());

    await unifiedWineSearch(mockWine);

    const prompt = mockStream.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain('Vivino');
    expect(prompt).toContain('CellarTracker');
  });

  it('uses default sources when no country provided', async () => {
    mockStream.mockReturnValue(makeToolUseResponse());

    await unifiedWineSearch({ ...mockWine, country: '' });

    const prompt = mockStream.mock.calls[0][0].messages[0].content;
    // Should fall back to default global sources
    expect(prompt).toContain('Decanter World Wine Awards');
    expect(prompt).toContain('Wine Spectator');
  });

  it('handles NV vintage correctly', async () => {
    mockStream.mockReturnValue(makeToolUseResponse());

    await unifiedWineSearch({ ...mockWine, vintage: '' });

    const prompt = mockStream.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain('NV');
  });

  it('handles null vintage as NV', async () => {
    mockStream.mockReturnValue(makeToolUseResponse());

    await unifiedWineSearch({ ...mockWine, vintage: null });

    const prompt = mockStream.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain('NV');
  });
});

// ---------------------------------------------------------------------------
// Profile context injection
// ---------------------------------------------------------------------------

describe('unifiedWineSearch() — profile context injection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('includes wine profile line when style/grapes/region are present', async () => {
    mockStream.mockReturnValue(makeToolUseResponse());

    await unifiedWineSearch({
      ...mockWine,
      style: 'Full-bodied',
      grapes: 'Pinotage',
      region: 'Stellenbosch'
    });

    const prompt = mockStream.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain('Wine profile:');
    expect(prompt).toContain('Full-bodied');
    expect(prompt).toContain('Pinotage');
    expect(prompt).toContain('Stellenbosch');
    expect(prompt).toContain('Do NOT add these terms to your web search queries');
  });

  it('includes style/grapes/region in CRITICAL RULES section', async () => {
    mockStream.mockReturnValue(makeToolUseResponse());

    await unifiedWineSearch({
      ...mockWine,
      style: 'Dry',
      grapes: 'Grenache',
      region: 'Paarl'
    });

    const prompt = mockStream.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain('Style: Dry');
    expect(prompt).toContain('Grapes: Grenache');
    expect(prompt).toContain('Region: Paarl');
  });

  it('omits profile line when wine has no style/grapes/region', async () => {
    mockStream.mockReturnValue(makeToolUseResponse());

    await unifiedWineSearch(mockWine);

    const prompt = mockStream.mock.calls[0][0].messages[0].content;
    expect(prompt).not.toContain('Wine profile:');
    expect(prompt).not.toContain('Do NOT add these terms');
  });

  it('sanitizes profile fields — strips control characters', async () => {
    mockStream.mockReturnValue(makeToolUseResponse());

    await unifiedWineSearch({
      ...mockWine,
      style: 'Full\nbodied\twith\rtabs',
      grapes: 'Grenache',
      region: 'Swartland'
    });

    const prompt = mockStream.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain('Full bodied with tabs');
    expect(prompt).not.toContain('Full\nbodied');
  });

  it('truncates profile fields at 100 characters', async () => {
    mockStream.mockReturnValue(makeToolUseResponse());

    await unifiedWineSearch({
      ...mockWine,
      style: 'A'.repeat(200),
      grapes: 'Grenache',
      region: 'Swartland'
    });

    const prompt = mockStream.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain('A'.repeat(100));
    expect(prompt).not.toContain('A'.repeat(101));
  });
});

// ---------------------------------------------------------------------------
// Structured output (tool_use path)
// ---------------------------------------------------------------------------

describe('unifiedWineSearch() — tool_use extraction (primary path)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extracts ratings from save_wine_profile tool_use block', async () => {
    mockStream.mockReturnValue(makeToolUseResponse({
      ratings: [{
        source: 'Tim Atkin SA',
        source_lens: 'critics',
        score_type: 'points',
        raw_score: '94',
        raw_score_numeric: 94,
        reviewer_name: 'Tim Atkin',
        tasting_notes: 'Dark fruit, earthy',
        vintage_match: 'exact',
        confidence: 'high',
        source_url: 'https://timatkin.com/review',
        competition_year: null,
        rating_count: null
      }],
      grape_varieties: ['Pinotage']
    }));

    const result = await unifiedWineSearch(mockWine);

    expect(result).not.toBeNull();
    expect(result.ratings).toHaveLength(1);
    expect(result.ratings[0].source).toBe('Tim Atkin SA');
    expect(result.ratings[0].raw_score_numeric).toBe(94);
    expect(result.grape_varieties).toEqual(['Pinotage']);
  });

  it('extracts producer_info and awards from tool_use block', async () => {
    mockStream.mockReturnValue(makeToolUseResponse({
      ratings: [],
      producer_info: { name: 'Kanonkop', region: 'Stellenbosch', country: 'South Africa', description: 'Iconic estate' },
      awards: [{ competition: 'Veritas Awards', year: 2020, award: 'Gold', category: 'Red Wine' }]
    }));

    const result = await unifiedWineSearch(mockWine);

    expect(result.producer_info.name).toBe('Kanonkop');
    expect(result.awards).toHaveLength(1);
    expect(result.awards[0].competition).toBe('Veritas Awards');
  });

  it('includes narrative from text blocks after last search result', async () => {
    mockStream.mockReturnValue(makeToolUseResponse());

    const result = await unifiedWineSearch(mockWine);

    expect(result._narrative).toContain('Here is the research narrative');
  });
});

// ---------------------------------------------------------------------------
// Text fallback path
// ---------------------------------------------------------------------------

describe('unifiedWineSearch() — text fallback (no tool_use)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('falls back to JSON extraction from text when no tool_use block', async () => {
    mockStream.mockReturnValue(makeTextResponse(
      JSON.stringify({
        ratings: [{
          source: 'Vivino',
          source_lens: 'community',
          score_type: 'stars',
          raw_score: '4.2',
          raw_score_numeric: 4.2,
          vintage_match: 'exact',
          confidence: 'medium',
          source_url: 'https://vivino.com/wine'
        }],
        tasting_notes: null,
        drinking_window: null,
        food_pairings: [],
        style_summary: ''
      })
    ));

    const result = await unifiedWineSearch(mockWine);

    expect(result).not.toBeNull();
    expect(result.ratings).toHaveLength(1);
    expect(result.ratings[0].source).toBe('Vivino');
    expect(result.ratings[0].raw_score_numeric).toBe(4.2);
  });

  it('returns null when text has no JSON and no tool_use', async () => {
    mockStream.mockReturnValue(makeStreamFromContent([
      {
        type: 'web_search_tool_result',
        content: []
      },
      { type: 'text', text: 'I could not find any ratings for this wine.' }
    ], 'end_turn'));

    const result = await unifiedWineSearch(mockWine);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('unifiedWineSearch() — error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null on API error', async () => {
    mockStream.mockImplementation(() => { throw new Error('API rate limited'); });

    const result = await unifiedWineSearch(mockWine);
    expect(result).toBeNull();
  });

  it('returns null when response has no content blocks', async () => {
    mockStream.mockReturnValue(makeStreamFromContent([], 'end_turn'));

    const result = await unifiedWineSearch(mockWine);
    expect(result).toBeNull();
  });

  it('returns null when response content is only search result blocks (no text)', async () => {
    mockStream.mockReturnValue(makeStreamFromContent([
      { type: 'web_search_tool_result', content: [] }
    ], 'end_turn'));

    const result = await unifiedWineSearch(mockWine);
    expect(result).toBeNull();
  });

  it('returns structured timeout error when includeErrors=true and API times out', async () => {
    mockStream.mockImplementation(() => { throw new Error('Request timed out after 60s'); });

    const result = await unifiedWineSearch(mockWine, { includeErrors: true });

    expect(result).toBeTruthy();
    expect(result._error).toBeTruthy();
    expect(result._error.code).toBe('timeout');
    expect(result._error.userMessage).toContain('timed out');
  });

  it('returns structured timeout error when AbortError is thrown', async () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    mockStream.mockImplementation(() => { throw abortErr; });

    const result = await unifiedWineSearch(mockWine, { includeErrors: true });

    expect(result._error.code).toBe('timeout');
    expect(result._error.userMessage).toContain('timed out');
  });

  it('returns structured empty_response error when includeErrors=true and no narrative/tool_use', async () => {
    mockStream.mockReturnValue(makeStreamFromContent([
      { type: 'web_search_tool_result', content: [] }
    ], 'end_turn'));

    const result = await unifiedWineSearch(mockWine, { includeErrors: true });

    expect(result).toBeTruthy();
    expect(result._error).toBeTruthy();
    expect(result._error.code).toBe('empty_response');
    expect(result._error.userMessage).toContain('empty response');
  });

  it('returns structured api_error for non-timeout errors when includeErrors=true', async () => {
    mockStream.mockImplementation(() => { throw new Error('Invalid API key'); });

    const result = await unifiedWineSearch(mockWine, { includeErrors: true });

    expect(result._error.code).toBe('api_error');
    expect(result._error.userMessage).toContain('upstream API error');
  });
});

// ---------------------------------------------------------------------------
// pause_turn continuation
// ---------------------------------------------------------------------------

describe('unifiedWineSearch() — pause_turn continuation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resumes conversation when stop_reason is pause_turn', async () => {
    mockStream
      .mockReturnValueOnce(makeStreamFromContent([
        { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://first.com', title: 'First' }] },
        { type: 'text', text: 'Partial research...' }
      ], 'pause_turn'))
      .mockReturnValueOnce(makeToolUseResponse({ ratings: [{ source: 'Tim Atkin', raw_score: '94' }] }));

    const result = await unifiedWineSearch(mockWine);

    expect(mockStream).toHaveBeenCalledTimes(2);
    expect(result.ratings).toHaveLength(1);
    expect(result.ratings[0].source).toBe('Tim Atkin');

    // Continuation message should include assistant turn + user continuation prompt
    const secondCallParams = mockStream.mock.calls[1][0];
    expect(secondCallParams.messages).toHaveLength(3); // user + assistant + user
    expect(secondCallParams.messages[1].role).toBe('assistant');
    expect(secondCallParams.messages[2].role).toBe('user');
    expect(secondCallParams.messages[2].content).toContain('Continue');
  });

  it('accumulates sources from all pause_turn iterations', async () => {
    mockStream
      .mockReturnValueOnce(makeStreamFromContent([
        { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://first.com', title: 'First' }] }
      ], 'pause_turn'))
      .mockReturnValueOnce(makeStreamFromContent([
        { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://second.com', title: 'Second' }] },
        { type: 'tool_use', name: 'save_wine_profile', input: { ratings: [] } }
      ], 'tool_use'));

    const result = await unifiedWineSearch(mockWine);

    expect(result._sources).toHaveLength(2);
    expect(result._sources[0].url).toBe('https://first.com');
    expect(result._sources[1].url).toBe('https://second.com');
  });

  it('stops retrying after MAX_PAUSE_CONTINUATIONS (2)', async () => {
    // All 3 calls return pause_turn (1 initial + 2 continuations = 3 total)
    mockStream
      .mockReturnValueOnce(makeStreamFromContent([{ type: 'text', text: 'part 1' }], 'pause_turn'))
      .mockReturnValueOnce(makeStreamFromContent([{ type: 'text', text: 'part 2' }], 'pause_turn'))
      .mockReturnValueOnce(makeStreamFromContent([{ type: 'text', text: 'part 3' }], 'pause_turn'));

    const result = await unifiedWineSearch(mockWine);

    expect(mockStream).toHaveBeenCalledTimes(3);
    // Result should be null since no tool_use or extractable JSON
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Metadata and sources
// ---------------------------------------------------------------------------

describe('unifiedWineSearch() — metadata and sources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('attaches _metadata with method, model, and duration', async () => {
    mockStream.mockReturnValue(makeToolUseResponse());

    const result = await unifiedWineSearch(mockWine);

    expect(result._metadata).toBeDefined();
    expect(result._metadata.method).toBe('unified_claude_search');
    expect(result._metadata.model).toBe('claude-sonnet-4-6');
    expect(result._metadata.duration_ms).toBeGreaterThanOrEqual(0);
    expect(result._metadata.extracted_at).toBeDefined();
  });

  it('collects _sources from web_search_tool_result blocks', async () => {
    mockStream.mockReturnValue(makeStreamFromContent([
      {
        type: 'web_search_tool_result',
        content: [
          { type: 'web_search_result', url: 'https://timatkin.com/review', title: 'Tim Atkin Review' },
          { type: 'web_search_result', url: 'https://vivino.com/wine', title: 'Vivino' }
        ]
      },
      {
        type: 'web_search_tool_result',
        content: [
          { type: 'web_search_result', url: 'https://wine.co.za/kanonkop', title: 'Wine.co.za' }
        ]
      },
      {
        type: 'tool_use',
        name: 'save_wine_profile',
        input: { ratings: [] }
      }
    ], 'tool_use'));

    const result = await unifiedWineSearch(mockWine);

    expect(result._sources).toHaveLength(3);
    expect(result._sources[0].url).toBe('https://timatkin.com/review');
    expect(result._sources[1].title).toBe('Vivino');
    expect(result._sources[2].url).toBe('https://wine.co.za/kanonkop');
    expect(result._metadata.sources_count).toBe(3);
  });

  it('collects _citations from text block citations arrays', async () => {
    mockStream.mockReturnValue(makeStreamFromContent([
      { type: 'web_search_tool_result', content: [] },
      {
        type: 'text',
        text: 'Kanonkop scored 94 points [Tim Atkin]. The wine shows great complexity.',
        citations: [
          { url: 'https://timatkin.com/review' },
          { url: 'https://timatkin.com/review' }
        ]
      },
      {
        type: 'text',
        text: 'Also reviewed by Platter.',
        citations: [
          { url: 'https://platters.co.za/wine' }
        ]
      },
      { type: 'tool_use', name: 'save_wine_profile', input: { ratings: [] } }
    ], 'tool_use'));

    const result = await unifiedWineSearch(mockWine);

    expect(result._citations).toHaveLength(3);
    expect(result._citations).toContain('https://timatkin.com/review');
    expect(result._citations).toContain('https://platters.co.za/wine');
    expect(result._metadata.citation_count).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// extractNarrative — preamble filtering
// ---------------------------------------------------------------------------

describe('extractNarrative() — SERT preamble filtering', () => {
  it('returns empty string for empty content', () => {
    expect(extractNarrative([])).toBe('');
    expect(extractNarrative(null)).toBe('');
  });

  it('returns all text when no search result blocks exist', () => {
    const content = [
      { type: 'text', text: 'First paragraph.' },
      { type: 'text', text: 'Second paragraph.' }
    ];
    expect(extractNarrative(content)).toContain('First paragraph.');
    expect(extractNarrative(content)).toContain('Second paragraph.');
  });

  it('excludes text blocks BEFORE the last web_search_tool_result', () => {
    const content = [
      { type: 'text', text: 'PREAMBLE — should be excluded' },
      { type: 'web_search_tool_result', content: [] },
      { type: 'text', text: 'MIDDLE — should be excluded' },
      { type: 'web_search_tool_result', content: [] }, // last search result
      { type: 'text', text: 'NARRATIVE — should be included' }
    ];

    const narrative = extractNarrative(content);
    expect(narrative).toContain('NARRATIVE — should be included');
    expect(narrative).not.toContain('PREAMBLE');
    expect(narrative).not.toContain('MIDDLE');
  });

  it('includes multiple text blocks after the last search result', () => {
    const content = [
      { type: 'web_search_tool_result', content: [] },
      { type: 'text', text: 'Section 1.' },
      { type: 'text', text: 'Section 2.' },
      { type: 'tool_use', name: 'save_wine_profile', input: {} }
    ];

    const narrative = extractNarrative(content);
    expect(narrative).toContain('Section 1.');
    expect(narrative).toContain('Section 2.');
  });

  it('excludes tool_use blocks (only includes text blocks)', () => {
    const content = [
      { type: 'web_search_tool_result', content: [] },
      { type: 'text', text: 'Actual narrative.' },
      { type: 'tool_use', name: 'save_wine_profile', input: { ratings: [] } }
    ];

    const narrative = extractNarrative(content);
    expect(narrative).toBe('Actual narrative.');
  });

  it('handles content with only search result and tool_use blocks (empty narrative)', () => {
    const content = [
      { type: 'web_search_tool_result', content: [] },
      { type: 'tool_use', name: 'save_wine_profile', input: {} }
    ];

    expect(extractNarrative(content)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// extractSourceUrls
// ---------------------------------------------------------------------------

describe('extractSourceUrls()', () => {
  it('extracts URLs from multiple web_search_tool_result blocks', () => {
    const content = [
      {
        type: 'web_search_tool_result',
        content: [
          { type: 'web_search_result', url: 'https://a.com', title: 'A' },
          { type: 'web_search_result', url: 'https://b.com', title: 'B' }
        ]
      },
      { type: 'text', text: 'narrative' },
      {
        type: 'web_search_tool_result',
        content: [
          { type: 'web_search_result', url: 'https://c.com', title: 'C' }
        ]
      }
    ];

    const urls = extractSourceUrls(content);
    expect(urls).toHaveLength(3);
    expect(urls.map(u => u.url)).toEqual(['https://a.com', 'https://b.com', 'https://c.com']);
  });

  it('ignores non-web_search_result entries within result blocks', () => {
    const content = [{
      type: 'web_search_tool_result',
      content: [
        { type: 'web_search_result', url: 'https://valid.com', title: 'Valid' },
        { type: 'other_type', url: 'https://ignored.com' }
      ]
    }];

    const urls = extractSourceUrls(content);
    expect(urls).toHaveLength(1);
    expect(urls[0].url).toBe('https://valid.com');
  });

  it('returns empty array for empty or null content', () => {
    expect(extractSourceUrls([])).toEqual([]);
    expect(extractSourceUrls(null)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractCitations
// ---------------------------------------------------------------------------

describe('extractCitations()', () => {
  it('extracts citations from text block citations arrays', () => {
    const content = [
      {
        type: 'text',
        text: 'Scored 94 [1].',
        citations: [{ url: 'https://timatkin.com' }, { url: 'https://vivino.com' }]
      }
    ];

    const citations = extractCitations(content);
    expect(citations).toHaveLength(2);
    expect(citations).toContain('https://timatkin.com');
    expect(citations).toContain('https://vivino.com');
  });

  it('extracts standalone web_search_result_location blocks', () => {
    const content = [
      { type: 'web_search_result_location', url: 'https://decanter.com/review' }
    ];

    const citations = extractCitations(content);
    expect(citations).toContain('https://decanter.com/review');
  });

  it('skips citations without urls', () => {
    const content = [
      {
        type: 'text',
        text: 'Some text.',
        citations: [{ title: 'No URL here' }]
      }
    ];

    const citations = extractCitations(content);
    expect(citations).toHaveLength(0);
  });

  it('returns empty array for content with no citations', () => {
    const content = [
      { type: 'text', text: 'Plain text, no citations.' },
      { type: 'web_search_tool_result', content: [] }
    ];

    expect(extractCitations(content)).toEqual([]);
  });

  it('returns empty array for empty content', () => {
    expect(extractCitations([])).toEqual([]);
    expect(extractCitations(null)).toEqual([]);
  });
});
