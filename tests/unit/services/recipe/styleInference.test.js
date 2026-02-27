/**
 * @fileoverview Tests for style inference service.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pairingEngine before import
vi.mock('../../../../src/services/pairing/pairingEngine.js', () => ({
  matchWineToStyle: vi.fn()
}));

// Mock grapeEnrichment before import
vi.mock('../../../../src/services/wine/grapeEnrichment.js', () => ({
  detectGrapesFromWine: vi.fn()
}));

import { inferStyleForItem } from '../../../../src/services/recipe/styleInference.js';
import { matchWineToStyle } from '../../../../src/services/pairing/pairingEngine.js';
import { detectGrapesFromWine } from '../../../../src/services/wine/grapeEnrichment.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('inferStyleForItem', () => {
  it('returns match from pairingEngine when all data present', () => {
    matchWineToStyle.mockReturnValue({
      styleId: 'red_full',
      styleName: 'Full Red',
      confidence: 'high',
      matchedBy: ['colour', 'grape']
    });

    const result = inferStyleForItem({
      wine_name: 'Kanonkop Cabernet Sauvignon',
      colour: 'Red',
      grapes: 'Cabernet Sauvignon'
    });

    expect(result.styleId).toBe('red_full');
    expect(result.confidence).toBe('high');
    expect(result.label).toBe('Full Red');
    expect(result.matchedOn).toEqual(['colour', 'grape']);
    expect(detectGrapesFromWine).not.toHaveBeenCalled();
  });

  it('enriches grapes when missing', () => {
    detectGrapesFromWine.mockReturnValue({
      grapes: 'Sauvignon Blanc',
      confidence: 'high',
      source: 'name'
    });
    matchWineToStyle.mockReturnValue({
      styleId: 'white_crisp',
      styleName: 'Crisp White',
      confidence: 'high',
      matchedBy: ['colour', 'grape']
    });

    const result = inferStyleForItem({
      wine_name: 'Cloudy Bay Sauvignon Blanc',
      colour: 'White'
    });

    expect(detectGrapesFromWine).toHaveBeenCalled();
    expect(result.styleId).toBe('white_crisp');
  });

  it('infers colour from detected grapes (red)', () => {
    detectGrapesFromWine.mockReturnValue({
      grapes: 'Pinot Noir',
      confidence: 'medium',
      source: 'name'
    });
    matchWineToStyle.mockReturnValue({
      styleId: 'red_light',
      styleName: 'Light Red',
      confidence: 'medium',
      matchedBy: ['grape']
    });

    const result = inferStyleForItem({
      wine_name: 'Domaine Pinot Noir'
    });

    // Should have called matchWineToStyle with enriched colour
    const call = matchWineToStyle.mock.calls[0][0];
    expect(call.colour).toBe('Red');
    expect(call.grapes).toBe('Pinot Noir');
    expect(result.styleId).toBe('red_light');
  });

  it('infers colour from detected grapes (white)', () => {
    detectGrapesFromWine.mockReturnValue({
      grapes: 'Chardonnay',
      confidence: 'high',
      source: 'name'
    });
    matchWineToStyle.mockReturnValue({
      styleId: 'white_medium',
      styleName: 'Medium White',
      confidence: 'medium',
      matchedBy: ['grape']
    });

    const result = inferStyleForItem({
      wine_name: 'Unoaked Chardonnay'
    });

    const call = matchWineToStyle.mock.calls[0][0];
    expect(call.colour).toBe('White');
  });

  it('returns null styleId when matchWineToStyle returns null', () => {
    matchWineToStyle.mockReturnValue(null);
    detectGrapesFromWine.mockReturnValue({ grapes: null, confidence: 'low', source: 'name' });

    const result = inferStyleForItem({ wine_name: 'Unknown Wine' });

    expect(result.styleId).toBeNull();
    expect(result.confidence).toBe('low');
    expect(result.label).toBeNull();
    expect(result.matchedOn).toEqual([]);
  });

  it('handles errors gracefully', () => {
    matchWineToStyle.mockImplementation(() => { throw new Error('boom'); });

    const result = inferStyleForItem({ wine_name: 'Bad Wine' });

    expect(result.styleId).toBeNull();
    expect(result.confidence).toBe('low');
  });

  it('does not enrich grapes if already provided', () => {
    matchWineToStyle.mockReturnValue({
      styleId: 'red_medium',
      styleName: 'Medium Red',
      confidence: 'high',
      matchedBy: ['colour', 'grape']
    });

    inferStyleForItem({
      wine_name: 'Chianti',
      colour: 'Red',
      grapes: 'Sangiovese'
    });

    expect(detectGrapesFromWine).not.toHaveBeenCalled();
  });

  it('uses STYLE_LABELS for label lookup', () => {
    matchWineToStyle.mockReturnValue({
      styleId: 'sparkling_dry',
      styleName: 'Dry Sparkling',
      confidence: 'high',
      matchedBy: ['keyword']
    });

    const result = inferStyleForItem({
      wine_name: 'Champagne Brut',
      colour: 'White'
    });

    // STYLE_LABELS[sparkling_dry] is 'Sparkling', not the engine's 'Dry Sparkling'
    expect(result.label).toBe('Sparkling');
  });

  it('covers all 11 style buckets (smoke test)', () => {
    const buckets = [
      'white_crisp', 'white_medium', 'white_oaked', 'white_aromatic',
      'rose_dry', 'red_light', 'red_medium', 'red_full',
      'sparkling_dry', 'sparkling_rose', 'dessert'
    ];

    for (const id of buckets) {
      matchWineToStyle.mockReturnValue({
        styleId: id,
        styleName: 'Test',
        confidence: 'medium',
        matchedBy: ['colour']
      });

      const result = inferStyleForItem({ wine_name: 'Test Wine', colour: 'Red' });
      expect(result.styleId).toBe(id);
      expect(result.label).toBeTruthy();
    }
  });
});
