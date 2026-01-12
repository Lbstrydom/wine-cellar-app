# Wine Search Strategy - Implementation Plan

**Document Purpose**: Revised implementation roadmap addressing global language + market coverage
**Date**: January 2026
**Version**: 1.1 (Updated with expert review feedback)
**Status**: Ready for Implementation
**Based on**: Expert review of WINE_SEARCH_STRATEGY_REVIEW.md + follow-up technical review

---

## Executive Summary

This plan addresses the **global problem** (language + buying-market coverage) rather than adding sources piecemeal. The existing architecture is solid—we're using its primitives more deliberately.

### Core Principles

1. **Language + locale is a platform feature**, not per-country hacks
2. **Wine fingerprinting (canonical identity)** before adding more sources
3. **Search breadth governance** with budgets and early-stop rules
4. **Deterministic parsers** for high-volume sources to reduce Claude spend
5. **Market Packs** instead of adding sources one-by-one

---

## Expert Review Change Log (v1.1)

| Issue | Category | Resolution |
|-------|----------|------------|
| Drizly shutdown | Must-fix | Removed from USA pack; Wine.com + Total Wine + K&L sufficient |
| Fingerprint collisions | Must-fix | Don't drop varietals; use raw producer tokens; country code + appellation |
| BrightData locale params | Must-fix | Add integration test asserting `hl`/`gl` params sent |
| Missing NL templates | High-leverage | Added Dutch language templates |
| Budget defaults too high | High-leverage | Lowered defaults; added dynamic escalation |
| Live-site CI tests | High-leverage | Switched to fixture-based + scheduled probes |
| Missing response contract | High-leverage | Added confidence/provenance output spec |

---

## Phase 0: Baseline & Instrumentation

**Goal**: Establish metrics to measure improvement

### Deliverables

| Deliverable | Description |
|-------------|-------------|
| `SearchMetricsCollector` | Capture cost + success metrics per lens/domain |
| Dashboard/log summary | Per-run: hit-rate, avg cost, unlocker usage rate, Claude calls |
| Baseline report | Document current performance before changes |

### Implementation

```javascript
// src/services/searchMetrics.js
class SearchMetricsCollector {
  constructor() {
    this.metrics = {
      serpCalls: 0,
      unlockerCalls: 0,
      claudeExtractions: 0,
      cacheHits: 0,
      cacheMisses: 0,
      hitsByLens: {},     // { competition: { hits: 5, misses: 2 }, ... }
      hitsByDomain: {},   // { 'vivino.com': { hits: 10, blocked: 2 }, ... }
      costEstimate: 0     // Running cost estimate in cents
    };
  }

  recordSerpCall(query, resultCount) { ... }
  recordUnlockerCall(domain, success) { ... }
  recordClaudeExtraction(sourceCount, tokensUsed) { ... }
  recordCacheHit(type) { ... }

  getSummary() { return { ...this.metrics }; }
}
```

### Tests

| Test ID | Test Description | Type |
|---------|------------------|------|
| P0-T1 | MetricsCollector correctly counts SERP calls | Unit |
| P0-T2 | MetricsCollector calculates cost estimates accurately | Unit |
| P0-T3 | Metrics persisted to provenance table after search | Integration |
| P0-T4 | Dashboard endpoint returns valid metrics JSON | Integration |

### Acceptance Criteria

- [ ] Every search run produces a metrics summary
- [ ] Cost estimate within 10% of actual BrightData billing
- [ ] Baseline metrics captured for 100+ wine searches

---

## Phase 1: Language + Locale Platform

**Goal**: Native language queries for non-English sources

### Deliverables

| Deliverable | Description |
|-------------|-------------|
| `LANGUAGE_QUERY_TEMPLATES` | Query templates per language/source |
| Lens locale config | Language drives: query templates, SERP locale, Accept-Language |
| SERP locale params | Pass `hl` and `gl` to BrightData SERP API |
| Accept-Language headers | Per-fetch language headers based on source |

### Implementation

