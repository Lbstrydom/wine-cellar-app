/**
 * @fileoverview Tests for centralized style taxonomy.
 */

import { describe, it, expect } from 'vitest';
import { STYLE_IDS, STYLE_LABELS, SHOPPING_SUGGESTIONS } from '../../../src/config/styleIds.js';

describe('styleIds', () => {
  it('has exactly 11 style IDs', () => {
    expect(STYLE_IDS).toHaveLength(11);
  });

  it('every style ID has a label', () => {
    for (const id of STYLE_IDS) {
      expect(STYLE_LABELS[id]).toBeDefined();
      expect(typeof STYLE_LABELS[id]).toBe('string');
      expect(STYLE_LABELS[id].length).toBeGreaterThan(0);
    }
  });

  it('every style ID has shopping suggestions', () => {
    for (const id of STYLE_IDS) {
      expect(SHOPPING_SUGGESTIONS[id]).toBeDefined();
      expect(Array.isArray(SHOPPING_SUGGESTIONS[id])).toBe(true);
      expect(SHOPPING_SUGGESTIONS[id].length).toBeGreaterThan(0);
    }
  });

  it('labels and suggestions have no extra keys beyond STYLE_IDS', () => {
    const idSet = new Set(STYLE_IDS);
    for (const key of Object.keys(STYLE_LABELS)) {
      expect(idSet.has(key)).toBe(true);
    }
    for (const key of Object.keys(SHOPPING_SUGGESTIONS)) {
      expect(idSet.has(key)).toBe(true);
    }
  });
});
