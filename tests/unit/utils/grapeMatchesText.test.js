/**
 * @fileoverview Tests for word-boundary grape matching utilities.
 * Verifies that grapeMatchesText / findGrapeMatch prevent
 * overlap errors like "sauvignon" matching "cabernet sauvignon".
 */

import { grapeMatchesText, findGrapeMatch } from '../../../src/utils/wineNormalization.js';

describe('grapeMatchesText', () => {
  // ── Exact & full matches ──────────────────────────────────────
  it('matches exact keyword', () => {
    expect(grapeMatchesText('sauvignon blanc', 'sauvignon blanc')).toBe(true);
  });

  it('matches keyword in comma-separated list', () => {
    expect(grapeMatchesText('merlot, cabernet sauvignon, petit verdot', 'cabernet sauvignon')).toBe(true);
  });

  it('matches keyword at start of text', () => {
    expect(grapeMatchesText('chenin blanc, chardonnay', 'chenin blanc')).toBe(true);
  });

  it('matches keyword at end of text', () => {
    expect(grapeMatchesText('merlot, chenin blanc', 'chenin blanc')).toBe(true);
  });

  it('matches case-insensitively', () => {
    expect(grapeMatchesText('Sauvignon Blanc', 'sauvignon blanc')).toBe(true);
    expect(grapeMatchesText('CHENIN BLANC', 'chenin blanc')).toBe(true);
  });

  // ── Overlap prevention (the critical bug cases) ───────────────
  it('does NOT match "sauvignon" inside "cabernet sauvignon"', () => {
    expect(grapeMatchesText('cabernet sauvignon', 'sauvignon')).toBe(false);
  });

  it('does NOT match bare "sauvignon" inside a grape list containing only "cabernet sauvignon"', () => {
    expect(grapeMatchesText('merlot, cabernet sauvignon, petit verdot', 'sauvignon')).toBe(false);
  });

  it('does NOT match "cabernet" inside "cabernet sauvignon"', () => {
    expect(grapeMatchesText('cabernet sauvignon', 'cabernet')).toBe(false);
  });

  it('does NOT match "cabernet" inside "cabernet franc"', () => {
    expect(grapeMatchesText('cabernet franc', 'cabernet')).toBe(false);
  });

  it('matches "sauvignon blanc" in text that also has "cabernet sauvignon"', () => {
    expect(grapeMatchesText('cabernet sauvignon, sauvignon blanc', 'sauvignon blanc')).toBe(true);
  });

  it('does NOT match "pinot" inside "pinot noir"', () => {
    expect(grapeMatchesText('pinot noir', 'pinot')).toBe(false);
  });

  it('does NOT match "pinot" inside "pinot gris"', () => {
    expect(grapeMatchesText('pinot gris', 'pinot')).toBe(false);
  });

  it('does NOT match "blanc" inside "chenin blanc"', () => {
    expect(grapeMatchesText('chenin blanc', 'blanc')).toBe(false);
  });

  it('does NOT match "chenin" inside "chenin blanc"', () => {
    // "chenin" and "chenin blanc" are different grapes — must not overlap
    expect(grapeMatchesText('chenin blanc', 'chenin')).toBe(false);
  });

  it('does NOT match "sauvignon" in wine name "Cabernet Sauvignon Reserve"', () => {
    expect(grapeMatchesText('Cabernet Sauvignon Reserve', 'sauvignon')).toBe(false);
  });

  it('matches standalone "chenin" on its own', () => {
    expect(grapeMatchesText('chenin', 'chenin')).toBe(true);
  });

  it('matches "chenin" in a list where it appears standalone', () => {
    expect(grapeMatchesText('chenin, chardonnay', 'chenin')).toBe(true);
  });

  // ── Separator awareness ───────────────────────────────────────
  it('matches keyword separated by slash', () => {
    expect(grapeMatchesText('merlot/cabernet sauvignon', 'cabernet sauvignon')).toBe(true);
  });

  it('matches keyword separated by semicolon', () => {
    expect(grapeMatchesText('merlot; cabernet sauvignon', 'cabernet sauvignon')).toBe(true);
  });

  it('matches keyword separated by ampersand', () => {
    expect(grapeMatchesText('merlot & cabernet sauvignon', 'cabernet sauvignon')).toBe(true);
  });

  // ── Wine name matching (word-boundary fallback) ────────────────
  it('matches "pinotage" in wine name "Kanonkop Pinotage 2019"', () => {
    expect(grapeMatchesText('Kanonkop Pinotage 2019', 'pinotage')).toBe(true);
  });

  it('matches "cabernet sauvignon" in wine name "Glen Carlou Cabernet Sauvignon 2019"', () => {
    expect(grapeMatchesText('Glen Carlou Cabernet Sauvignon 2019', 'cabernet sauvignon')).toBe(true);
  });

  it('matches "merlot" in wine name "Thelema Merlot Reserve"', () => {
    expect(grapeMatchesText('Thelema Merlot Reserve', 'merlot')).toBe(true);
  });

  // ── Edge cases ────────────────────────────────────────────────
  it('returns false for null text', () => {
    expect(grapeMatchesText(null, 'merlot')).toBe(false);
  });

  it('returns false for null keyword', () => {
    expect(grapeMatchesText('merlot', null)).toBe(false);
  });

  it('returns false for empty text', () => {
    expect(grapeMatchesText('', 'merlot')).toBe(false);
  });

  it('returns false for empty keyword', () => {
    expect(grapeMatchesText('merlot', '')).toBe(false);
  });
});

describe('findGrapeMatch', () => {
  it('returns the first matching grape', () => {
    const result = findGrapeMatch('merlot, sauvignon blanc', ['chardonnay', 'sauvignon blanc', 'merlot']);
    expect(result).toBe('sauvignon blanc');
  });

  it('returns undefined when no match', () => {
    const result = findGrapeMatch('merlot, cabernet sauvignon', ['sauvignon', 'chenin']);
    expect(result).toBeUndefined();
  });

  it('does NOT match overlap grapes', () => {
    const result = findGrapeMatch('cabernet sauvignon, merlot', ['sauvignon', 'cabernet', 'pinot']);
    expect(result).toBeUndefined();
  });

  it('correctly matches from list when standalone present', () => {
    const result = findGrapeMatch('chenin, chardonnay', ['merlot', 'chenin', 'chardonnay']);
    expect(result).toBe('chenin');
  });

  it('returns undefined for null text', () => {
    expect(findGrapeMatch(null, ['merlot'])).toBeUndefined();
  });

  it('returns undefined for null keywords', () => {
    expect(findGrapeMatch('merlot', null)).toBeUndefined();
  });
});