```javascript
// src/config/languageConfig.js
export const LANGUAGE_QUERY_TEMPLATES = {
  fr: {
    guide_hachette: '"{wine}" {vintage} Guide Hachette étoiles OR "coup de coeur"',
    rvf: '"{wine}" {vintage} RVF note /20 OR "Revue du Vin de France"',
    bettane_desseauve: '"{wine}" {vintage} Bettane Desseauve note'
  },
  it: {
    gambero_rosso: '"{wine}" {vintage} Gambero Rosso "tre bicchieri" OR bicchieri',
    bibenda: '"{wine}" {vintage} Bibenda grappoli OR "cinque grappoli"',
    doctor_wine: '"{wine}" {vintage} Doctor Wine voto'
  },
  es: {
    guia_penin: '"{wine}" {vintage} Guía Peñín puntos OR puntuación',
    descorchados: '"{wine}" {vintage} Descorchados puntos',
    bodeboca: '"{wine}" {vintage} bodeboca puntuación'
  },
  de: {
    falstaff: '"{wine}" {vintage} Falstaff Punkte OR Bewertung',
    vinum: '"{wine}" {vintage} Vinum Punkte /20',
    weinwisser: '"{wine}" {vintage} Weinwisser Bewertung'
  },
  pt: {
    revista_vinhos: '"{wine}" {vintage} Revista Vinhos pontos OR pontuação'
  },
  // Added per expert review v1.1 - Dutch templates for NL market
  nl: {
    hamersma: '"{wine}" {vintage} Hamersma beoordeling OR sterren',
    perswijn: '"{wine}" {vintage} Perswijn proefnotitie OR punten',
    wijnvoordeel: '"{wine}" {vintage} wijnvoordeel beoordeling',
    gall_gall: '"{wine}" {vintage} "Gall & Gall" score OR beoordeling'
  }
};

export const LOCALE_CONFIG = {
  fr: { serpLang: 'fr', serpCountry: 'fr', acceptLanguage: 'fr-FR,fr;q=0.9,en;q=0.5' },
  it: { serpLang: 'it', serpCountry: 'it', acceptLanguage: 'it-IT,it;q=0.9,en;q=0.5' },
  es: { serpLang: 'es', serpCountry: 'es', acceptLanguage: 'es-ES,es;q=0.9,en;q=0.5' },
  de: { serpLang: 'de', serpCountry: 'de', acceptLanguage: 'de-DE,de;q=0.9,en;q=0.5' },
  pt: { serpLang: 'pt', serpCountry: 'pt', acceptLanguage: 'pt-PT,pt;q=0.9,en;q=0.5' },
  nl: { serpLang: 'nl', serpCountry: 'nl', acceptLanguage: 'nl-NL,nl;q=0.9,en;q=0.5' }
};

// Mapping: source → language
export const SOURCE_LANGUAGE_MAP = {
  guide_hachette: 'fr', rvf: 'fr', bettane_desseauve: 'fr',
  gambero_rosso: 'it', bibenda: 'it', doctor_wine: 'it',
  guia_penin: 'es', descorchados: 'es', bodeboca: 'es', vinomanos: 'es',
  falstaff: 'de', vinum: 'de', weinwisser: 'de',
  revista_vinhos: 'pt',
  hamersma: 'nl', perswijn: 'nl', wijnvoordeel: 'nl', gall_gall: 'nl'
};
```

### Tests

| Test ID | Test Description | Type |
|---------|------------------|------|
| P1-T1 | Query templates substitute wine/vintage correctly | Unit |
| P1-T2 | SOURCE_LANGUAGE_MAP covers all non-English sources | Unit |
| P1-T3 | NL templates include beoordeling/sterren/punten vocab | Unit |
| P1-T4 | Accept-Language header set correctly per source | Unit (fixture) |
| P1-T5 | **BrightData SERP request includes `hl`/`gl` params** | Integration (critical) |
| P1-T6 | BrightData response language shifts with locale params | Integration |
| P1-T7 | French wine search returns Guide Hachette results | Scheduled probe |
| P1-T8 | Italian wine search returns Gambero Rosso results | Scheduled probe |
| P1-T9 | Spanish wine search returns Guía Peñín results | Scheduled probe |
| P1-T10 | German wine search returns Falstaff results | Scheduled probe |
| P1-T11 | Dutch wine search returns Hamersma/Perswijn results | Scheduled probe |

#### Critical Test: BrightData Locale Params (P1-T5)

```javascript
// tests/integration/brightdata-locale.test.js
describe('BrightData SERP locale params', () => {
  it('sends hl and gl params for French source', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => ({}) });

    await searchWithLocale('Chateau Margaux 2015', 'guide_hachette', mockFetch);

    const [url, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);

    // Assert locale params are in the SERP request
    expect(body.url).toContain('hl=fr');
    expect(body.url).toContain('gl=fr');
  });
});
```

### Acceptance Criteria

- [ ] Measurable lift in non-English hit-rate (France/Italy/Spain/Germany/Netherlands)
- [ ] At least 30% more native-language results for configured sources
- [ ] BrightData requests verified to include locale params (integration test passing)
- [ ] No regression in English-language source coverage

---

## Phase 2: MVP Wine Fingerprinting

**Goal**: Canonical wine identity to reduce wrong-wine matches and wasted calls

### Deliverables

| Deliverable | Description |
|-------------|-------------|
| `WineIdentityKey` | `normalize(producer) + normalize(cuvée) + vintage + region/country` |
| Alias support | Handle common name variations |
| Cache key integration | Use fingerprint as cache key |
| Schema for external IDs | Design to later attach Vivino/Wine-Searcher IDs |

### Implementation

> **⚠️ Expert Review Fix (v1.1)**: Original implementation had collision risks. Key changes:
> 1. **Don't drop grape varietals** - they distinguish "Producer Chardonnay" from "Producer Reserve"
> 2. **Use raw producer tokens** for removal, not normalized slug
> 3. **Country code + appellation** instead of 2-letter truncation
> 4. **Keep reserve/riserva as clean tokens**, not bracketed

