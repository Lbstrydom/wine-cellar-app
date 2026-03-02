/**
 * @fileoverview Unit tests for citation frequency scoring.
 * Tests URL ranking by citation frequency with domain credibility overlay.
 */

import { describe, it, expect } from 'vitest';
import { scoreByCitationFrequency } from '../../../../src/services/search/citationScoring.js';

// Sample source URLs from a search result
const sampleSources = [
  { url: 'https://timatkin.com/south-africa-2020', title: 'Tim Atkin SA Report' },
  { url: 'https://vivino.com/wines/kanonkop-pinotage', title: 'Vivino' },
  { url: 'https://cellartracker.com/wine.asp?iWine=123', title: 'CellarTracker' },
  { url: 'https://unknown-blog.com/wine-review', title: 'Unknown Blog' }
];

describe('scoreByCitationFrequency()', () => {
  it('returns empty array when sourceUrls is empty', () => {
    expect(scoreByCitationFrequency(['https://a.com'], [], 'South Africa')).toEqual([]);
    expect(scoreByCitationFrequency(['https://a.com'], null, 'South Africa')).toEqual([]);
  });

  it('returns results with same length as sourceUrls', () => {
    const result = scoreByCitationFrequency([], sampleSources);
    expect(result).toHaveLength(sampleSources.length);
  });

  it('assigns citationScore = 1.0 to the most-cited URL', () => {
    const citations = [
      'https://timatkin.com/south-africa-2020',
      'https://timatkin.com/south-africa-2020',
      'https://timatkin.com/south-africa-2020',
      'https://vivino.com/wines/kanonkop-pinotage'
    ];

    const result = scoreByCitationFrequency(citations, sampleSources);
    const timAtkin = result.find(r => r.url.includes('timatkin'));

    expect(timAtkin.citationScore).toBe(1.0);
    expect(timAtkin.citationCount).toBe(3);
  });

  it('assigns citationScore = 0.1 to uncited URLs', () => {
    const citations = ['https://timatkin.com/south-africa-2020'];

    const result = scoreByCitationFrequency(citations, sampleSources);
    const vivino = result.find(r => r.url.includes('vivino'));

    expect(vivino.citationScore).toBe(0.1);
    expect(vivino.citationCount).toBe(0);
  });

  it('normalises citation scores relative to max citation count', () => {
    const citations = [
      'https://timatkin.com/south-africa-2020',
      'https://timatkin.com/south-africa-2020', // 2 citations
      'https://vivino.com/wines/kanonkop-pinotage' // 1 citation
    ];

    const result = scoreByCitationFrequency(citations, sampleSources);
    const timAtkin = result.find(r => r.url.includes('timatkin'));
    const vivino = result.find(r => r.url.includes('vivino'));

    expect(timAtkin.citationScore).toBe(1.0);     // 2/2
    expect(vivino.citationScore).toBeCloseTo(0.5); // 1/2
  });

  it('assigns 0.1 citation score to all URLs when no citations', () => {
    const result = scoreByCitationFrequency([], sampleSources);

    for (const r of result) {
      expect(r.citationScore).toBe(0.1);
    }
  });

  it('assigns credibility to known domain URLs', () => {
    // Use decanter.com which has credibility: 1.0 in SOURCES
    const sourcesWithDecanter = [
      { url: 'https://decanter.com/wine-reviews/kanonkop', title: 'Decanter' },
      { url: 'https://unknown-blog.com/wine-review', title: 'Unknown Blog' }
    ];
    const result = scoreByCitationFrequency([], sourcesWithDecanter);
    const decanter = result.find(r => r.url.includes('decanter'));
    const unknownBlog = result.find(r => r.url.includes('unknown-blog'));

    // Decanter is a known source with credibility 1.0
    expect(decanter.credibility).toBeGreaterThan(0.5);
    // Unknown blog defaults to 0.5
    expect(unknownBlog.credibility).toBe(0.5);
  });

  it('assigns 0.5 credibility to unknown domains', () => {
    const sources = [{ url: 'https://totally-unknown-domain-xyz.com/review', title: 'Unknown' }];
    const result = scoreByCitationFrequency([], sources);
    expect(result[0].credibility).toBe(0.5);
  });

  it('returns results sorted by compositeScore descending', () => {
    const citations = [
      'https://timatkin.com/south-africa-2020',
      'https://timatkin.com/south-africa-2020',
      'https://timatkin.com/south-africa-2020'
    ];

    const result = scoreByCitationFrequency(citations, sampleSources);

    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].compositeScore).toBeGreaterThanOrEqual(result[i].compositeScore);
    }
  });

  it('compositeScore uses 70% citation + 30% credibility weights', () => {
    // Single URL, 1 citation (citationScore = 1.0), credibility = 0.5
    const sources = [{ url: 'https://totally-unknown-domain-xyz.com/review', title: 'Unknown' }];
    const citations = ['https://totally-unknown-domain-xyz.com/review'];

    const result = scoreByCitationFrequency(citations, sources);
    const expected = (1.0 * 0.7) + (0.5 * 0.3); // 0.85

    expect(result[0].compositeScore).toBeCloseTo(expected);
  });

  it('handles malformed URLs without throwing', () => {
    const sources = [{ url: 'not-a-url', title: 'Bad URL' }];
    expect(() => scoreByCitationFrequency([], sources)).not.toThrow();
    const result = scoreByCitationFrequency([], sources);
    expect(result[0].credibility).toBe(0.5);
  });

  it('handles undefined citations array without throwing', () => {
    expect(() => scoreByCitationFrequency(undefined, sampleSources)).not.toThrow();
    const result = scoreByCitationFrequency(undefined, sampleSources);
    expect(result).toHaveLength(sampleSources.length);
    for (const r of result) {
      expect(r.citationScore).toBe(0.1);
    }
  });

  it('preserves url and title from source input', () => {
    const result = scoreByCitationFrequency([], sampleSources);
    const timAtkin = result.find(r => r.url.includes('timatkin'));
    expect(timAtkin.title).toBe('Tim Atkin SA Report');
  });
});
