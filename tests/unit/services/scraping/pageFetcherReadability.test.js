/**
 * @fileoverview Unit tests for pageFetcher's Readability integration.
 * Verifies the Readability-first extraction with regex fallback on standard pages.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ──
const { mockFetch, mockExtractWithReadability } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockExtractWithReadability: vi.fn()
}));

vi.mock('../../../../src/utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

vi.mock('../../../../src/utils/url.js', () => ({
  extractDomain: vi.fn((url) => {
    try { return new URL(url).hostname; } catch { return url; }
  })
}));

vi.mock('../../../../src/services/shared/cacheService.js', () => ({
  getCachedPage: vi.fn().mockResolvedValue(null),
  cachePage: vi.fn().mockResolvedValue(undefined),
  getPublicUrlCache: vi.fn().mockResolvedValue(null),
  upsertPublicUrlCache: vi.fn().mockResolvedValue(undefined),
  getCacheTTL: vi.fn().mockResolvedValue(24)
}));

vi.mock('../../../../src/services/search/fetchClassifier.js', () => ({
  getDomainIssue: vi.fn().mockReturnValue(null)
}));

vi.mock('../../../../src/config/scraperConfig.js', () => ({
  TIMEOUTS: {
    STANDARD_FETCH_TIMEOUT: 10000,
    WEB_UNLOCKER_TIMEOUT: 30000,
    VIVINO_FETCH_TIMEOUT: 45000
  }
}));

vi.mock('../../../../src/services/search/searchConstants.js', () => ({
  BLOCKED_DOMAINS: ['wine-searcher.com'],
  BRIGHTDATA_API_URL: 'https://api.brightdata.com/request'
}));

vi.mock('../../../../src/services/shared/fetchUtils.js', () => ({
  createTimeoutAbort: vi.fn(() => ({
    controller: new AbortController(),
    cleanup: vi.fn()
  })),
  buildConditionalHeaders: vi.fn(),
  resolvePublicCacheStatus: vi.fn()
}));

vi.mock('../../../../src/services/search/documentFetcher.js', () => ({
  fetchDocumentContent: vi.fn()
}));

vi.mock('../../../../src/services/scraping/readabilityExtractor.js', () => ({
  extractWithReadability: mockExtractWithReadability
}));

// Stub global fetch
vi.stubGlobal('fetch', mockFetch);

import { fetchPageContent } from '../../../../src/services/scraping/pageFetcher.js';

// Clean up module-scope vi.stubGlobal('fetch') to prevent leaking
// into downstream test files in --no-isolate mode.
afterAll(() => {
  vi.unstubAllGlobals();
});

describe('pageFetcher — Readability integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.BRIGHTDATA_API_KEY;
    delete process.env.BRIGHTDATA_WEB_ZONE;
  });

  const ARTICLE_HTML = `
    <html><head><title>Wine Review</title></head>
    <body>
      <nav>Navigation</nav>
      <article>
        <h1>Kanonkop Paul Sauer 2019</h1>
        <p>Score: 95/100. A superb Bordeaux blend from Stellenbosch with dark fruit,
        cedar, and tobacco notes. Fine-grained tannins and excellent length.</p>
      </article>
      <footer>Copyright</footer>
    </body></html>`;

  function mockFetchResponse(body, status = 200) {
    mockFetch.mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(body),
      headers: new Map([['content-type', 'text/html']])
    });
  }

  it('uses Readability output when it succeeds', async () => {
    mockFetchResponse(ARTICLE_HTML);
    mockExtractWithReadability.mockReturnValueOnce({
      title: 'Kanonkop Paul Sauer 2019',
      text: 'Score: 95/100. A superb Bordeaux blend from Stellenbosch with dark fruit, cedar, and tobacco notes. Fine-grained tannins and excellent length.',
      length: 145
    });

    // Need to pass length threshold (200+) — let's make a longer response
    mockFetch.mockReset();
    const longArticleText = 'Score: 95/100. A superb Bordeaux blend from Stellenbosch. '.repeat(10);
    mockFetchResponse(ARTICLE_HTML);
    mockExtractWithReadability.mockReset();
    mockExtractWithReadability.mockReturnValueOnce({
      title: 'Wine Review',
      text: longArticleText,
      length: longArticleText.length
    });

    const result = await fetchPageContent('https://winereview.example.com/review', 8000);

    expect(mockExtractWithReadability).toHaveBeenCalledOnce();
    expect(result.success).toBe(true);
    expect(result.content).toContain('95/100');
  });

  it('falls back to regex stripping when Readability returns null', async () => {
    const htmlWithContent = `
      <html><body>
        <script>var x = 1;</script>
        <p>${'This is a review of a wine with plenty of content to pass the 200 char threshold. '.repeat(5)}</p>
      </body></html>`;

    mockFetchResponse(htmlWithContent);
    mockExtractWithReadability.mockReturnValueOnce(null);

    const result = await fetchPageContent('https://example.com/wine', 8000);

    expect(mockExtractWithReadability).toHaveBeenCalledOnce();
    expect(result.success).toBe(true);
    // Regex fallback should have stripped the script tag
    expect(result.content).not.toContain('var x = 1');
    expect(result.content).toContain('review of a wine');
  });

  it('does NOT use Readability for blocked domains (Web Unlocker path)', async () => {
    process.env.BRIGHTDATA_API_KEY = 'test-key';
    process.env.BRIGHTDATA_WEB_ZONE = 'test-zone';

    const longContent = 'Unblocked content with wine rating 92 points. '.repeat(10);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve(longContent),
      headers: new Map([['content-type', 'text/html']])
    });

    const result = await fetchPageContent('https://wine-searcher.com/wine/123', 8000);

    expect(mockExtractWithReadability).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('does NOT use Readability for Vivino pages', async () => {
    const vivinoHtml = `
      <html><head>
        <script id="__NEXT_DATA__" type="application/json">
          {"props":{"pageProps":{"wine":{"name":"Test Wine","statistics":{"ratings_average":4.1,"ratings_count":500},"region":{"name":"Stellenbosch","country":{"name":"South Africa"}}}}}}
        </script>
      </head><body><div id="__next"></div></body></html>`;

    mockFetchResponse(vivinoHtml);

    const result = await fetchPageContent('https://www.vivino.com/w/12345', 8000);

    // Vivino should use its own __NEXT_DATA__ extraction, not Readability
    expect(mockExtractWithReadability).not.toHaveBeenCalled();
  });

  it('passes URL to Readability for relative link resolution', async () => {
    const longArticle = `
      <html><body><article>
        <h1>Review</h1>
        <p>${'Detailed wine review content for testing purposes. '.repeat(10)}</p>
      </article></body></html>`;

    mockFetchResponse(longArticle);
    mockExtractWithReadability.mockReturnValueOnce({
      title: 'Review',
      text: 'Detailed wine review content for testing purposes. '.repeat(10),
      length: 500
    });

    await fetchPageContent('https://critic.example.com/wines/123', 8000);

    expect(mockExtractWithReadability).toHaveBeenCalledWith(
      expect.any(String),
      'https://critic.example.com/wines/123'
    );
  });
});