```javascript
// src/services/wineFingerprint.js
export class WineFingerprint {
  /**
   * Generate canonical wine identity key
   * Format: producer|cuvee|varietal|vintage|country:appellation
   * @param {Object} wine - Wine object
   * @returns {string} Canonical key
   */
  static generate(wine) {
    const rawProducer = wine.producer || this.extractProducer(wine.wine_name);
    const producer = this.normalizeProducer(rawProducer);
    const { cuvee, varietal } = this.extractCuveeAndVarietal(wine.wine_name, rawProducer);
    const vintage = wine.vintage || 'NV';
    const location = this.normalizeLocation(wine.country, wine.region);

    return `${producer}|${cuvee}|${varietal}|${vintage}|${location}`.toLowerCase();
  }

  static normalizeProducer(name) {
    if (!name) return 'unknown';
    return name
      .toLowerCase()
      .replace(/^(chateau|domaine|bodega|cantina|weingut|tenuta|mas|cave|clos)\s+/i, '')
      .replace(/[''`]/g, "'")  // Normalize apostrophes, don't remove
      .replace(/\s+/g, '-')
      .trim();
  }

  /**
   * Extract cuvée and varietal separately (v1.1 fix: don't drop varietals)
   * Uses RAW producer tokens for removal to avoid regex mismatch
   */
  static extractCuveeAndVarietal(wineName, rawProducer) {
    if (!wineName) return { cuvee: 'default', varietal: '' };

    // Remove producer using RAW tokens (not normalized), case-insensitive
    const producerTokens = rawProducer?.split(/\s+/) || [];
    let remaining = wineName;
    for (const token of producerTokens) {
      if (token.length >= 3) {  // Skip short words like "de", "la"
        remaining = remaining.replace(new RegExp(this.escapeRegex(token), 'gi'), '');
      }
    }

    // Extract varietal (keep it, don't remove from cuvée)
    const VARIETALS = [
      'cabernet sauvignon', 'cabernet franc', 'merlot', 'shiraz', 'syrah',
      'pinot noir', 'pinot grigio', 'pinot gris', 'chardonnay', 'sauvignon blanc',
      'riesling', 'chenin blanc', 'pinotage', 'malbec', 'tempranillo',
      'sangiovese', 'nebbiolo', 'grenache', 'mourvedre', 'viognier'
    ];

    let varietal = '';
    for (const v of VARIETALS) {
      if (remaining.toLowerCase().includes(v)) {
        varietal = v.replace(/\s+/g, '-');
        break;
      }
    }

    // Normalize tier markers as clean tokens (v1.1 fix: no brackets)
    const TIER_MARKERS = ['reserve', 'reserva', 'riserva', 'gran reserva', 'single vineyard',
                          'grand cru', 'premier cru', 'crianza', 'roble'];
    let cuvee = remaining
      .replace(/\d{4}/g, '')  // Remove vintage year if present
      .trim();

    for (const marker of TIER_MARKERS) {
      cuvee = cuvee.replace(new RegExp(`\\b${marker}\\b`, 'gi'), marker.toLowerCase());
    }

    cuvee = cuvee.replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

    return {
      cuvee: cuvee || 'default',
      varietal: varietal
    };
  }

  /**
   * Normalize location as country_code:appellation (v1.1 fix: no 2-letter truncation)
   */
  static normalizeLocation(country, region) {
    const COUNTRY_CODES = {
      'south africa': 'za', 'australia': 'au', 'new zealand': 'nz',
      'france': 'fr', 'italy': 'it', 'spain': 'es', 'germany': 'de',
      'portugal': 'pt', 'chile': 'cl', 'argentina': 'ar', 'usa': 'us',
      'united states': 'us', 'austria': 'at', 'greece': 'gr'
    };

    const countryCode = COUNTRY_CODES[country?.toLowerCase()] || 'xx';

    // Normalize appellation if provided, otherwise just use country
    if (region && region.toLowerCase() !== country?.toLowerCase()) {
      const appellation = region
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '');
      return `${countryCode}:${appellation}`;
    }

    return countryCode;
  }

  static escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Extract producer name from wine name (heuristic)
   */
  static extractProducer(wineName) {
    if (!wineName) return 'unknown';
    // Take first 1-4 words before varietal keywords or vintage
    const words = wineName.split(/\s+/);
    const stopWords = ['cabernet', 'merlot', 'shiraz', 'pinot', 'chardonnay',
                       'sauvignon', 'riesling', 'reserve', '2015', '2016', '2017',
                       '2018', '2019', '2020', '2021', '2022', '2023', '2024'];
    let producerWords = [];
    for (const word of words) {
      if (stopWords.some(sw => word.toLowerCase().includes(sw))) break;
      producerWords.push(word);
      if (producerWords.length >= 4) break;
    }
    return producerWords.join(' ') || 'unknown';
  }
}

// Alias table for known variations
export const WINE_ALIASES = {
  'kanonkop|default|pinotage': ['kanonkop|black-label|pinotage', 'kanonkop|kadette|pinotage'],
  'penfolds|grange|shiraz': ['penfolds|grange-hermitage|shiraz', 'penfolds|bin-95|shiraz']
};
```

### Database Schema Extension

```sql
-- Add to wines table
ALTER TABLE wines ADD COLUMN fingerprint VARCHAR(255);
ALTER TABLE wines ADD COLUMN vivino_id VARCHAR(50);
ALTER TABLE wines ADD COLUMN wine_searcher_id VARCHAR(50);

-- Index for fast lookup
CREATE INDEX idx_wines_fingerprint ON wines(fingerprint);
```

### Tests

| Test ID | Test Description | Type |
|---------|------------------|------|
| P2-T1 | normalizeProducer removes prefixes (Chateau, Domaine, etc.) | Unit |
| P2-T2 | normalizeCuvee extracts cuvée from wine name | Unit |
| P2-T3 | generate() produces consistent keys for same wine | Unit |
| P2-T4 | Alias lookup matches known variations | Unit |
| P2-T5 | Cache key uses fingerprint, not raw wine name | Integration |
| P2-T6 | Same wine different spelling → same fingerprint | Integration |
| P2-T7 | Fingerprint stored in DB on wine creation | Integration |
| P2-T8 | Wrong-vintage matches reduced by >20% | Integration |

### Acceptance Criteria

- [ ] Reduction in wrong-vintage/cuvée mismatches
- [ ] Fewer wasted SERP calls (measure via Phase 0 metrics)
- [ ] Fingerprint collision rate < 1%

---

## Phase 3: Search Breadth Governance

**Goal**: Controlled spend per refresh; predictable behavior across all markets

### Deliverables

| Deliverable | Description |
|-------------|-------------|
| `SearchSessionContext` | Passed through provider → fetch → parse → Claude |
| Hard caps | Max SERP calls, unlocker fetches, Claude extractions per run |
| Escalation ladder | structured parse → page fetch → unlocker → Claude |
| Early stop | Stop when confidence is "high enough" |

### Implementation

> **⚠️ Expert Review Fix (v1.1)**: Lowered default budgets and added dynamic escalation rules.
> - Default: 6 SERP / 2 unlocker / 2 Claude (was 15/5/3)
> - Escalation allowed for: important bottles, high-confidence fingerprint, explicit "deep search"

```javascript
// src/services/searchSessionContext.js

