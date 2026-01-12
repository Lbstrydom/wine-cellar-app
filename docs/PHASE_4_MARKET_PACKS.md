# Phase 4: Market Packs Implementation Summary

## Overview
Phase 4 implements region-specific source routing for wine search, building on Phase 1 (Language Config) and Phase 3 (Budget Governance). Market packs prioritize local merchants and national critics based on user locale, improving search relevance and reducing unnecessary API calls to irrelevant sources.

## Implementation Details

**File**: `src/config/marketPacks.js` (459 lines)  
**Tests**: `tests/unit/config/marketPacks.test.js` (440 lines, 63 tests)

### Architecture

**Market Pack Structure:**
```javascript
{
  market: 'usa',           // Market code
  locale: 'en-US',         // Locale string
  currency: 'USD',         // Currency code
  merchants: [...],        // E-commerce sources with pricing
  critics: [...],          // Review sources
  databases: [...],        // Wine databases (Vivino, CellarTracker)
  competitions: [...]      // Award databases
}
```

**Source Metadata:**
```javascript
{
  sourceId: 'wine_com',
  name: 'Wine.com',
  priority: 100,           // Higher = search earlier
  pricingAvailable: true,
  shipsTo: ['usa'],
  scoreScale: '100-point', // Optional for critics
  language: 'en'           // Optional language override
}
```

### Priority System

```javascript
MARKET_PACK_PRIORITIES = {
  merchant: 100,         // E-commerce sites
  national_critic: 90,   // National critics (Hamersma, MacLean)
  competition: 80,       // Wine competitions
  global_critic: 70,     // International critics (Parker, JR)
  database: 60,          // Vivino, CellarTracker
  regional: 50           // Regional publications
}
```

**Design Rationale**: Merchants prioritized highest because they provide pricing + reviews. National critics ranked above global critics in their markets for local wine coverage.

### Market Coverage

| Market | Locale | Merchants | Critics | National Critics |
|--------|--------|-----------|---------|------------------|
| USA | en-US | Wine.com, Total Wine, Wine-Searcher | Parker, Wine Spectator, Wine Enthusiast, Jancis Robinson | None |
| Netherlands | nl-NL | Gall & Gall, Wijnvoordeel | Hamersma, Perswijn, Jancis Robinson | Hamersma (10pt), Perswijn (20pt) |
| Canada | en-CA/fr-CA | LCBO, SAQ, Wine-Searcher | Parker, Wine Spectator, Jancis Robinson, Natalie MacLean | Natalie MacLean (100pt) |
| Global | * | Wine-Searcher | Parker, Jancis Robinson, Decanter | None |

**Belgium Handling**: `nl-BE` locale routes to Netherlands market pack (Belgian consumers often use Gall & Gall).

### Public API (11 Functions)

**Core Routing:**
- `getMarketPack(marketCode)` - Retrieve market pack object
- `detectMarketFromLocale(userLocale)` - Map locale string to market code
- `getMarketSources(marketCode)` - All sources sorted by priority

**Filtering:**
- `getMarketSourcesByCategory(marketCode, category)` - Filter by category
- `getMerchantsWithPricing(marketCode)` - Pricing-enabled merchants only
- `getNationalCritics(marketCode)` - National critics only
- `isSourceAvailableInMarket(marketCode, sourceId)` - Availability check

**Integration:**
- `getMarketQueryTemplate(marketCode, sourceId, wine, vintage)` - Phase 1 integration
- `getAvailableMarkets()` - List all market codes
- `getMarketSummary(marketCode)` - Counts by category

**Export Constants:**
- `MARKET_PACKS`, `MARKET_PACK_PRIORITIES`, individual market pack objects

### Integration Points

**Phase 1 (Language Config):**
```javascript
getMarketQueryTemplate('netherlands', 'hamersma', 'Château Margaux', 2015)
// Returns: "Harold Hamersma Château Margaux 2015" (Dutch template)
```

Uses `SOURCE_LANGUAGE_MAP` from languageConfig to determine query language, falls back to source's language property.

**Phase 3 (Budget Governance):**
Priority system aligns with SearchSessionContext's source selection. Higher-priority sources should be queried within standard budget (6 SERP calls), lower-priority sources only in escalated budgets.

**Future Phase 5 (Deterministic Parsers):**
Market packs will determine which parsers to attempt (e.g., Vivino parser only if `vivino` in market sources).

### Test Coverage

**63 Unit Tests** (100% pass rate, 8ms execution):
- Market pack retrieval (6 tests)
- Locale detection (9 tests) - case insensitivity, Belgium routing
- Source aggregation and sorting (4 tests)
- Category filtering (7 tests)
- Source availability checking (6 tests)
- Merchant/critic filtering (10 tests)
- Query template integration (4 tests)
- Market metadata (2 tests)
- Structure validation (4 tests) - uniqueness, valid scales
- Priority system (3 tests)
- Edge cases (8 tests) - null handling, empty strings

**Edge Cases Handled:**
- Null/undefined market codes → return null/empty array
- Invalid category → empty array
- Unrecognized locale → 'global' fallback
- Case-insensitive locale matching

### Code Quality

**ESLint**: 0 errors, 0 warnings  
**Module Format**: ES6 export/import throughout  
**Documentation**: JSDoc for all 11 public functions  
**Dependencies**: None (pure module, optional integration with languageConfig)

