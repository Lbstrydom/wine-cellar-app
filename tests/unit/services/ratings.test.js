/**
 * @fileoverview Unit tests for ratings service.
 * Tests score normalization, relevance calculation, and purchase score calculation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the database before importing ratings
vi.mock('../../../src/db/index.js', () => ({
  default: {
    prepare: vi.fn(() => ({
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn()
    }))
  }
}));

// Import after mocking
const { normalizeScore, getRelevance, pointsToStars, getStarLabel, calculateWineRatings } = await import('../../../src/services/ratings.js');

describe('normalizeScore', () => {
  describe('points scoring', () => {
    it('should normalize 100-point scores as-is', () => {
      const result = normalizeScore('wine_spectator', 'points', '92');
      expect(result).toEqual({ min: 92, max: 92, mid: 92 });
    });

    it('should handle score/100 format', () => {
      const result = normalizeScore('wine_spectator', 'points', '91/100');
      expect(result).toEqual({ min: 91, max: 91, mid: 91 });
    });

    it('should handle "X points" format', () => {
      const result = normalizeScore('wine_spectator', 'points', '94 points');
      expect(result).toEqual({ min: 94, max: 94, mid: 94 });
    });

    it('should convert 20-point scale to 100-point for Jancis Robinson', () => {
      const result = normalizeScore('jancis_robinson', 'points', '17/20');
      expect(result).toEqual({ min: 85, max: 85, mid: 85 });
    });

    it('should convert 20-point scale for RVF', () => {
      const result = normalizeScore('rvf', 'points', '18/20');
      expect(result).toEqual({ min: 90, max: 90, mid: 90 });
    });

    it('should convert 20-point scale for Bettane+Desseauve', () => {
      const result = normalizeScore('bettane_desseauve', 'points', '16');
      expect(result).toEqual({ min: 80, max: 80, mid: 80 });
    });

    it('should convert 20-point scale for Vinum', () => {
      const result = normalizeScore('vinum', 'points', '19');
      expect(result).toEqual({ min: 95, max: 95, mid: 95 });
    });

    it('should return fallback for unparseable scores', () => {
      const result = normalizeScore('wine_spectator', 'points', 'excellent');
      expect(result).toEqual({ min: 85, max: 90, mid: 87.5 });
    });
  });

  describe('medal scoring', () => {
    it('should normalize gold medals', () => {
      const result = normalizeScore('iwc', 'medal', 'Gold');
      expect(result.mid).toBeGreaterThanOrEqual(90);
      expect(result.mid).toBeLessThanOrEqual(100);
    });

    it('should normalize silver medals', () => {
      const result = normalizeScore('iwc', 'medal', 'Silver');
      expect(result.mid).toBeGreaterThanOrEqual(85);
      expect(result.mid).toBeLessThan(95);
    });

    it('should normalize bronze medals', () => {
      const result = normalizeScore('iwc', 'medal', 'Bronze');
      expect(result.mid).toBeGreaterThanOrEqual(78);
      expect(result.mid).toBeLessThan(88);
    });

    it('should return conservative estimate for unknown medals in known source', () => {
      // Use a known source but with an unknown medal type
      const result = normalizeScore('iwc', 'medal', 'Participation');
      expect(result).toEqual({ min: 80, max: 85, mid: 82.5 });
    });
  });

  describe('symbol scoring', () => {
    it('should normalize Tre Bicchieri to high score', () => {
      const result = normalizeScore('gambero_rosso', 'symbol', 'Tre Bicchieri');
      expect(result.mid).toBeGreaterThanOrEqual(95);
    });

    it('should normalize Due Bicchieri Rossi', () => {
      const result = normalizeScore('gambero_rosso', 'symbol', 'Due Bicchieri Rossi');
      expect(result.mid).toBeGreaterThanOrEqual(90);
    });

    it('should normalize 5 grappoli', () => {
      const result = normalizeScore('bibenda', 'symbol', '5 grappoli');
      expect(result.mid).toBeGreaterThanOrEqual(95);
    });

    it('should normalize Coup de Coeur', () => {
      const result = normalizeScore('guide_hachette', 'symbol', 'Coup de Coeur');
      expect(result.mid).toBeGreaterThanOrEqual(95);
    });
  });

  describe('stars scoring', () => {
    it('should normalize 5-star ratings', () => {
      const result = normalizeScore('vivino', 'stars', '4.5');
      // 4.5 stars on 5-point scale should map to ~90
      expect(result.mid).toBeGreaterThanOrEqual(85);
    });

    it('should normalize lower star ratings', () => {
      const result = normalizeScore('vivino', 'stars', '3.0');
      expect(result.mid).toBeLessThan(85);
    });

    it('should handle star ratings for unknown sources', () => {
      const result = normalizeScore('other', 'stars', '4');
      // Generic: 55 + (4 * 8) = 87
      expect(result).toEqual({ min: 87, max: 87, mid: 87 });
    });
  });

  describe('error handling', () => {
    it('should throw for unknown score types', () => {
      expect(() => normalizeScore('wine_spectator', 'percentile', '95')).toThrow('Unknown score type');
    });
  });
});

describe('getRelevance', () => {
  it('should return 1.0 for global scope sources', () => {
    const wine = { country: 'France', style: 'Bordeaux Blend' };
    const relevance = getRelevance('wine_spectator', wine);
    expect(relevance).toBe(1.0);
  });

  it('should return 1.0 for home region matches', () => {
    const wine = { country: 'South Africa', style: 'Pinotage' };
    const relevance = getRelevance('platters', wine);
    expect(relevance).toBe(1.0);
  });

  it('should return lower relevance for non-home regions', () => {
    const wine = { country: 'USA', style: 'Cabernet Sauvignon' };
    const relevance = getRelevance('platters', wine);
    expect(relevance).toBeLessThan(1.0);
  });

  it('should return 0.7 for unknown sources (manual entries)', () => {
    const wine = { country: 'France', style: 'Burgundy' };
    const relevance = getRelevance('custom_source_xyz', wine);
    expect(relevance).toBe(0.7);
  });
});

describe('pointsToStars', () => {
  it('should return 5.0 for exceptional wines (95+)', () => {
    expect(pointsToStars(95)).toBe(5.0);
    expect(pointsToStars(100)).toBe(5.0);
  });

  it('should return 4.5 for very good wines (92-94)', () => {
    expect(pointsToStars(92)).toBe(4.5);
    expect(pointsToStars(94)).toBe(4.5);
  });

  it('should return 4.0 for good wines (89-91)', () => {
    expect(pointsToStars(89)).toBe(4.0);
    expect(pointsToStars(91)).toBe(4.0);
  });

  it('should return 3.5 for above average wines (86-88)', () => {
    expect(pointsToStars(86)).toBe(3.5);
    expect(pointsToStars(88)).toBe(3.5);
  });

  it('should return 3.0 for average wines (82-85)', () => {
    expect(pointsToStars(82)).toBe(3.0);
    expect(pointsToStars(85)).toBe(3.0);
  });

  it('should return 1.0 for very low scores', () => {
    expect(pointsToStars(60)).toBe(1.0);
    expect(pointsToStars(50)).toBe(1.0);
  });
});

describe('getStarLabel', () => {
  it('should return Exceptional for 4.5+ stars', () => {
    expect(getStarLabel(4.5)).toBe('Exceptional');
    expect(getStarLabel(5.0)).toBe('Exceptional');
  });

  it('should return Very Good for 4.0 stars', () => {
    expect(getStarLabel(4.0)).toBe('Very Good');
  });

  it('should return Good for 3.5 stars', () => {
    expect(getStarLabel(3.5)).toBe('Good');
  });

  it('should return Acceptable for 3.0 stars', () => {
    expect(getStarLabel(3.0)).toBe('Acceptable');
  });

  it('should return Below Average for 2.5 stars', () => {
    expect(getStarLabel(2.5)).toBe('Below Average');
  });

  it('should return Poor for 2.0 stars', () => {
    expect(getStarLabel(2.0)).toBe('Poor');
  });

  it('should return Not Recommended for < 2.0 stars', () => {
    expect(getStarLabel(1.0)).toBe('Not Recommended');
  });
});

describe('calculateWineRatings', () => {
  it('should calculate indices from multiple lens ratings', () => {
    const ratings = [
      { source: 'iwc', source_lens: 'competition', normalized_mid: 94, vintage_match: 'exact', match_confidence: 'high' },
      { source: 'wine_spectator', source_lens: 'critic', normalized_mid: 92, vintage_match: 'exact', match_confidence: 'high' },
      { source: 'vivino', source_lens: 'community', normalized_mid: 88, vintage_match: 'inferred', match_confidence: 'medium' }
    ];
    const wine = { country: 'France', style: 'Bordeaux' };

    const result = calculateWineRatings(ratings, wine);

    expect(result.competition_index).toBeDefined();
    expect(result.critics_index).toBeDefined();
    expect(result.community_index).toBeDefined();
    expect(result.purchase_score).toBeDefined();
    expect(result.purchase_stars).toBeDefined();
  });

  it('should return null indices for empty ratings', () => {
    const result = calculateWineRatings([], { country: 'France', style: 'Burgundy' });

    expect(result.competition_index).toBeNull();
    expect(result.critics_index).toBeNull();
    expect(result.community_index).toBeNull();
    expect(result.purchase_score).toBeNull();
    expect(result.purchase_stars).toBeNull();
    expect(result.confidence_level).toBe('unrated');
  });

  it('should handle panel_guide lens correctly (map to critics)', () => {
    const ratings = [
      { source: 'gambero_rosso', source_lens: 'panel_guide', normalized_mid: 95, vintage_match: 'exact', match_confidence: 'high' }
    ];
    const wine = { country: 'Italy', style: 'Barolo' };

    const result = calculateWineRatings(ratings, wine);

    expect(result.critics_index).toBeDefined();
    expect(result.critics_index).not.toBeNull();
  });

  it('should respect user preference slider', () => {
    const ratings = [
      { source: 'iwc', source_lens: 'competition', normalized_mid: 95, vintage_match: 'exact', match_confidence: 'high' },
      { source: 'vivino', source_lens: 'community', normalized_mid: 85, vintage_match: 'inferred', match_confidence: 'medium' }
    ];
    const wine = { country: 'France', style: 'Bordeaux' };

    // Favor competition (+100)
    const competitionFavored = calculateWineRatings(ratings, wine, 100);
    // Favor community (-100)
    const communityFavored = calculateWineRatings(ratings, wine, -100);

    // Competition-favored should have higher purchase score (closer to 95)
    expect(competitionFavored.purchase_score).toBeGreaterThan(communityFavored.purchase_score);
  });
});
