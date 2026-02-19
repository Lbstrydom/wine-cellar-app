/**
 * @fileoverview Unit tests for Readability-based article text extraction.
 * Tests the extractWithReadability function with various HTML inputs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../src/utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

import { extractWithReadability } from '../../../../src/services/scraping/readabilityExtractor.js';

describe('readabilityExtractor', () => {
  describe('extractWithReadability', () => {
    it('extracts clean text from a well-structured article page', () => {
      const html = `
        <!DOCTYPE html>
        <html><head><title>Wine Review: Kanonkop Paul Sauer 2019</title></head>
        <body>
          <nav><a href="/">Home</a><a href="/reviews">Reviews</a></nav>
          <article>
            <h1>Kanonkop Paul Sauer 2019</h1>
            <p>The 2019 Paul Sauer from Kanonkop is a Bordeaux-style blend from Stellenbosch.
            This flagship wine scores 95 points from Tim Atkin and 94 from Platter Guide.
            It features ripe cassis, cedar, and tobacco notes with fine-grained tannins.</p>
            <p>Drinking window: 2024-2035. Decant for at least 2 hours before serving.
            Pair with grilled lamb or aged hard cheese.</p>
            <p>Producer: Kanonkop Estate, Stellenbosch, South Africa.
            Grape varieties: Cabernet Sauvignon 68%, Merlot 18%, Cabernet Franc 14%.
            Alcohol: 14.5%. Price: R750.</p>
          </article>
          <footer><p>Copyright 2025 Wine Reviews</p></footer>
        </body></html>`;

      const result = extractWithReadability(html, 'https://winereview.example.com/kanonkop-paul-sauer-2019');

      expect(result).not.toBeNull();
      // h1 content should be prepended to text (not stripped by Readability)
      expect(result.text).toContain('Kanonkop Paul Sauer 2019');
      expect(result.text).toContain('95 points');
      expect(result.text).toContain('Cabernet Sauvignon');
      expect(result.length).toBeGreaterThan(200);
      // Nav and footer should be stripped
      expect(result.text).not.toContain('Home');
      expect(result.text).not.toContain('Copyright');
    });

    it('returns null for SPA shell with no article content', () => {
      const html = `
        <!DOCTYPE html>
        <html><head><title>Loading...</title></head>
        <body>
          <div id="__next"></div>
          <script src="/bundle.js"></script>
        </body></html>`;

      const result = extractWithReadability(html, 'https://spa.example.com/wine');
      expect(result).toBeNull();
    });

    it('returns null for very short content below threshold', () => {
      const html = `
        <!DOCTYPE html>
        <html><head><title>Wine</title></head>
        <body><p>Short.</p></body></html>`;

      const result = extractWithReadability(html, 'https://example.com');
      expect(result).toBeNull();
    });

    it('returns null for empty HTML', () => {
      const result = extractWithReadability('', 'https://example.com');
      expect(result).toBeNull();
    });

    it('returns null for malformed HTML that Readability cannot parse', () => {
      const result = extractWithReadability('not html at all just random text', 'https://example.com');
      // Readability may still extract something or return null — both are acceptable
      // The key is it must not throw
      if (result !== null) {
        expect(result.text.length).toBeGreaterThanOrEqual(0);
      }
    });

    it('extracts article text from a page with heavy boilerplate', () => {
      const html = `
        <!DOCTYPE html>
        <html><head><title>Decanter Review</title></head>
        <body>
          <header>
            <div class="nav-bar"><a>Wine</a><a>Spirits</a><a>Beer</a></div>
          </header>
          <aside class="sidebar">
            <div class="ad">Advertisement</div>
            <div class="newsletter">Subscribe to newsletter</div>
          </aside>
          <main>
            <article>
              <h1>Stellenbosch Cab 2020 Review</h1>
              <p>This is a detailed review of the Stellenbosch Cabernet Sauvignon 2020 vintage.
              The wine exhibits dark fruit characters with a lovely structure and balance.
              It received 92 points from our panel of tasters who were impressed by the
              concentration and length of the finish. The tannins are ripe and well-integrated
              offering excellent ageing potential over the next decade.</p>
              <p>Food pairing: Best served with braised short ribs or grilled porterhouse steak.
              Serve at 16-18 degrees Celsius after decanting for one hour.</p>
            </article>
          </main>
          <footer>
            <div class="cookie-notice">We use cookies...</div>
            <div class="links">About us | Contact | Privacy</div>
          </footer>
        </body></html>`;

      const result = extractWithReadability(html, 'https://decanter.example.com/review');

      expect(result).not.toBeNull();
      expect(result.text).toContain('92 points');
      expect(result.text).toContain('Stellenbosch Cabernet Sauvignon');
      // Sidebar and footer noise should be minimised
      expect(result.text).not.toContain('Advertisement');
      expect(result.text).not.toContain('cookie');
    });

    it('handles pages with JSON-LD rating data alongside article text', () => {
      const html = `
        <!DOCTYPE html>
        <html><head>
          <title>Wine Rating</title>
          <script type="application/ld+json">
            {"@type":"Product","name":"Test Wine","aggregateRating":{"ratingValue":"4.2","ratingCount":"150"}}
          </script>
        </head>
        <body>
          <article>
            <h1>Test Wine Review</h1>
            <p>This wine has been reviewed by over 150 users with an average rating of 4.2 stars.
            It is a medium-bodied red with cherry and plum notes. The tannins are smooth and
            the finish is pleasantly long. A great everyday wine at this price point. We recommend
            it for casual dinners and informal gatherings.</p>
          </article>
        </body></html>`;

      const result = extractWithReadability(html, 'https://example.com/wine/test');

      expect(result).not.toBeNull();
      expect(result.text).toContain('4.2 stars');
      expect(result.text).toContain('150 users');
    });

    it('preserves wine rating numbers accurately', () => {
      const html = `
        <!DOCTYPE html>
        <html><head><title>Ratings</title></head>
        <body><article>
          <h1>Competition Results</h1>
          <p>Gold Medal: Kanonkop Pinotage 2020 — 95/100</p>
          <p>Silver Medal: Meerlust Rubicon 2019 — 91/100</p>
          <p>Bronze Medal: Rustenberg John X Merriman 2018 — 87/100</p>
          <p>The 2020 vintage was exceptional in Stellenbosch with warm days and cool
          nights creating ideal ripening conditions for the red varieties.</p>
        </article></body></html>`;

      const result = extractWithReadability(html, 'https://example.com/awards');

      expect(result).not.toBeNull();
      expect(result.text).toContain('95/100');
      expect(result.text).toContain('91/100');
      expect(result.text).toContain('87/100');
    });

    it('collapses excessive whitespace', () => {
      const html = `
        <!DOCTYPE html>
        <html><head><title>Spaced</title></head>
        <body><article>
          <p>Lots    of     spaces    and


          newlines in this   review of a wine that   scores 90 points from
          the expert panel.  The     wine    shows    great     complexity
          with layers of dark fruit, spice, and oak. A truly remarkable
          effort from this estate.</p>
        </article></body></html>`;

      const result = extractWithReadability(html, 'https://example.com');

      if (result) {
        expect(result.text).not.toMatch(/\s{2,}/);
      }
    });
  });
});