**Performance**: All source aggregation operations use array spreading + sort (O(n log n)), no async operations.

### Design Decisions

**1. Static vs. Dynamic Market Packs**  
✅ **Static**: Defined as constants, not database-driven  
**Rationale**: Market definitions change infrequently, static improves performance and testability. Future: could load from JSON config file if needed.

**2. Priority as Numeric Values**  
✅ **100-50 range** with named constants  
**Rationale**: Allows fine-grained ordering, extensible for new categories. Named constants prevent magic numbers.

**3. Locale Detection Logic**  
✅ **String matching** on country code (simple substring search)  
**Rationale**: Robust for common patterns (`en-US`, `EN-US`, `us_US`). Future: could use `Intl.Locale` API for more sophisticated parsing.

**4. Category Structure**  
✅ **4 categories**: merchants, critics, databases, competitions  
**Rationale**: Aligns with source types in search strategy. Competitions added for award data (future use).

**5. Source Duplication Across Markets**  
✅ **Allowed**: `wine_searcher` appears in all markets  
**Rationale**: Global sources should be available everywhere. Priority determines search order per market.

### Potential Issues for Review

**1. Source ID Consistency**  
Market packs reference sourceIds (e.g., `'wine_com'`, `'hamersma'`) that should match Phase 1's `LANGUAGE_QUERY_TEMPLATES`. No automated validation between the two configs.

**Mitigation**: Integration test in place checks expected sources exist in both configs.

**2. National Critics Definition**  
Netherlands has 2 national critics, Canada has 1, USA has none. This asymmetry is intentional (USA critics are mostly global), but may need documenting.

**3. Score Scale Diversity**  
Critics use 5 different scales (100pt, 20pt, 10pt, 5pt, medal). No normalization logic implemented yet.

**Future**: Phase 6 (not in current plan) would normalize scores.

**4. Currency Handling**  
Currency field exists but no conversion logic. Pricing from merchants would need external currency API.

**5. Shipping Regions**  
`shipsTo` array defined but not used in any logic yet. Future feature for user location filtering.

### Performance Characteristics

**Memory**: ~2KB per market pack × 4 = ~8KB total  
**Function Execution**: <1ms for all operations (synchronous, no I/O)  
**Test Duration**: 8ms for 63 tests

### Usage Examples

**Basic Market Detection:**
```javascript
import { detectMarketFromLocale, getMarketPack } from './config/marketPacks.js';

const userLocale = navigator.language; // 'en-US'
const marketCode = detectMarketFromLocale(userLocale); // 'usa'
const marketPack = getMarketPack(marketCode);

console.log(marketPack.currency); // 'USD'
console.log(marketPack.merchants.length); // 3
```

**Priority-Ordered Sources:**
```javascript
import { getMarketSources } from './config/marketPacks.js';

const sources = getMarketSources('netherlands');
// Returns: [
//   { sourceId: 'gall_gall', priority: 100 },
//   { sourceId: 'wijnvoordeel', priority: 100 },
//   { sourceId: 'hamersma', priority: 90 },
//   { sourceId: 'perswijn', priority: 90 },
//   ...
// ]
```

**Category Filtering:**
```javascript
import { getMerchantsWithPricing, getNationalCritics } from './config/marketPacks.js';

const merchants = getMerchantsWithPricing('canada');
// Returns: [{ sourceId: 'lcbo', ... }, { sourceId: 'saq', ... }]

const critics = getNationalCritics('netherlands');
// Returns: [{ sourceId: 'hamersma', ... }, { sourceId: 'perswijn', ... }]
```

**Query Template Integration:**
```javascript
import { getMarketQueryTemplate } from './config/marketPacks.js';

const query = getMarketQueryTemplate('netherlands', 'hamersma', 'Bordeaux Superieur', 2019);
// Returns: "Harold Hamersma Bordeaux Superieur 2019"
```

### Next Steps (Not Implemented)

- API endpoint to serve market packs to frontend
- User preference storage (override auto-detection)
- Dynamic market pack loading from external config
- Score normalization across different scales
- Currency conversion for pricing
- Shipping region filtering based on user location

---

## Phase 4 Statistics

| Metric | Value |
|--------|-------|
| **Lines of Code** | 899 (459 implementation + 440 tests) |
| **Public API Functions** | 11 |
| **Test Coverage** | 63 tests, 100% passing |
| **Test Duration** | 8ms |
| **ESLint Issues** | 0 |
| **Market Packs** | 4 (USA, Netherlands, Canada, Global) |
| **Total Sources** | 20+ unique sources across markets |
| **Dependencies** | 0 (pure ES6 module) |

## Phase Integration

| Phase | Status | Integration Point |
|-------|--------|-------------------|
| **Phase 0** | ✅ Complete | Metrics will track regional hit rates |
| **Phase 1** | ✅ Complete | `getMarketQueryTemplate` uses language config |
| **Phase 2** | ✅ Complete | Fingerprints used for result deduplication |
| **Phase 3** | ✅ Complete | Priority system aligns with budget governance |
| **Phase 4** | ✅ Complete | **Current phase** |
| **Phase 5** | ⏳ Next | Market packs determine parser selection |