/**
 * Budget presets for different search scenarios
 */
export const BUDGET_PRESETS = {
  // Default "refresh" button - conservative
  standard: {
    maxSerpCalls: 6,
    maxUnlockerCalls: 2,
    maxClaudeExtractions: 2,
    maxTotalCost: 20  // cents
  },
  // User marked bottle as "important" or scarce wine
  important: {
    maxSerpCalls: 12,
    maxUnlockerCalls: 4,
    maxClaudeExtractions: 3,
    maxTotalCost: 40
  },
  // Explicit "deep search" request
  deep: {
    maxSerpCalls: 20,
    maxUnlockerCalls: 6,
    maxClaudeExtractions: 5,
    maxTotalCost: 75
  }
};

export class SearchSessionContext {
  constructor(options = {}) {
    // Select budget preset based on search mode
    const preset = BUDGET_PRESETS[options.mode] || BUDGET_PRESETS.standard;

    this.budget = {
      maxSerpCalls: options.maxSerpCalls ?? preset.maxSerpCalls,
      maxUnlockerCalls: options.maxUnlockerCalls ?? preset.maxUnlockerCalls,
      maxClaudeExtractions: options.maxClaudeExtractions ?? preset.maxClaudeExtractions,
      maxTotalCost: options.maxTotalCost ?? preset.maxTotalCost
    };

    this.spent = {
      serpCalls: 0,
      unlockerCalls: 0,
      claudeExtractions: 0,
      estimatedCost: 0
    };

    this.results = {
      highConfidenceCount: 0,
      totalResultsFound: 0,
      sourcesChecked: new Set()
    };

    this.earlyStopThreshold = options.earlyStopThreshold ?? 3;

    // Track escalation context
    this.escalationReason = options.mode !== 'standard' ? options.mode : null;
  }

  /**
   * Dynamic escalation: allow budget increase mid-search if conditions met
   */
  requestEscalation(reason) {
    if (this.escalationReason) return false; // Already escalated

    const ESCALATION_RULES = {
      'scarce_sources': () => this.results.totalResultsFound < 2 && this.spent.serpCalls >= 4,
      'high_fingerprint_confidence': () => true, // Always allow if fingerprint is solid
      'user_important': () => true  // User flagged as important
    };

    if (ESCALATION_RULES[reason]?.()) {
      const escalatedBudget = BUDGET_PRESETS.important;
      this.budget.maxSerpCalls = Math.max(this.budget.maxSerpCalls, escalatedBudget.maxSerpCalls);
      this.budget.maxUnlockerCalls = Math.max(this.budget.maxUnlockerCalls, escalatedBudget.maxUnlockerCalls);
      this.budget.maxClaudeExtractions = Math.max(this.budget.maxClaudeExtractions, escalatedBudget.maxClaudeExtractions);
      this.escalationReason = reason;
      return true;
    }
    return false;
  }

  canMakeSerpCall() {
    return this.spent.serpCalls < this.budget.maxSerpCalls;
  }

  canUseUnlocker() {
    return this.spent.unlockerCalls < this.budget.maxUnlockerCalls;
  }

  canUseClaudeExtraction() {
    return this.spent.claudeExtractions < this.budget.maxClaudeExtractions;
  }

  shouldEarlyStop() {
    return this.results.highConfidenceCount >= this.earlyStopThreshold;
  }

  recordSerpCall(cost = 0.5) {
    this.spent.serpCalls++;
    this.spent.estimatedCost += cost;
  }

  recordUnlockerCall(cost = 2) {
    this.spent.unlockerCalls++;
    this.spent.estimatedCost += cost;
  }

  recordClaudeExtraction(cost = 5) {
    this.spent.claudeExtractions++;
    this.spent.estimatedCost += cost;
  }

  recordResult(confidence) {
    this.results.totalResultsFound++;
    if (confidence === 'high') {
      this.results.highConfidenceCount++;
    }
  }

  getSummary() {
    return {
      mode: this.escalationReason || 'standard',
      budgetRemaining: {
        serpCalls: this.budget.maxSerpCalls - this.spent.serpCalls,
        unlockerCalls: this.budget.maxUnlockerCalls - this.spent.unlockerCalls,
        claudeExtractions: this.budget.maxClaudeExtractions - this.spent.claudeExtractions
      },
      spent: this.spent,
      results: this.results,
      earlyStopTriggered: this.shouldEarlyStop(),
      escalated: !!this.escalationReason
    };
  }
}

