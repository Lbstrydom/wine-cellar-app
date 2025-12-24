# Phase 4: Wine Ratings Aggregation - Implementation Guide

## Overview

Add wine ratings aggregation with a three-lens scoring system (Competition, Critics, Community), source-specific normalization, regional relevance weighting, and user preference controls.

**Purpose**: Purchase guidance - help users make confident buying decisions based on credible ratings.

**Prerequisites**: 
- Phase 1-3 complete
- Claude API integration working
- Codebase follows AGENTS.md conventions

---

## Core Concepts

### Three-Lens Scoring

Instead of one aggregate, we display three distinct indices:

| Lens | Sources | Purpose |
|------|---------|---------|
| **Competition Index** | Blind panel competitions (DWWA, IWC, CMB, etc.) | Primary trust signal |
| **Critics Index** | Single critics, panel guides (Tim Atkin, Platter's) | Coverage when comps missing |
| **Community Index** | Crowd-sourced (Vivino) | Market signal, not quality guarantee |

Users see a **Purchase Score** (weighted blend of lenses) with a **Confidence Badge**.

### Credibility vs Relevance

Each source has two weight factors:

- **Credibility** (methodology quality): Fixed per source
- **Relevance** (regional applicability): Depends on wine's origin

```
effective_weight = credibility × relevance(wine.country)
```

### User Preference Slider

Global setting that shifts weight between Competition and Community:

```
slider: -100 (community-max) ← 0 (balanced) → +100 (competition-max)
default: +40 (competition-biased)

competition_multiplier = 1 + 0.75 × (slider/100)  // 0.25 to 1.75
community_multiplier = 1 - 0.75 × (slider/100)    // 1.75 to 0.25
critics_multiplier = 1.0                          // neutral
```

---

## Rating Sources

### Source Registry

```javascript
const RATING_SOURCES = {
  // COMPETITIONS (lens: competition)
  decanter: {
    name: 'Decanter World Wine Awards',
    short_name: 'DWWA',
    lens: 'competition',
    credibility: 1.0,
    scope: 'global',
    home_regions: [],
    score_type: 'medal',
    medal_bands: {
      platinum: { min: 97, max: 100, label: 'Platinum' },
      gold: { min: 95, max: 96, label: 'Gold' },
      silver: { min: 90, max: 94, label: 'Silver' },
      bronze: { min: 86, max: 89, label: 'Bronze' },
      commended: { min: 83, max: 85, label: 'Commended' }
    }
  },
  iwc: {
    name: 'International Wine Challenge',
    short_name: 'IWC',
    lens: 'competition',
    credibility: 1.0,
    scope: 'global',
    home_regions: [],
    score_type: 'medal',
    medal_bands: {
      trophy: { min: 97, max: 100, label: 'Trophy' },
      gold: { min: 95, max: 100, label: 'Gold' },
      silver: { min: 90, max: 94, label: 'Silver' },
      bronze: { min: 85, max: 89, label: 'Bronze' },
      commended: { min: 80, max: 84, label: 'Commended' }
    }
  },
  iwsc: {
    name: 'International Wine & Spirit Competition',
    short_name: 'IWSC',
    lens: 'competition',
    credibility: 1.0,
    scope: 'global',
    home_regions: [],
    score_type: 'medal',
    medal_bands: {
      gold_outstanding: { min: 98, max: 100, label: 'Gold Outstanding' },
      gold: { min: 95, max: 97, label: 'Gold' },
      silver: { min: 90, max: 94, label: 'Silver' },
      bronze: { min: 85, max: 89, label: 'Bronze' }
    }
  },
  concours_mondial: {
    name: 'Concours Mondial de Bruxelles',
    short_name: 'CMB',
    lens: 'competition',
    credibility: 0.95,
    scope: 'global',
    home_regions: [],
    score_type: 'medal',
    medal_bands: {
      grand_gold: { min: 92, max: 100, label: 'Grand Gold' },
      gold: { min: 85, max: 91.9, label: 'Gold' },
      silver: { min: 82, max: 84.9, label: 'Silver' }
    }
  },
  mundus_vini: {
    name: 'Mundus Vini',
    short_name: 'Mundus Vini',
    lens: 'competition',
    credibility: 0.85,
    scope: 'global',
    home_regions: [],
    score_type: 'medal',
    medal_bands: {
      grand_gold: { min: 95, max: 100, label: 'Grand Gold' },
      gold: { min: 90, max: 94, label: 'Gold' },
      silver: { min: 85, max: 89, label: 'Silver' }
    }
  },
  
  // REGIONAL COMPETITIONS (lens: competition, regional relevance)
  veritas: {
    name: 'Veritas Awards',
    short_name: 'Veritas',
    lens: 'competition',
    credibility: 0.9,
    scope: 'national',
    home_regions: ['South Africa'],
    score_type: 'medal',
    medal_bands: {
      double_gold: { min: 95, max: 100, label: 'Double Gold' },
      gold: { min: 90, max: 94, label: 'Gold' },
      silver: { min: 85, max: 89, label: 'Silver' },
      bronze: { min: 80, max: 84, label: 'Bronze' }
    }
  },
  old_mutual: {
    name: 'Old Mutual Trophy Wine Show',
    short_name: 'Old Mutual',
    lens: 'competition',
    credibility: 0.9,
    scope: 'national',
    home_regions: ['South Africa'],
    score_type: 'medal',
    medal_bands: {
      trophy: { min: 95, max: 100, label: 'Trophy' },
      gold: { min: 90, max: 94, label: 'Gold' },
      silver: { min: 85, max: 89, label: 'Silver' },
      bronze: { min: 80, max: 84, label: 'Bronze' }
    }
  },
  chardonnay_du_monde: {
    name: 'Chardonnay du Monde',
    short_name: 'Chard du Monde',
    lens: 'competition',
    credibility: 0.85,
    scope: 'varietal',
    home_regions: [],  // Global but only for Chardonnay
    applicable_styles: ['Chardonnay'],
    score_type: 'medal',
    medal_bands: {
      gold: { min: 92, max: 100, label: 'Gold' },
      silver: { min: 85, max: 91, label: 'Silver' },
      bronze: { min: 80, max: 84, label: 'Bronze' }
    }
  },
  syrah_du_monde: {
    name: 'Syrah du Monde',
    short_name: 'Syrah du Monde',
    lens: 'competition',
    credibility: 0.85,
    scope: 'varietal',
    home_regions: [],
    applicable_styles: ['Syrah', 'Shiraz'],
    score_type: 'medal',
    medal_bands: {
      gold: { min: 92, max: 100, label: 'Gold' },
      silver: { min: 85, max: 91, label: 'Silver' },
      bronze: { min: 80, max: 84, label: 'Bronze' }
    }
  },
  
  // CRITICS / GUIDES (lens: critics)
  tim_atkin: {
    name: 'Tim Atkin MW',
    short_name: 'Tim Atkin',
    lens: 'critics',
    credibility: 0.8,
    scope: 'regional',
    home_regions: ['South Africa', 'Argentina'],
    score_type: 'points',
    points_scale: { min: 0, max: 100 }
  },
  platters: {
    name: "Platter's Wine Guide",
    short_name: "Platter's",
    lens: 'critics',
    credibility: 0.85,
    scope: 'national',
    home_regions: ['South Africa'],
    score_type: 'stars',
    stars_conversion: {
      5: { min: 95, max: 100, label: '5 Stars' },
      4.5: { min: 90, max: 94, label: '4.5 Stars' },
      4: { min: 85, max: 89, label: '4 Stars' },
      3.5: { min: 80, max: 84, label: '3.5 Stars' },
      3: { min: 75, max: 79, label: '3 Stars' }
    }
  },
  
  // COMMUNITY (lens: community)
  vivino: {
    name: 'Vivino',
    short_name: 'Vivino',
    lens: 'community',
    credibility: 0.5,
    scope: 'global',
    home_regions: [],
    score_type: 'stars',
    stars_conversion: {
      4.5: { min: 92, max: 100 },
      4.2: { min: 88, max: 91 },
      4.0: { min: 85, max: 87 },
      3.7: { min: 82, max: 84 },
      3.4: { min: 78, max: 81 },
      3.0: { min: 74, max: 77 },
      2.5: { min: 70, max: 73 },
      2.0: { min: 60, max: 69 }
    },
    min_ratings_for_confidence: 100  // Need at least 100 ratings to be meaningful
  }
};
```

### Relevance Calculation

```javascript
function getRelevance(source, wine) {
  const config = RATING_SOURCES[source];
  
  // Global sources always relevant
  if (config.scope === 'global') return 1.0;
  
  // Varietal competitions only relevant for matching styles
  if (config.scope === 'varietal') {
    const wineStyle = (wine.style || '').toLowerCase();
    const matches = config.applicable_styles?.some(s => 
      wineStyle.includes(s.toLowerCase())
    );
    return matches ? 1.0 : 0.0;
  }
  
  // Regional/national competitions
  if (config.home_regions?.includes(wine.country)) {
    return 1.0;  // Full relevance for home region
  }
  
  // Out-of-region: minimal relevance (show but don't weight heavily)
  return 0.1;
}
```

---

## Data Model

### Database Schema

```sql
-- Rating sources reference (can be in code, but useful for queries)
CREATE TABLE rating_sources (
  id TEXT PRIMARY KEY,                    -- 'decanter', 'iwc', etc.
  name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  lens TEXT NOT NULL,                     -- 'competition', 'critics', 'community'
  credibility REAL NOT NULL,              -- 0.0 to 1.0
  scope TEXT NOT NULL,                    -- 'global', 'national', 'regional', 'varietal'
  home_regions TEXT,                      -- JSON array
  score_type TEXT NOT NULL                -- 'medal', 'points', 'stars'
);

-- Individual ratings
CREATE TABLE wine_ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wine_id INTEGER NOT NULL,
  vintage INTEGER,                        -- NULL if non-vintage-specific
  
  -- Source info
  source TEXT NOT NULL,                   -- FK to rating_sources
  source_lens TEXT NOT NULL,              -- 'competition', 'critics', 'community'
  
  -- Raw score (as received)
  score_type TEXT NOT NULL,               -- 'medal', 'points', 'stars'
  raw_score TEXT NOT NULL,                -- 'Gold', '92', '4.1'
  raw_score_numeric REAL,                 -- Numeric value if applicable
  
  -- Normalized score (for aggregation)
  normalized_min REAL NOT NULL,           -- Lower bound of band
  normalized_max REAL NOT NULL,           -- Upper bound of band  
  normalized_mid REAL NOT NULL,           -- Midpoint (used for calculations)
  
  -- Metadata
  award_name TEXT,                        -- 'Best in Show', 'Regional Trophy', etc.
  competition_year INTEGER,
  reviewer_name TEXT,                     -- For critic sources
  rating_count INTEGER,                   -- For crowd-sourced (Vivino)
  
  -- Evidence (for verification)
  source_url TEXT,
  evidence_excerpt TEXT,                  -- Short quoted snippet from source
  matched_wine_label TEXT,                -- Exact label/name from source
  
  -- Tracking
  fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  vintage_match TEXT DEFAULT 'exact',     -- 'exact', 'inferred', 'non_vintage', 'mismatch'
  match_confidence TEXT DEFAULT 'high',   -- 'high', 'medium', 'low'
  
  -- User overrides
  is_user_override BOOLEAN DEFAULT 0,
  override_normalized_mid REAL,           -- User's corrected value
  override_note TEXT,
  
  FOREIGN KEY (wine_id) REFERENCES wines(id),
  UNIQUE(wine_id, vintage, source, competition_year, award_name)
);

CREATE INDEX idx_ratings_wine ON wine_ratings(wine_id);
CREATE INDEX idx_ratings_wine_vintage ON wine_ratings(wine_id, vintage);
CREATE INDEX idx_ratings_lens ON wine_ratings(source_lens);

-- Cached aggregates on wines table
ALTER TABLE wines ADD COLUMN country TEXT;
ALTER TABLE wines ADD COLUMN competition_index REAL;
ALTER TABLE wines ADD COLUMN critics_index REAL;
ALTER TABLE wines ADD COLUMN community_index REAL;
ALTER TABLE wines ADD COLUMN purchase_score REAL;
ALTER TABLE wines ADD COLUMN purchase_stars REAL;
ALTER TABLE wines ADD COLUMN confidence_level TEXT;          -- 'high', 'medium', 'low', 'unrated'
ALTER TABLE wines ADD COLUMN ratings_updated_at DATETIME;

-- User preferences
CREATE TABLE IF NOT EXISTS user_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Default preference slider (+40 competition bias)
INSERT OR IGNORE INTO user_settings (key, value) VALUES ('rating_preference', '40');
```

---

## Aggregation Logic

### Calculate Lens Indices

```javascript
/**
 * Calculate index for a single lens (competition/critics/community).
 * Uses weighted median for robustness.
 * @param {Array} ratings - Ratings for this lens
 * @param {Object} wine - Wine object (for relevance calc)
 * @returns {Object} { index, sourceCount, confidence }
 */
function calculateLensIndex(ratings, wine) {
  if (!ratings || ratings.length === 0) {
    return { index: null, sourceCount: 0, confidence: 'unrated' };
  }
  
  // Calculate weighted scores
  const weighted = ratings.map(r => {
    const source = RATING_SOURCES[r.source];
    const relevance = getRelevance(r.source, wine);
    const credibility = source.credibility;
    const effectiveWeight = credibility * relevance;
    
    // Use override if present, otherwise midpoint
    const score = r.is_user_override && r.override_normalized_mid 
      ? r.override_normalized_mid 
      : r.normalized_mid;
    
    return { score, weight: effectiveWeight, rating: r };
  }).filter(w => w.weight > 0);  // Exclude zero-relevance
  
  if (weighted.length === 0) {
    return { index: null, sourceCount: 0, confidence: 'unrated' };
  }
  
  // Weighted median (robust to outliers)
  const index = weightedMedian(weighted);
  
  // Confidence based on coverage, variance, vintage match
  const confidence = calculateConfidence(weighted);
  
  return { 
    index: Math.round(index * 10) / 10,  // 1 decimal place
    sourceCount: weighted.length,
    confidence 
  };
}

/**
 * Calculate weighted median.
 */
function weightedMedian(items) {
  // Sort by score
  items.sort((a, b) => a.score - b.score);
  
  const totalWeight = items.reduce((sum, i) => sum + i.weight, 0);
  let cumulative = 0;
  
  for (const item of items) {
    cumulative += item.weight;
    if (cumulative >= totalWeight / 2) {
      return item.score;
    }
  }
  
  return items[items.length - 1].score;
}

/**
 * Calculate confidence level.
 */
function calculateConfidence(weightedItems) {
  const count = weightedItems.length;
  const scores = weightedItems.map(w => w.score);
  const variance = calculateVariance(scores);
  const hasExactVintage = weightedItems.some(w => w.rating.vintage_match === 'exact');
  const avgMatchConfidence = weightedItems.reduce((sum, w) => {
    const conf = { high: 1, medium: 0.6, low: 0.3 }[w.rating.match_confidence] || 0.5;
    return sum + conf;
  }, 0) / count;
  
  // High: multiple sources, low variance, exact vintage, high match confidence
  if (count >= 2 && variance < 15 && hasExactVintage && avgMatchConfidence > 0.8) {
    return 'high';
  }
  
  // Medium: at least one decent source
  if (count >= 1 && avgMatchConfidence > 0.5) {
    return 'medium';
  }
  
  return 'low';
}

function calculateVariance(values) {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
}
```

### Calculate Purchase Score

```javascript
/**
 * Calculate final purchase score from lens indices.
 * @param {Object} lensIndices - { competition, critics, community }
 * @param {number} preferenceSlider - -100 to +100 (default +40)
 * @returns {Object} { score, stars, confidence }
 */
function calculatePurchaseScore(lensIndices, preferenceSlider = 40) {
  const pref = preferenceSlider / 100;  // -1.0 to +1.0
  
  const multipliers = {
    competition: 1 + 0.75 * pref,   // 0.25 to 1.75
    critics: 1.0,                    // neutral
    community: 1 - 0.75 * pref       // 1.75 to 0.25
  };
  
  let totalWeight = 0;
  let weightedSum = 0;
  let confidences = [];
  
  for (const [lens, data] of Object.entries(lensIndices)) {
    if (data.index !== null) {
      const weight = multipliers[lens] * data.sourceCount;
      weightedSum += data.index * weight;
      totalWeight += weight;
      confidences.push(data.confidence);
    }
  }
  
  if (totalWeight === 0) {
    return { score: null, stars: null, confidence: 'unrated' };
  }
  
  const score = Math.round((weightedSum / totalWeight) * 10) / 10;
  const stars = pointsToStars(score);
  
  // Overall confidence is the minimum of lens confidences
  const confidenceOrder = ['unrated', 'low', 'medium', 'high'];
  const minConfidence = confidences.reduce((min, c) => 
    confidenceOrder.indexOf(c) < confidenceOrder.indexOf(min) ? c : min
  , 'high');
  
  return { score, stars, confidence: minConfidence };
}

/**
 * Convert points to stars (0.5 increments).
 */
function pointsToStars(points) {
  if (points >= 95) return 5.0;
  if (points >= 92) return 4.5;
  if (points >= 89) return 4.0;
  if (points >= 86) return 3.5;
  if (points >= 82) return 3.0;
  if (points >= 78) return 2.5;
  if (points >= 74) return 2.0;
  if (points >= 70) return 1.5;
  return 1.0;
}

/**
 * Get label for star rating.
 */
function getStarLabel(stars) {
  if (stars >= 4.5) return 'Exceptional';
  if (stars >= 4.0) return 'Very Good';
  if (stars >= 3.5) return 'Good';
  if (stars >= 3.0) return 'Acceptable';
  if (stars >= 2.5) return 'Below Average';
  if (stars >= 2.0) return 'Poor';
  return 'Not Recommended';
}
```

---

## Files to Create/Modify

### Backend

| File | Action |
|------|--------|
| `src/config/ratingSources.js` | **CREATE** - Source registry (from above) |
| `src/services/ratings.js` | **CREATE** - Aggregation logic |
| `src/services/claude.js` | **UPDATE** - Add rating fetch function |
| `src/routes/ratings.js` | **CREATE** - Rating endpoints |
| `src/routes/index.js` | **UPDATE** - Add ratings routes |
| `src/routes/settings.js` | **CREATE** - User settings endpoint |
| `data/schema.sql` | **UPDATE** - Add tables/columns |

### Frontend

| File | Action |
|------|--------|
| `public/js/ratings.js` | **CREATE** - Ratings UI module |
| `public/js/api.js` | **UPDATE** - Add rating API calls |
| `public/js/modals.js` | **UPDATE** - Add ratings to wine modal |
| `public/js/grid.js` | **UPDATE** - Show stars on wine cards |
| `public/js/settings.js` | **CREATE** - Settings UI |
| `public/index.html` | **UPDATE** - Add ratings UI, settings |
| `public/css/styles.css` | **UPDATE** - Rating styles |

---

## Backend Implementation

### Create src/config/ratingSources.js

```javascript
/**
 * @fileoverview Rating source definitions and configuration.
 * @module config/ratingSources
 */

export const RATING_SOURCES = {
  // ... (full source registry from above)
};

export const LENS_ORDER = ['competition', 'critics', 'community'];

export function getSourceConfig(sourceId) {
  return RATING_SOURCES[sourceId] || null;
}

export function getSourcesByLens(lens) {
  return Object.entries(RATING_SOURCES)
    .filter(([_, config]) => config.lens === lens)
    .map(([id, config]) => ({ id, ...config }));
}
```

### Create src/services/ratings.js

```javascript
/**
 * @fileoverview Rating aggregation and calculation logic.
 * @module services/ratings
 */

import { RATING_SOURCES } from '../config/ratingSources.js';

/**
 * Normalize a raw score to the 0-100 scale.
 * @param {string} source - Source ID
 * @param {string} scoreType - 'medal', 'points', 'stars'
 * @param {string} rawScore - Raw score value
 * @returns {Object} { min, max, mid }
 */
export function normalizeScore(source, scoreType, rawScore) {
  const config = RATING_SOURCES[source];
  if (!config) throw new Error(`Unknown source: ${source}`);
  
  if (scoreType === 'points') {
    const points = parseFloat(rawScore);
    return { min: points, max: points, mid: points };
  }
  
  if (scoreType === 'medal') {
    const medalKey = rawScore.toLowerCase().replace(/\s+/g, '_');
    const band = config.medal_bands?.[medalKey];
    if (band) {
      return { 
        min: band.min, 
        max: band.max, 
        mid: (band.min + band.max) / 2 
      };
    }
    // Unknown medal - conservative estimate
    return { min: 80, max: 85, mid: 82.5 };
  }
  
  if (scoreType === 'stars') {
    const stars = parseFloat(rawScore);
    const conversion = config.stars_conversion;
    
    // Find closest star bracket
    const brackets = Object.keys(conversion).map(Number).sort((a, b) => b - a);
    for (const bracket of brackets) {
      if (stars >= bracket) {
        const band = conversion[bracket];
        return { min: band.min, max: band.max, mid: (band.min + band.max) / 2 };
      }
    }
    return { min: 60, max: 70, mid: 65 };
  }
  
  throw new Error(`Unknown score type: ${scoreType}`);
}

/**
 * Get relevance weight for a source given a wine.
 */
export function getRelevance(sourceId, wine) {
  const config = RATING_SOURCES[sourceId];
  if (!config) return 0;
  
  if (config.scope === 'global') return 1.0;
  
  if (config.scope === 'varietal') {
    const wineStyle = (wine.style || '').toLowerCase();
    const matches = config.applicable_styles?.some(s => 
      wineStyle.includes(s.toLowerCase())
    );
    return matches ? 1.0 : 0.0;
  }
  
  if (config.home_regions?.includes(wine.country)) {
    return 1.0;
  }
  
  return 0.1;
}

/**
 * Calculate all indices and purchase score for a wine.
 */
export function calculateWineRatings(ratings, wine, preferenceSlider = 40) {
  // Group by lens
  const byLens = {
    competition: ratings.filter(r => r.source_lens === 'competition'),
    critics: ratings.filter(r => r.source_lens === 'critics'),
    community: ratings.filter(r => r.source_lens === 'community')
  };
  
  // Calculate lens indices
  const lensIndices = {};
  for (const [lens, lensRatings] of Object.entries(byLens)) {
    lensIndices[lens] = calculateLensIndex(lensRatings, wine);
  }
  
  // Calculate purchase score
  const purchase = calculatePurchaseScore(lensIndices, preferenceSlider);
  
  return {
    competition_index: lensIndices.competition.index,
    critics_index: lensIndices.critics.index,
    community_index: lensIndices.community.index,
    purchase_score: purchase.score,
    purchase_stars: purchase.stars,
    confidence_level: purchase.confidence,
    lens_details: lensIndices
  };
}

// ... (include calculateLensIndex, weightedMedian, calculateConfidence, 
//      calculatePurchaseScore, pointsToStars, getStarLabel from above)
```

### Update src/services/claude.js

Add this function:

```javascript
/**
 * Fetch wine ratings from various sources using Claude web search.
 * @param {Object} wine - Wine object with name, vintage, country, style
 * @returns {Promise<Object>} Fetched ratings
 */
export async function fetchWineRatings(wine) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Claude API key not configured');
  }

  const prompt = `You are a wine rating research assistant. Search for professional ratings and competition results for this wine:

Wine: ${wine.wine_name}
Vintage: ${wine.vintage || 'NV'}
Producer: ${wine.wine_name.split(' ')[0]}
Style/Grape: ${wine.style || 'Unknown'}
Country: ${wine.country || 'Unknown'}

Search for ratings from these sources (prioritized):

COMPETITION (blind panel):
- Decanter World Wine Awards (DWWA)
- International Wine Challenge (IWC)
- International Wine & Spirit Competition (IWSC)
- Concours Mondial de Bruxelles
- Mundus Vini
${wine.country === 'South Africa' ? '- Veritas Awards\n- Old Mutual Trophy Wine Show' : ''}
${wine.style?.toLowerCase().includes('chardonnay') ? '- Chardonnay du Monde' : ''}
${wine.style?.toLowerCase().includes('syrah') || wine.style?.toLowerCase().includes('shiraz') ? '- Syrah du Monde' : ''}

CRITICS/GUIDES:
${wine.country === 'South Africa' ? "- Platter's Wine Guide\n- Tim Atkin SA Report" : ''}
${wine.country === 'Argentina' ? '- Tim Atkin Argentina Report' : ''}

COMMUNITY:
- Vivino (include rating count)

For EACH rating found, extract:
{
  "source": "source_id",           // e.g., "decanter", "iwc", "vivino"
  "lens": "competition|critics|community",
  "score_type": "medal|points|stars",
  "raw_score": "Gold|92|4.1",
  "competition_year": 2024,
  "award_name": "Trophy/Best in Show" or null,
  "rating_count": 1234 (for Vivino),
  "source_url": "https://...",
  "evidence_excerpt": "Short quote from source",
  "matched_wine_label": "Exact name on source",
  "vintage_match": "exact|inferred|non_vintage|mismatch",
  "match_confidence": "high|medium|low"
}

Return ONLY valid JSON:
{
  "ratings": [...],
  "search_notes": "Brief summary of what was found/not found"
}

RULES:
- Only include ratings you can verify from search results
- Match vintage exactly where possible
- For Vivino, note if the rating is non-vintage-specific
- Do NOT fabricate ratings - only report what you find
- If a source has multiple awards for same wine (medal + trophy), include both
- Set match_confidence based on how certain the wine match is`;

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250514',
    max_tokens: 2000,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages: [{ role: 'user', content: prompt }]
  });

  // Extract text response
  const textContent = message.content.find(c => c.type === 'text');
  if (!textContent) {
    throw new Error('No response from Claude');
  }

  try {
    const jsonMatch = textContent.text.match(/```json\s*([\s\S]*?)\s*```/) || 
                      textContent.text.match(/```\s*([\s\S]*?)\s*```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : textContent.text;
    return JSON.parse(jsonStr.trim());
  } catch (parseError) {
    console.error('Failed to parse rating response:', textContent.text);
    throw new Error('Could not parse rating results');
  }
}
```

### Create src/routes/ratings.js

```javascript
/**
 * @fileoverview Wine rating endpoints.
 * @module routes/ratings
 */

import { Router } from 'express';
import db from '../db/index.js';
import { RATING_SOURCES } from '../config/ratingSources.js';
import { normalizeScore, calculateWineRatings } from '../services/ratings.js';
import { fetchWineRatings } from '../services/claude.js';

const router = Router();

/**
 * Get all ratings for a wine.
 * @route GET /api/wines/:id/ratings
 */
router.get('/:wineId/ratings', (req, res) => {
  const { wineId } = req.params;
  const vintage = req.query.vintage;
  
  let query = `SELECT * FROM wine_ratings WHERE wine_id = ?`;
  const params = [wineId];
  
  if (vintage) {
    query += ` AND (vintage = ? OR vintage IS NULL)`;
    params.push(vintage);
  }
  
  query += ` ORDER BY source_lens, normalized_mid DESC`;
  
  const ratings = db.prepare(query).all(...params);
  const wine = db.prepare('SELECT * FROM wines WHERE id = ?').get(wineId);
  
  if (!wine) {
    return res.status(404).json({ error: 'Wine not found' });
  }
  
  // Get user preference
  const prefSetting = db.prepare("SELECT value FROM user_settings WHERE key = 'rating_preference'").get();
  const preference = parseInt(prefSetting?.value || '40');
  
  // Calculate aggregates
  const aggregates = calculateWineRatings(ratings, wine, preference);
  
  res.json({
    wine_id: wineId,
    wine_name: wine.wine_name,
    vintage: wine.vintage,
    ...aggregates,
    ratings: ratings.map(r => ({
      ...r,
      source_name: RATING_SOURCES[r.source]?.name || r.source,
      source_short: RATING_SOURCES[r.source]?.short_name || r.source
    }))
  });
});

/**
 * Fetch ratings from web using Claude.
 * @route POST /api/wines/:id/ratings/fetch
 */
router.post('/:wineId/ratings/fetch', async (req, res) => {
  const { wineId } = req.params;
  
  const wine = db.prepare('SELECT * FROM wines WHERE id = ?').get(wineId);
  if (!wine) {
    return res.status(404).json({ error: 'Wine not found' });
  }
  
  try {
    const result = await fetchWineRatings(wine);
    
    // Store ratings
    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO wine_ratings (
        wine_id, vintage, source, source_lens, score_type, raw_score, raw_score_numeric,
        normalized_min, normalized_max, normalized_mid,
        award_name, competition_year, rating_count,
        source_url, evidence_excerpt, matched_wine_label,
        vintage_match, match_confidence, fetched_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    
    for (const rating of result.ratings || []) {
      const sourceConfig = RATING_SOURCES[rating.source];
      if (!sourceConfig) continue;
      
      const normalized = normalizeScore(rating.source, rating.score_type, rating.raw_score);
      const numericScore = parseFloat(rating.raw_score) || null;
      
      insertStmt.run(
        wineId,
        wine.vintage,
        rating.source,
        rating.lens || sourceConfig.lens,
        rating.score_type,
        rating.raw_score,
        numericScore,
        normalized.min,
        normalized.max,
        normalized.mid,
        rating.award_name || null,
        rating.competition_year || null,
        rating.rating_count || null,
        rating.source_url || null,
        rating.evidence_excerpt || null,
        rating.matched_wine_label || null,
        rating.vintage_match || 'inferred',
        rating.match_confidence || 'medium'
      );
    }
    
    // Update wine's cached aggregates
    const ratings = db.prepare('SELECT * FROM wine_ratings WHERE wine_id = ?').all(wineId);
    const prefSetting = db.prepare("SELECT value FROM user_settings WHERE key = 'rating_preference'").get();
    const preference = parseInt(prefSetting?.value || '40');
    const aggregates = calculateWineRatings(ratings, wine, preference);
    
    db.prepare(`
      UPDATE wines SET 
        competition_index = ?, critics_index = ?, community_index = ?,
        purchase_score = ?, purchase_stars = ?, confidence_level = ?,
        ratings_updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      aggregates.competition_index,
      aggregates.critics_index,
      aggregates.community_index,
      aggregates.purchase_score,
      aggregates.purchase_stars,
      aggregates.confidence_level,
      wineId
    );
    
    res.json({
      message: `Found ${result.ratings?.length || 0} ratings`,
      search_notes: result.search_notes,
      ...aggregates
    });
    
  } catch (error) {
    console.error('Rating fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Add manual rating.
 * @route POST /api/wines/:id/ratings
 */
router.post('/:wineId/ratings', (req, res) => {
  const { wineId } = req.params;
  const { source, score_type, raw_score, competition_year, award_name, source_url, notes } = req.body;
  
  const wine = db.prepare('SELECT * FROM wines WHERE id = ?').get(wineId);
  if (!wine) {
    return res.status(404).json({ error: 'Wine not found' });
  }
  
  const sourceConfig = RATING_SOURCES[source];
  if (!sourceConfig) {
    return res.status(400).json({ error: 'Unknown rating source' });
  }
  
  const normalized = normalizeScore(source, score_type, raw_score);
  
  const result = db.prepare(`
    INSERT INTO wine_ratings (
      wine_id, vintage, source, source_lens, score_type, raw_score,
      normalized_min, normalized_max, normalized_mid,
      award_name, competition_year, source_url,
      is_user_override, override_note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).run(
    wineId, wine.vintage, source, sourceConfig.lens, score_type, raw_score,
    normalized.min, normalized.max, normalized.mid,
    award_name || null, competition_year || null, source_url || null,
    notes || null
  );
  
  res.json({ id: result.lastInsertRowid, message: 'Rating added' });
});

/**
 * Update/override a rating.
 * @route PUT /api/wines/:id/ratings/:ratingId
 */
router.put('/:wineId/ratings/:ratingId', (req, res) => {
  const { wineId, ratingId } = req.params;
  const { override_normalized_mid, override_note } = req.body;
  
  db.prepare(`
    UPDATE wine_ratings 
    SET is_user_override = 1, override_normalized_mid = ?, override_note = ?
    WHERE id = ? AND wine_id = ?
  `).run(override_normalized_mid, override_note || null, ratingId, wineId);
  
  res.json({ message: 'Rating updated' });
});

/**
 * Delete a rating.
 * @route DELETE /api/wines/:id/ratings/:ratingId
 */
router.delete('/:wineId/ratings/:ratingId', (req, res) => {
  const { wineId, ratingId } = req.params;
  
  db.prepare('DELETE FROM wine_ratings WHERE id = ? AND wine_id = ?').run(ratingId, wineId);
  
  res.json({ message: 'Rating deleted' });
});

/**
 * Get available rating sources.
 * @route GET /api/ratings/sources
 */
router.get('/sources', (req, res) => {
  const sources = Object.entries(RATING_SOURCES).map(([id, config]) => ({
    id,
    name: config.name,
    short_name: config.short_name,
    lens: config.lens,
    scope: config.scope,
    score_type: config.score_type
  }));
  res.json(sources);
});

export default router;
```

### Create src/routes/settings.js

```javascript
/**
 * @fileoverview User settings endpoints.
 * @module routes/settings
 */

import { Router } from 'express';
import db from '../db/index.js';

const router = Router();

/**
 * Get all settings.
 * @route GET /api/settings
 */
router.get('/', (req, res) => {
  const settings = db.prepare('SELECT key, value FROM user_settings').all();
  const result = {};
  for (const s of settings) {
    result[s.key] = s.value;
  }
  res.json(result);
});

/**
 * Update a setting.
 * @route PUT /api/settings/:key
 */
router.put('/:key', (req, res) => {
  const { key } = req.params;
  const { value } = req.body;
  
  db.prepare(`
    INSERT INTO user_settings (key, value, updated_at) 
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP
  `).run(key, value, value);
  
  res.json({ message: 'Setting updated' });
});

export default router;
```

### Update src/routes/index.js

```javascript
import ratingsRouter from './ratings.js';
import settingsRouter from './settings.js';

// ... existing routes ...

router.use('/wines', wineRoutes);
router.use('/wines', ratingsRouter);  // Nested under /wines for :wineId routes
router.use('/ratings', ratingsRouter); // Also at /ratings for /sources
router.use('/settings', settingsRouter);
```

---

## Frontend Implementation

### Create public/js/ratings.js

```javascript
/**
 * @fileoverview Wine ratings UI module.
 * @module ratings
 */

import { fetchWineRatings, getWineRatings, addManualRating } from './api.js';
import { showToast } from './utils.js';

/**
 * Render star rating display.
 * @param {number} stars - Star rating (0-5, half increments)
 * @param {string} size - 'small' or 'large'
 * @returns {string} HTML string
 */
export function renderStars(stars, size = 'small') {
  if (stars === null || stars === undefined) {
    return `<span class="stars-unrated ${size}">Unrated</span>`;
  }
  
  const fullStars = Math.floor(stars);
  const hasHalf = stars % 1 >= 0.5;
  const emptyStars = 5 - fullStars - (hasHalf ? 1 : 0);
  
  let html = `<span class="stars-display ${size}">`;
  html += '★'.repeat(fullStars);
  if (hasHalf) html += '½';
  html += '☆'.repeat(emptyStars);
  html += `</span>`;
  
  return html;
}

/**
 * Render confidence badge.
 * @param {string} level - 'high', 'medium', 'low', 'unrated'
 * @returns {string} HTML string
 */
export function renderConfidenceBadge(level) {
  const labels = {
    high: { text: 'High', class: 'confidence-high' },
    medium: { text: 'Med', class: 'confidence-medium' },
    low: { text: 'Low', class: 'confidence-low' },
    unrated: { text: '-', class: 'confidence-unrated' }
  };
  const config = labels[level] || labels.unrated;
  return `<span class="confidence-badge ${config.class}">${config.text}</span>`;
}

/**
 * Render compact rating display for wine cards.
 * @param {Object} wine - Wine object with rating fields
 * @returns {string} HTML string
 */
export function renderCompactRating(wine) {
  if (!wine.purchase_stars) {
    return '';
  }
  
  return `
    <div class="wine-rating-compact">
      ${renderStars(wine.purchase_stars, 'small')}
      ${renderConfidenceBadge(wine.confidence_level)}
    </div>
  `;
}

/**
 * Render full ratings panel for wine modal.
 * @param {Object} ratingsData - Full ratings response
 * @returns {string} HTML string
 */
export function renderRatingsPanel(ratingsData) {
  if (!ratingsData || ratingsData.confidence_level === 'unrated') {
    return `
      <div class="ratings-panel unrated">
        <p>No ratings available</p>
        <button class="btn btn-secondary btn-small" id="fetch-ratings-btn">
          🔍 Find Ratings
        </button>
      </div>
    `;
  }
  
  const { purchase_score, purchase_stars, confidence_level, lens_details, ratings } = ratingsData;
  
  let html = `
    <div class="ratings-panel">
      <div class="ratings-summary">
        <div class="purchase-score">
          ${renderStars(purchase_stars, 'large')}
          <span class="score-value">${purchase_score}</span>
          ${renderConfidenceBadge(confidence_level)}
        </div>
        <div class="lens-indices">
  `;
  
  // Lens breakdown
  const lensLabels = {
    competition: { icon: '🏆', name: 'Competition' },
    critics: { icon: '📝', name: 'Critics' },
    community: { icon: '👥', name: 'Community' }
  };
  
  for (const [lens, data] of Object.entries(lens_details)) {
    const config = lensLabels[lens];
    const value = data.index !== null ? data.index.toFixed(1) : '-';
    html += `
      <div class="lens-index">
        <span class="lens-icon">${config.icon}</span>
        <span class="lens-name">${config.name}</span>
        <span class="lens-value">${value}</span>
      </div>
    `;
  }
  
  html += `
        </div>
      </div>
      <div class="ratings-detail-toggle">
        <button class="btn btn-text" id="toggle-ratings-detail">
          Show Details ▼
        </button>
      </div>
      <div class="ratings-detail" style="display: none;">
  `;
  
  // Individual ratings
  if (ratings && ratings.length > 0) {
    for (const rating of ratings) {
      const icon = rating.source_lens === 'competition' ? '🏆' : 
                   rating.source_lens === 'critics' ? '📝' : '👥';
      html += `
        <div class="rating-item">
          <div class="rating-source">
            ${icon} ${rating.source_short || rating.source}
            ${rating.competition_year ? `(${rating.competition_year})` : ''}
          </div>
          <div class="rating-score">
            ${rating.raw_score}
            ${rating.award_name ? `<span class="award-badge">${rating.award_name}</span>` : ''}
          </div>
          <div class="rating-meta">
            ${rating.rating_count ? `${rating.rating_count.toLocaleString()} ratings` : ''}
            ${rating.vintage_match !== 'exact' ? `<span class="vintage-warning">⚠ ${rating.vintage_match}</span>` : ''}
          </div>
        </div>
      `;
    }
  }
  
  html += `
      </div>
      <div class="ratings-actions">
        <button class="btn btn-secondary btn-small" id="refresh-ratings-btn">
          🔄 Refresh
        </button>
        <button class="btn btn-secondary btn-small" id="add-rating-btn">
          + Add Manual
        </button>
      </div>
    </div>
  `;
  
  return html;
}

/**
 * Initialize ratings panel event handlers.
 * @param {number} wineId - Wine ID
 */
export function initRatingsPanel(wineId) {
  // Toggle detail view
  document.getElementById('toggle-ratings-detail')?.addEventListener('click', (e) => {
    const detail = document.querySelector('.ratings-detail');
    const btn = e.target;
    if (detail.style.display === 'none') {
      detail.style.display = 'block';
      btn.textContent = 'Hide Details ▲';
    } else {
      detail.style.display = 'none';
      btn.textContent = 'Show Details ▼';
    }
  });
  
  // Fetch ratings
  document.getElementById('fetch-ratings-btn')?.addEventListener('click', () => handleFetchRatings(wineId));
  document.getElementById('refresh-ratings-btn')?.addEventListener('click', () => handleFetchRatings(wineId));
  
  // Add manual rating
  document.getElementById('add-rating-btn')?.addEventListener('click', () => showAddRatingModal(wineId));
}

/**
 * Handle fetch ratings button click.
 */
async function handleFetchRatings(wineId) {
  const btn = document.getElementById('fetch-ratings-btn') || document.getElementById('refresh-ratings-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Searching...';
  }
  
  try {
    const result = await fetchWineRatings(wineId);
    showToast(`Found ${result.ratings?.length || 0} ratings`);
    
    // Refresh the ratings display
    const ratingsData = await getWineRatings(wineId);
    const panel = document.querySelector('.ratings-panel-container');
    if (panel) {
      panel.innerHTML = renderRatingsPanel(ratingsData);
      initRatingsPanel(wineId);
    }
  } catch (err) {
    showToast('Error: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = btn.id === 'fetch-ratings-btn' ? '🔍 Find Ratings' : '🔄 Refresh';
    }
  }
}
```

### Update public/js/api.js

Add these functions:

```javascript
/**
 * Get ratings for a wine.
 * @param {number} wineId
 * @returns {Promise<Object>}
 */
export async function getWineRatings(wineId) {
  const res = await fetch(`${API_BASE}/api/wines/${wineId}/ratings`);
  return res.json();
}

/**
 * Fetch ratings from web using Claude.
 * @param {number} wineId
 * @returns {Promise<Object>}
 */
export async function fetchWineRatings(wineId) {
  const res = await fetch(`${API_BASE}/api/wines/${wineId}/ratings/fetch`, {
    method: 'POST'
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to fetch ratings');
  }
  return res.json();
}

/**
 * Add manual rating.
 * @param {number} wineId
 * @param {Object} rating
 * @returns {Promise<Object>}
 */
export async function addManualRating(wineId, rating) {
  const res = await fetch(`${API_BASE}/api/wines/${wineId}/ratings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rating)
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to add rating');
  }
  return res.json();
}

/**
 * Get user settings.
 * @returns {Promise<Object>}
 */
export async function getSettings() {
  const res = await fetch(`${API_BASE}/api/settings`);
  return res.json();
}

/**
 * Update a setting.
 * @param {string} key
 * @param {string} value
 * @returns {Promise<Object>}
 */
export async function updateSetting(key, value) {
  const res = await fetch(`${API_BASE}/api/settings/${key}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value })
  });
  return res.json();
}
```

### Add CSS to public/css/styles.css

```css
/* ============================================================
   RATINGS
   ============================================================ */

/* Star display */
.stars-display {
  color: var(--accent);
  letter-spacing: 2px;
}

.stars-display.small {
  font-size: 0.9rem;
}

.stars-display.large {
  font-size: 1.4rem;
}

.stars-unrated {
  color: var(--text-muted);
  font-size: 0.8rem;
  font-style: italic;
}

/* Confidence badge */
.confidence-badge {
  font-size: 0.65rem;
  padding: 0.15rem 0.4rem;
  border-radius: 3px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-left: 0.5rem;
}

.confidence-high {
  background: rgba(76, 175, 80, 0.2);
  color: #4caf50;
}

.confidence-medium {
  background: rgba(255, 193, 7, 0.2);
  color: #ffc107;
}

.confidence-low {
  background: rgba(244, 67, 54, 0.2);
  color: #f44336;
}

.confidence-unrated {
  background: var(--bg-slot);
  color: var(--text-muted);
}

/* Compact rating on wine cards */
.wine-rating-compact {
  display: flex;
  align-items: center;
  margin-top: 0.25rem;
}

/* Ratings panel in modal */
.ratings-panel {
  background: var(--bg-slot);
  border-radius: 8px;
  padding: 1rem;
  margin-top: 1rem;
}

.ratings-panel.unrated {
  text-align: center;
  color: var(--text-muted);
}

.ratings-summary {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 1rem;
}

.purchase-score {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.score-value {
  font-size: 1.2rem;
  font-weight: 600;
  color: var(--accent);
}

.lens-indices {
  display: flex;
  gap: 1rem;
}

.lens-index {
  display: flex;
  flex-direction: column;
  align-items: center;
  font-size: 0.8rem;
}

.lens-icon {
  font-size: 1rem;
}

.lens-name {
  color: var(--text-muted);
  font-size: 0.7rem;
}

.lens-value {
  font-weight: 600;
}

.ratings-detail-toggle {
  margin-top: 0.75rem;
  text-align: center;
}

.btn-text {
  background: none;
  border: none;
  color: var(--accent);
  cursor: pointer;
  font-size: 0.85rem;
}

.ratings-detail {
  margin-top: 1rem;
  border-top: 1px solid var(--border);
  padding-top: 1rem;
}

.rating-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--border);
}

.rating-item:last-child {
  border-bottom: none;
}

.rating-source {
  font-size: 0.9rem;
}

.rating-score {
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.award-badge {
  font-size: 0.7rem;
  background: var(--accent);
  color: white;
  padding: 0.1rem 0.3rem;
  border-radius: 3px;
}

.rating-meta {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.vintage-warning {
  color: var(--priority-2);
}

.ratings-actions {
  margin-top: 1rem;
  display: flex;
  gap: 0.5rem;
}

/* Settings slider */
.preference-slider {
  margin: 1rem 0;
}

.preference-slider input[type="range"] {
  width: 100%;
}

.preference-labels {
  display: flex;
  justify-content: space-between;
  font-size: 0.75rem;
  color: var(--text-muted);
}
```

---

## Testing

### Test scenarios

1. **View ratings**: Click wine → see ratings panel (or "Unrated")
2. **Fetch ratings**: Click "Find Ratings" → Claude searches → ratings appear
3. **Lens display**: Competition/Critics/Community indices shown correctly
4. **Confidence**: Badge shows High/Medium/Low appropriately
5. **Manual add**: Add a rating manually → appears in list
6. **Preference slider**: Change setting → purchase score updates
7. **Regional relevance**: SA wine gets full weight from Veritas; French wine doesn't

### Sample wines to test

- SA wine with Veritas + Vivino
- French wine with Decanter + IWC
- Unknown wine with only Vivino
- Award-winning wine with Trophy

---

## Deployment

```bash
git add .
git commit -m "feat: add wine ratings aggregation (Phase 4)"
git push

# Synology
ssh Lstrydom@100.121.86.46
cd ~/Apps/wine-cellar-app
sudo docker compose -f docker-compose.synology.yml pull
sudo docker compose -f docker-compose.synology.yml up -d
```

---

## Future Enhancements (Phase 4b+)

- Batch fetch for entire cellar
- Wine identity groups (merge/unmerge labels)
- Export ratings data
- Rating comparison view
- Periodic auto-refresh for stale ratings
