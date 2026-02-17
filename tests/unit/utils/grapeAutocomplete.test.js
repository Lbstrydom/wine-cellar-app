/**
 * @fileoverview Tests for grape autocomplete search and parse helpers.
 */

import { describe, it, expect } from 'vitest';
import { search, browse, parseGrapesString } from '../../../public/js/grapeAutocomplete.js';

describe('parseGrapesString', () => {
  it('parses comma-separated string', () => {
    expect(parseGrapesString('Cabernet Sauvignon, Merlot')).toEqual([
      'Cabernet Sauvignon',
      'Merlot'
    ]);
  });

  it('trims whitespace', () => {
    expect(parseGrapesString(' Shiraz ,  Grenache ')).toEqual(['Shiraz', 'Grenache']);
  });

  it('returns empty array for null/empty', () => {
    expect(parseGrapesString(null)).toEqual([]);
    expect(parseGrapesString('')).toEqual([]);
    expect(parseGrapesString(undefined)).toEqual([]);
  });

  it('handles single grape', () => {
    expect(parseGrapesString('Pinotage')).toEqual(['Pinotage']);
  });

  it('filters out empty segments', () => {
    expect(parseGrapesString('Merlot,,Shiraz,')).toEqual(['Merlot', 'Shiraz']);
  });
});

describe('search', () => {
  it('finds individual grapes by partial match', () => {
    const results = search('cab', []);
    const labels = results.map(r => r.label);
    expect(labels).toContain('Cabernet Sauvignon');
    expect(labels).toContain('Cabernet Franc');
  });

  it('finds blends by name', () => {
    const results = search('GSM', []);
    expect(results.some(r => r.type === 'blend' && r.label.includes('GSM'))).toBe(true);
  });

  it('finds blends by grape content', () => {
    const results = search('Touriga', []);
    // Should find Douro/Port blend which contains Touriga Nacional
    const douro = results.find(r => r.type === 'blend' && r.label.includes('Douro'));
    expect(douro).toBeTruthy();
  });

  it('excludes already-selected grapes', () => {
    const results = search('cab', ['Cabernet Sauvignon']);
    const labels = results.map(r => r.label);
    expect(labels).not.toContain('Cabernet Sauvignon');
    expect(labels).toContain('Cabernet Franc');
  });

  it('is case-insensitive', () => {
    const results = search('PINOT', []);
    const labels = results.map(r => r.label);
    expect(labels).toContain('Pinot Noir');
  });

  it('returns max 15 results', () => {
    const results = search('a', []);
    expect(results.length).toBeLessThanOrEqual(15);
  });

  it('returns empty array for no match', () => {
    const results = search('xyznonexistent', []);
    expect(results).toEqual([]);
  });

  it('blend results include grapes detail', () => {
    const results = search('Bordeaux', []);
    const blend = results.find(r => r.type === 'blend');
    expect(blend).toBeTruthy();
    expect(blend.grapes).toBeTruthy();
    expect(blend.grapes).toContain(',');
  });

  it('finds South African Cape Blend', () => {
    const results = search('Cape', []);
    const cape = results.find(r => r.type === 'blend' && r.label.includes('Cape'));
    expect(cape).toBeTruthy();
    expect(cape.grapes).toContain('Pinotage');
  });

  it('filters by colour category', () => {
    const reds = search('cab', [], 'red');
    expect(reds.some(r => r.label === 'Cabernet Sauvignon')).toBe(true);

    // White filter should NOT return red grapes
    const whites = search('cab', [], 'white');
    expect(whites.some(r => r.type === 'grape' && r.label === 'Cabernet Sauvignon')).toBe(false);
  });

  it('blend results include category', () => {
    const results = search('Bordeaux', []);
    const blend = results.find(r => r.type === 'blend');
    expect(blend).toBeTruthy();
    expect(blend.category).toBeTruthy();
  });
});

describe('browse', () => {
  it('returns all grapes and blends for "all" filter', () => {
    const results = browse('all');
    expect(results.length).toBeGreaterThan(70);
    expect(results.some(r => r.type === 'blend')).toBe(true);
    expect(results.some(r => r.type === 'grape')).toBe(true);
  });

  it('returns only red grapes and red blends for "red" filter', () => {
    const results = browse('red');
    const grapes = results.filter(r => r.type === 'grape');
    const blends = results.filter(r => r.type === 'blend');

    expect(grapes.length).toBeGreaterThan(0);
    expect(grapes.some(r => r.label === 'Cabernet Sauvignon')).toBe(true);
    expect(grapes.some(r => r.label === 'Chardonnay')).toBe(false);

    for (const b of blends) {
      expect(b.category).toBe('red');
    }
  });

  it('returns only white grapes for "white" filter', () => {
    const results = browse('white');
    const grapes = results.filter(r => r.type === 'grape');
    expect(grapes.some(r => r.label === 'Chardonnay')).toBe(true);
    expect(grapes.some(r => r.label === 'Merlot')).toBe(false);
  });

  it('returns only blends for "blends" filter', () => {
    const results = browse('blends');
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.type).toBe('blend');
    }
  });

  it('excludes already-selected grapes', () => {
    const results = browse('all', ['Merlot']);
    expect(results.some(r => r.type === 'grape' && r.label === 'Merlot')).toBe(false);
  });

  it('grapes are sorted alphabetically', () => {
    const results = browse('all');
    const grapeLabels = results.filter(r => r.type === 'grape').map(r => r.label);
    const sorted = [...grapeLabels].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    expect(grapeLabels).toEqual(sorted);
  });

  it('sparkling filter includes Champagne Blend', () => {
    const results = browse('sparkling');
    const blend = results.find(r => r.label.includes('Champagne'));
    expect(blend).toBeTruthy();
  });

  it('rosé filter includes Provence Rosé', () => {
    const results = browse('rosé');
    const blend = results.find(r => r.label.includes('Provence'));
    expect(blend).toBeTruthy();
  });
});