// Escalation ladder
export const EXTRACTION_LADDER = [
  { name: 'structured_parse', cost: 0, tryFirst: true },     // JSON-LD, __NEXT_DATA__
  { name: 'regex_extract', cost: 0, tryFirst: true },        // Known patterns
  { name: 'page_fetch', cost: 0.1, requiresBudget: false },  // Standard fetch
  { name: 'unlocker_fetch', cost: 2, requiresBudget: true }, // BrightData unlocker
  { name: 'claude_extract', cost: 5, requiresBudget: true }  // Claude fallback
];
```

### Tests

| Test ID | Test Description | Type |
|---------|------------------|------|
| P3-T1 | SearchSessionContext enforces SERP call budget (default: 6) | Unit |
| P3-T2 | SearchSessionContext enforces unlocker budget (default: 2) | Unit |
| P3-T3 | Early stop triggers at threshold | Unit |
| P3-T4 | Escalation ladder respects order | Unit |
| P3-T5 | BUDGET_PRESETS.standard has lower defaults than .important | Unit |
| P3-T6 | requestEscalation('scarce_sources') triggers when <2 results after 4 calls | Unit |
| P3-T7 | requestEscalation fails if already escalated | Unit |
| P3-T8 | Budget exhaustion prevents further calls | Unit (fixture) |
| P3-T9 | Early stop reduces total API calls | Unit (fixture) |
| P3-T10 | Cost estimate matches actual spend (±20%) | Scheduled probe |
| P3-T11 | Context passed through full search pipeline | Integration |

### Acceptance Criteria

- [ ] Controlled spend per refresh (max cost enforced)
- [ ] Fewer unlocker + Claude calls on low-value runs
- [ ] Early stop reduces average search time by 30%+

---

## Phase 4: Market Packs (USA + NL + Canada)

**Goal**: Users in target markets see local availability/reviews

### Market Pack Definition

```javascript
// src/config/marketPacks.js
export const MARKET_PACKS = {
  usa: {
    name: 'United States',
    locale: { serpLang: 'en', serpCountry: 'us' },
    merchants: [
      // v1.1 fix: Removed Drizly (discontinued March 2024)
      { id: 'total_wine', name: 'Total Wine', domain: 'totalwine.com', type: 'merchant' },
      { id: 'kl_wines', name: 'K&L Wine Merchants', domain: 'klwines.com', type: 'merchant' },
      { id: 'wine_com', name: 'Wine.com', domain: 'wine.com', type: 'merchant' }
    ],
    scoreFormats: ['100-point', 'stars-5'],
    queryTemplate: '"{wine}" {vintage} site:{domain} rating OR review'
  },

  netherlands: {
    name: 'Netherlands',
    locale: { serpLang: 'nl', serpCountry: 'nl' },
    merchants: [
      { id: 'wijnvoordeel', name: 'Wijnvoordeel', domain: 'wijnvoordeel.nl', type: 'merchant' },
      { id: 'gall_gall', name: 'Gall & Gall', domain: 'gall.nl', type: 'merchant' }
    ],
    critics: [
      { id: 'hamersma', name: 'De Grote Hamersma', domain: 'dehamersma.nl', type: 'panel' },
      { id: 'perswijn', name: 'Perswijn', domain: 'perswijn.nl', type: 'critic' }
    ],
    scoreFormats: ['100-point', 'stars-5', '10-point'],
    queryTemplate: '"{wine}" {vintage} site:{domain} beoordeling OR score'
  },

  canada: {
    name: 'Canada',
    locale: { serpLang: 'en', serpCountry: 'ca' },
    merchants: [
      { id: 'lcbo', name: 'LCBO', domain: 'lcbo.com', type: 'provincial' },
      { id: 'saq', name: 'SAQ', domain: 'saq.com', type: 'provincial' },
      { id: 'bc_liquor', name: 'BC Liquor', domain: 'bcliquorstores.com', type: 'provincial' }
    ],
    critics: [
      { id: 'wine_align', name: 'WineAlign', domain: 'winealign.com', type: 'community' },
      { id: 'natalie_maclean', name: 'Natalie MacLean', domain: 'nataliemaclean.com', type: 'critic' }
    ],
    scoreFormats: ['100-point', 'stars-5'],
    queryTemplate: '"{wine}" {vintage} site:{domain} rating'
  }
};

// Market pack selection
export function getMarketPack(userLocale) {
  const LOCALE_TO_PACK = {
    'en-US': 'usa', 'en-CA': 'canada',
    'nl-NL': 'netherlands', 'nl-BE': 'netherlands'
  };
  return MARKET_PACKS[LOCALE_TO_PACK[userLocale]] || null;
}
```

### Source Additions to unifiedSources.js

```javascript
// USA merchants
'total_wine': {
  name: 'Total Wine',
  url: 'https://www.totalwine.com',
  type: 'merchant',
  scoreType: 'aggregated',
  lens: 'aggregator',
  provenance: 'merchant',
  domains: ['totalwine.com'],
  extractionMethod: 'structured' // Has JSON-LD
},
'kl_wines': {
  name: 'K&L Wine Merchants',
  url: 'https://www.klwines.com',
  type: 'merchant',
  scoreType: 'mixed', // Shows critic scores + staff ratings
  lens: 'aggregator',
  provenance: 'merchant',
  domains: ['klwines.com']
},

// Netherlands
'wijnvoordeel': {
  name: 'Wijnvoordeel',
  url: 'https://www.wijnvoordeel.nl',
  type: 'merchant',
  language: 'nl',
  lens: 'aggregator',
  provenance: 'merchant',
  domains: ['wijnvoordeel.nl']
},
'hamersma': {
  name: 'De Grote Hamersma',
  url: 'https://www.dehamersma.nl',
  type: 'panel',
  language: 'nl',
  lens: 'panel',
  scoreFormat: 'stars-5', // Needs verification
  provenance: 'critic',
  domains: ['dehamersma.nl', 'hamersma.nl']
},

// Canada
'lcbo': {
  name: 'LCBO',
  url: 'https://www.lcbo.com',
  type: 'provincial',
  lens: 'aggregator',
  provenance: 'merchant',
  domains: ['lcbo.com'],
  extractionMethod: 'structured' // Has product JSON
}
```

### Tests

| Test ID | Test Description | Type |
|---------|------------------|------|
| P4-T1 | getMarketPack returns correct pack for locale | Unit |
| P4-T2 | USA pack includes Total Wine, K&L, Wine.com | Unit |
| P4-T3 | NL pack includes Wijnvoordeel, Gall & Gall | Unit |
| P4-T4 | Canada pack includes LCBO, SAQ, BC Liquor | Unit |
| P4-T5 | Market pack sources added to search when user locale matches | Integration |
| P4-T6 | Total Wine search returns product results | Integration |
| P4-T7 | LCBO search returns product results | Integration |
| P4-T8 | NL sources don't appear for US locale | Integration |

### Acceptance Criteria

- [ ] Users in USA/NL/CA see local availability/reviews
- [ ] Market pack sources don't pollute other locales
- [ ] At least 2 merchants per market returning valid results

---

## Phase 5: Deterministic Parsers

**Goal**: Reduce Claude fallback for high-volume sources

### Deliverables

| Deliverable | Description |
|-------------|-------------|
| Vivino parser | Extract from `__NEXT_DATA__` JSON |
| Wine-Searcher parser | Structured extraction (requires unlocker) |
| Market aggregator parsers | JSON-LD / microdata extraction |

### Implementation

```javascript
// src/services/structuredParsers.js
export const STRUCTURED_PARSERS = {
  vivino: {
    type: '__NEXT_DATA__',
    extract: (html) => {
      const match = html.match(/<script id="__NEXT_DATA__"[^>]*>(.+?)<\/script>/s);
      if (!match) return null;

      const data = JSON.parse(match[1]);
      const wine = data?.props?.pageProps?.wine;
      if (!wine) return null;

      return {
        rating: wine.statistics?.ratings_average,
        ratingCount: wine.statistics?.ratings_count,
        source: 'vivino',
        confidence: 'high',
        vintage: wine.vintage?.year
      };
    }
  },

  jsonld: {
    type: 'json-ld',
    extract: (html) => {
      const match = html.match(/<script type="application\/ld\+json">(.+?)<\/script>/gs);
      if (!match) return null;

      for (const m of match) {
        try {
          const data = JSON.parse(m.replace(/<\/?script[^>]*>/g, ''));
          if (data['@type'] === 'Product' && data.aggregateRating) {
            return {
              rating: parseFloat(data.aggregateRating.ratingValue),
              ratingCount: parseInt(data.aggregateRating.reviewCount),
              source: 'structured',
              confidence: 'high'
            };
          }
        } catch (e) { continue; }
      }
      return null;
    }
  },

  microdata: {
    type: 'microdata',
    extract: (html) => {
      // Extract itemprop="ratingValue" etc.
      const ratingMatch = html.match(/itemprop="ratingValue"[^>]*content="([^"]+)"/);
      const countMatch = html.match(/itemprop="reviewCount"[^>]*content="([^"]+)"/);

      if (ratingMatch) {
        return {
          rating: parseFloat(ratingMatch[1]),
          ratingCount: countMatch ? parseInt(countMatch[1]) : null,
          source: 'microdata',
          confidence: 'medium'
        };
      }
      return null;
    }
  }
};

// Domain → parser mapping
export const DOMAIN_PARSERS = {
  'vivino.com': ['vivino', 'jsonld'],
  'totalwine.com': ['jsonld', 'microdata'],
  'wine.com': ['jsonld'],
  'klwines.com': ['microdata'],
  'lcbo.com': ['jsonld']
};

export function tryStructuredExtraction(html, domain) {
  const parsers = DOMAIN_PARSERS[domain] || ['jsonld', 'microdata'];

  for (const parserName of parsers) {
    const parser = STRUCTURED_PARSERS[parserName];
    if (parser) {
      const result = parser.extract(html);
      if (result) {
        return { ...result, extractionMethod: parserName };
      }
    }
  }

  return null; // Fall back to Claude
}
```

### Tests

> **⚠️ Expert Review Fix (v1.1)**: Switched live-site tests to fixture-based for CI reliability.
> Live probes run on scheduled basis in staging, not per PR.

| Test ID | Test Description | Type |
|---------|------------------|------|
| P5-T1 | Vivino parser extracts rating from __NEXT_DATA__ | Unit (fixture) |
| P5-T2 | JSON-LD parser extracts aggregateRating | Unit (fixture) |
| P5-T3 | Microdata parser extracts itemprop ratings | Unit (fixture) |
| P5-T4 | tryStructuredExtraction falls through parser list | Unit |
| P5-T5 | Fixture: Vivino golden page → structured extraction | Unit (fixture) |
| P5-T6 | Fixture: Total Wine golden page → JSON-LD extraction | Unit (fixture) |
| P5-T7 | Claude fallback only when structured fails (mocked) | Unit |
| P5-T8 | Claude calls reduced by >40% for supported domains | Scheduled probe |

#### Fixture-Based Testing Strategy

```javascript
// tests/fixtures/vivino-golden.html - Captured real page
// tests/fixtures/totalwine-golden.html - Captured real page

describe('Vivino parser', () => {
  const fixture = fs.readFileSync('tests/fixtures/vivino-golden.html', 'utf8');

  it('extracts rating from __NEXT_DATA__', () => {
    const result = STRUCTURED_PARSERS.vivino.extract(fixture);
    expect(result.rating).toBeCloseTo(4.2, 1);
    expect(result.source).toBe('vivino');
  });
});
```

**Scheduled Live Probes (staging, not CI):**
- Run daily against real sites
- Alert on >20% extraction failure rate
- Update golden fixtures when site structure changes

### Acceptance Criteria

- [ ] Lower average Claude calls per refresh
- [ ] Structured extraction succeeds for 60%+ of Vivino fetches
- [ ] No hit-rate regression (same or better coverage)
- [ ] All unit tests pass in CI (no live site dependencies)

---

## Phase 6: Competitions + Emerging Regions (Future)

**Scope**: After core phases complete

### Missing Competitions to Add

| Competition | Coverage | Priority |
|-------------|----------|----------|
| San Francisco Chronicle | USA wines | Medium |
| Concours des Vins de Bourgogne | Burgundy | Medium |
| Challenge International du Vin | Global | Low |
| AWC Vienna | Austrian wines | Low |
| Berliner Wein Trophy | German wines | Low |

### Missing Producing Countries

| Country | Required Sources | Priority |
|---------|-----------------|----------|
| Lebanon | Tim Atkin, Jancis Robinson | Medium |
| Israel | Local critics needed | Low |
| Hungary | Local sources for Tokaji | Low |
| Slovenia/Croatia | Emerging, limited sources | Low |

---

## Expert Review Milestones

### Milestone 1: After Phase 1 (Language Platform)

**Timing**: After language + locale implementation complete
**Focus**: Validate query templates and locale configuration

**Review Checklist**:
- [ ] Query templates produce native-language results
- [ ] SERP locale params working correctly
- [ ] Accept-Language headers set properly
- [ ] Hit-rate improvement measurable
- [ ] No regression in English sources

**Deliverables for Review**:
1. Metrics report: before/after hit rates by country
2. Sample queries and results for FR/IT/ES/DE/PT
3. Test results summary

---

### Milestone 2: After Phase 3 (Search Governance)

**Timing**: After SearchSessionContext and budgets implemented
**Focus**: Validate cost control and search quality balance

**Review Checklist**:
- [ ] Budget enforcement working
- [ ] Early stop triggers appropriately
- [ ] Escalation ladder respects order
- [ ] Cost estimates accurate
- [ ] No quality degradation from budget limits

**Deliverables for Review**:
1. Cost comparison: before/after implementation
2. Search quality metrics (coverage, accuracy)
3. Edge case handling documentation

---

### Milestone 3: After Phase 4 (Market Packs)

**Timing**: After USA/NL/Canada packs implemented
**Focus**: Validate market coverage and locale separation

**Review Checklist**:
- [ ] Each market has working merchant sources
- [ ] Locale detection working
- [ ] No cross-contamination between markets
- [ ] Score normalization correct for each market
- [ ] User experience for each locale validated

**Deliverables for Review**:
1. Market coverage report per locale
2. Sample searches from each market
3. User journey documentation

---

### Milestone 4: After Phase 5 (Deterministic Parsers)

**Timing**: After structured parsers implemented
**Focus**: Validate Claude spend reduction

**Review Checklist**:
- [ ] Structured extraction success rates
- [ ] Claude fallback reduction measured
- [ ] No accuracy regression
- [ ] Parser maintenance burden acceptable
- [ ] Edge case handling (malformed HTML, etc.)

**Deliverables for Review**:
1. Claude usage: before/after comparison
2. Extraction success rates by domain
3. Cost savings analysis

---

## Confidence & Provenance Response Contract (v1.1)

> **⚠️ Expert Review Addition**: Define a standard output contract to enable "Explain this rating" UI later.

### Response Schema

Every rating search result returns a standardized `RatingResponse`:

```typescript
interface RatingResponse {
  // Wine identity
  wineFingerprint: string;          // Canonical key from Phase 2
  searchMode: 'standard' | 'important' | 'deep';

  // Aggregated scores (for display)
  aggregatedScore: number | null;   // Weighted average, 100-point
  scoreRange: { min: number; max: number } | null;

  // Confidence signals
  confidence: {
    level: 'high' | 'medium' | 'low';
    score: number;                  // 0-100
    factors: ConfidenceFactor[];
  };

  // Source breakdown by type
  sourceCountByType: {
    competition: number;
    panel: number;
    critic: number;
    community: number;
    merchant: number;
  };

  // Top sources with evidence (for "Explain this rating")
  topSources: RatingSource[];

  // Search metadata
  metadata: {
    searchDuration: number;         // ms
    serpCallsMade: number;
    unlockerCallsMade: number;
    claudeExtractionsMade: number;
    earlyStopTriggered: boolean;
    escalated: boolean;
    cacheHitRate: number;           // 0-1
  };
}

interface ConfidenceFactor {
  factor: string;                   // e.g., 'vintage_match', 'multiple_sources', 'authoritative_source'
  impact: 'positive' | 'negative';
  weight: number;                   // 0-1
  detail: string;                   // Human-readable explanation
}

interface RatingSource {
  sourceId: string;                 // e.g., 'platters', 'vivino'
  sourceName: string;               // Display name
  sourceType: 'competition' | 'panel' | 'critic' | 'community' | 'merchant';
  url: string | null;               // Link to original rating
  score: number;                    // Normalized to 100-point
  originalScore: string;            // Original format, e.g., "4.5 stars", "Gold Medal"
  vintageMatch: 'exact' | 'close' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
  extractionMethod: 'structured' | 'claude' | 'regex' | 'snippet';
  evidenceSnippet: string | null;   // Brief quote from source
}
```

### Example Response

```json
{
  "wineFingerprint": "kanonkop|default|pinotage|2019|za:stellenbosch",
  "searchMode": "standard",
  "aggregatedScore": 92,
  "scoreRange": { "min": 89, "max": 95 },
  "confidence": {
    "level": "high",
    "score": 87,
    "factors": [
      { "factor": "multiple_sources", "impact": "positive", "weight": 0.3, "detail": "Found 4 independent sources" },
      { "factor": "vintage_match", "impact": "positive", "weight": 0.25, "detail": "Exact vintage match on 3 sources" },
      { "factor": "authoritative_source", "impact": "positive", "weight": 0.2, "detail": "Platters (panel guide) found" }
    ]
  },
  "sourceCountByType": {
    "competition": 1,
    "panel": 1,
    "critic": 1,
    "community": 1,
    "merchant": 0
  },
  "topSources": [
    {
      "sourceId": "platters",
      "sourceName": "Platter's Wine Guide",
      "sourceType": "panel",
      "url": "https://wineonaplatter.com/...",
      "score": 93,
      "originalScore": "4.5 stars",
      "vintageMatch": "exact",
      "confidence": "high",
      "extractionMethod": "claude",
      "evidenceSnippet": "Concentrated dark fruit with fine tannins..."
    },
    {
      "sourceId": "vivino",
      "sourceName": "Vivino",
      "sourceType": "community",
      "url": "https://vivino.com/...",
      "score": 89,
      "originalScore": "4.2/5 (1,234 ratings)",
      "vintageMatch": "exact",
      "confidence": "high",
      "extractionMethod": "structured",
      "evidenceSnippet": null
    }
  ],
  "metadata": {
    "searchDuration": 4520,
    "serpCallsMade": 5,
    "unlockerCallsMade": 1,
    "claudeExtractionsMade": 2,
    "earlyStopTriggered": true,
    "escalated": false,
    "cacheHitRate": 0.4
  }
}
```

### Confidence Score Calculation

```javascript
function calculateConfidence(sources, fingerprint) {
  const factors = [];
  let score = 50; // Base score

  // Multiple sources agreement
  if (sources.length >= 3) {
    score += 15;
    factors.push({ factor: 'multiple_sources', impact: 'positive', weight: 0.3, detail: `Found ${sources.length} independent sources` });
  }

  // Vintage match quality
  const exactMatches = sources.filter(s => s.vintageMatch === 'exact').length;
  if (exactMatches >= 2) {
    score += 12;
    factors.push({ factor: 'vintage_match', impact: 'positive', weight: 0.25, detail: `Exact vintage match on ${exactMatches} sources` });
  }

  // Authoritative source present
  const authoritativeSources = sources.filter(s => ['competition', 'panel'].includes(s.sourceType));
  if (authoritativeSources.length > 0) {
    score += 10;
    factors.push({ factor: 'authoritative_source', impact: 'positive', weight: 0.2, detail: `${authoritativeSources[0].sourceName} (${authoritativeSources[0].sourceType}) found` });
  }

  // Score consistency
  const scores = sources.map(s => s.score).filter(Boolean);
  const range = Math.max(...scores) - Math.min(...scores);
  if (range <= 5) {
    score += 8;
    factors.push({ factor: 'score_consistency', impact: 'positive', weight: 0.15, detail: `Sources agree within ${range} points` });
  } else if (range > 10) {
    score -= 10;
    factors.push({ factor: 'score_divergence', impact: 'negative', weight: 0.15, detail: `Sources diverge by ${range} points` });
  }

  // Fingerprint confidence
  if (fingerprint.confidence === 'high') {
    score += 5;
    factors.push({ factor: 'fingerprint_confidence', impact: 'positive', weight: 0.1, detail: 'Wine identity confirmed' });
  }

  const level = score >= 75 ? 'high' : score >= 50 ? 'medium' : 'low';
  return { level, score: Math.min(100, Math.max(0, score)), factors };
}
```

---

## Test Summary by Phase

| Phase | Unit Tests | Integration Tests | Scheduled Probes | Total |
|-------|------------|-------------------|------------------|-------|
| Phase 0 | 2 | 2 | 0 | 4 |
| Phase 1 | 4 | 2 | 5 | 11 |
| Phase 2 | 4 | 4 | 0 | 8 |
| Phase 3 | 7 | 2 | 2 | 11 |
| Phase 4 | 4 | 4 | 0 | 8 |
| Phase 5 | 5 | 2 | 1 | 8 |
| **Total** | **26** | **16** | **8** | **50** |

> **Note**: Test counts updated in v1.1 to reflect fixture-based approach and scheduled probes.

---

## Guardrails

### Source Addition Requirements

Every new source must define:
- [ ] Normalization function (score → 100-point)
- [ ] Expected score format(s)
- [ ] Provenance labeling (competition/panel/critic/community/merchant)
- [ ] Rate limit category
- [ ] Language (if non-English)
- [ ] Required extraction method (structured/claude/regex)

### Integration Test Requirements

- [ ] Tests exist for each market pack
- [ ] Tests exist for each critical parser
- [ ] Tests run in CI before merge
- [ ] Tests cover happy path + error cases

### BrightData Usage

- [ ] Unlocker limited to domains that need it
- [ ] Blocked domain list maintained
- [ ] Usage tracked via Phase 0 metrics
- [ ] Cost alerts if budget exceeded

---

## Summary

| What Changes | Why |
|--------------|-----|
| Netherlands → 3 market packs | Framework over one-off additions |
| Language/locale first | Improves every market |
| Fingerprinting before sources | Reduces waste upstream |
| Budgets before expansion | Cost control as foundation |
| Deterministic parsers | Long-term Claude cost reduction |

This plan uses existing primitives (multi-tier discovery, BrightData, Claude, caching, rate limiting, governance) more deliberately rather than building new systems.
