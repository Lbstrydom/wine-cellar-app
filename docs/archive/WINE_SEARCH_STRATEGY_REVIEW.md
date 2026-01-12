# Wine Search & Rating Strategy Review

**Document Purpose**: Expert review of current wine search and rating retrieval strategies
**Date**: January 2026
**Status**: Current Implementation Analysis with Gap Identification

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Architecture Overview](#architecture-overview)
3. [API Tools & Services](#api-tools--services)
4. [Country-by-Country Analysis](#country-by-country-analysis)
5. [Language Strategy](#language-strategy)
6. [Producer Website Strategy](#producer-website-strategy)
7. [Aggregator Market Coverage](#aggregator-market-coverage)
8. [Identified Gaps & Recommendations](#identified-gaps--recommendations)
9. [Appendix: Source Registry](#appendix-source-registry)

---

## Executive Summary

### Current State

The wine cellar app implements a **sophisticated multi-tier search architecture** that:
- Uses **BrightData SERP API** as primary search provider with **Google Custom Search** fallback
- Supports **50+ wine rating sources** across competitions, panel guides, critics, and community platforms
- Implements **country-specific source prioritization** for 13 wine-producing regions
- Handles **anti-bot protection** via BrightData Web Unlocker for blocked sites
- Uses **Claude AI** for intelligent rating extraction from web content
- Caches results at SERP and page levels to minimize API costs

### Key Findings

| Aspect | Status | Assessment |
|--------|--------|------------|
| South Africa | **Strong** | Platters, Veritas, Old Mutual, Tim Atkin, wine.co.za |
| France | **Good** | Hachette, RVF, B+D, but searches in English only |
| Italy | **Good** | Gambero Rosso, Bibenda, but searches in English only |
| Spain | **Moderate** | Guia Penin configured but no Spanish-language queries |
| Australia/NZ | **Strong** | Halliday, Bob Campbell, Wine Orbit well covered |
| Chile/Argentina | **Moderate** | Descorchados, Tim Atkin, but limited local sources |
| Germany/Austria | **Moderate** | Falstaff, Vinum, Weinwisser configured |
| Portugal | **Weak** | Only Revista de Vinhos; no Portuguese queries |
| Greece | **Weak** | Only Elloinos; no Greek-language support |
| Producer Websites | **Implemented** | Extracts producer name, searches for winery sites |
| Language Support | **Weak** | All searches in English despite sources in other languages |
| Aggregator Markets | **Partial** | UK (BBR), Australia (Dan Murphy's), but missing USA, Netherlands |

---

## Architecture Overview

### Search Flow Diagram

```
User triggers "Fetch Ratings"
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. SOURCE SELECTION (getSourcesForWine)                        │
│     • Get country-specific priority sources                      │
│     • Add grape-specific competitions (if grape detected)        │
│     • Add global competitions not already included               │
│     • Fill with country-relevant sources from registry           │
└─────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. MULTI-STRATEGY SEARCH (searchWineRatings)                   │
│                                                                  │
│  Strategy 1: Targeted Source Searches                           │
│  ├── Grape competitions (top 2)                                  │
│  ├── Global competitions (top 3)                                 │
│  └── Critics/guides (top 2)                                      │
│                                                                  │
│  Strategy 2: Broad Token Search                                  │
│  └── Remaining sources with wine name tokens                     │
│                                                                  │
│  Strategy 3: Name Variations (if <5 results)                     │
│  └── Try without parentheses, without "Reserve", etc.            │
│                                                                  │
│  Strategy 4: Producer Website Search                             │
│  └── Find winery's own site for awards section                   │
└─────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. PAGE CONTENT FETCHING (fetchPageContent)                    │
│                                                                  │
│  • Check cache first (7-day TTL for success)                     │
│  • Use BrightData Web Unlocker for blocked domains               │
│  • Standard fetch for other domains                              │
│  • Vivino: Special SPA handling with x-unblock-expect            │
│  • Decanter: JSON + HTML extraction with Puppeteer fallback      │
└─────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. CLAUDE EXTRACTION (buildExtractionPrompt)                   │
│                                                                  │
│  • Process fetched page content                                  │
│  • Extract ratings with source attribution                       │
│  • Handle aggregator → original source mapping                   │
│  • Extract drinking windows (multi-language patterns)            │
│  • Fallback: snippet extraction for failed fetches               │
└─────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│  5. NORMALIZATION & STORAGE                                     │
│                                                                  │
│  • normalizeScore() → 100-point scale                            │
│  • Medal → points, Stars → points, 20-scale → 100-scale          │
│  • Symbol conversion (Bicchieri, grappoli, Coup de Coeur)        │
│  • Store with vintage match confidence                           │
│  • Update wine aggregates (competition/critics/community index)  │
└─────────────────────────────────────────────────────────────────┘
```

### Key Files

| File | Purpose | Lines |
|------|---------|-------|
| `src/services/searchProviders.js` | Core multi-provider search engine | ~2100 |
| `src/services/vivinoSearch.js` | Vivino SERP + scraping | ~700 |
| `src/services/claude.js` | Claude API for extraction | ~1000 |
| `src/services/ratings.js` | Score normalization & aggregation | ~465 |
| `src/config/unifiedSources.js` | 50+ source definitions | ~1500 |
| `src/services/cacheService.js` | SERP & page caching | ~300 |
| `src/services/puppeteerScraper.js` | Puppeteer fallback | ~400 |

---

## API Tools & Services

### 1. BrightData Integration

**Primary Search Provider** - Configured via environment variables:
- `BRIGHTDATA_API_KEY` - Single API key for all services
- `BRIGHTDATA_SERP_ZONE` - Zone for Google search results
- `BRIGHTDATA_WEB_ZONE` - Zone for Web Unlocker (blocked sites)

**Usage Pattern**:
```javascript
// SERP API - Google search results
await fetch('https://api.brightdata.com/request', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${apiKey}` },
  body: JSON.stringify({
    zone: serpZone,
    url: `https://www.google.com/search?q=${query}&num=10`,
    format: 'json'
  })
});

// Web Unlocker - For blocked sites
await fetch('https://api.brightdata.com/request', {
  body: JSON.stringify({
    zone: webZone,
    url: targetUrl,
    format: 'raw'  // or 'markdown'
  })
});
```

**Blocked Domains Using Web Unlocker**:
- `wine-searcher.com` - 403 blocks
- `danmurphys.com.au` - Anti-scraping
- `bodeboca.com` - Anti-bot
- `bbr.com` - Anti-bot measures

**Special Handling for Vivino**:
```javascript
// Wait for rating element to render (SPA)
headers['x-unblock-expect'] = JSON.stringify({
  element: '[class*="average"]'
});
```

### 2. Google Custom Search (Fallback)

**Fallback Provider** - Used when BrightData not configured:
- `GOOGLE_SEARCH_API_KEY`
- `GOOGLE_SEARCH_ENGINE_ID`

**Usage**: Standard Google Programmable Search API v1.

### 3. Claude AI (Anthropic)

**Rating Extraction** - Configured via:
- `ANTHROPIC_API_KEY`

**Tasks**:
1. Extract ratings from page content
2. Identify source (original vs aggregator)
3. Extract drinking windows (multi-language)
4. Process search snippets for paywalled sites
5. Sommelier pairing recommendations

### 4. Internal Caching

**Two-Level Cache** in `src/services/cacheService.js`:

| Cache Type | TTL | Key Pattern |
|------------|-----|-------------|
| SERP Results | 7 days | Query + sorted domains |
| Page Content (success) | 7 days | URL |
| Page Content (blocked) | 2 days | URL |
| Page Content (error) | 6 hours | URL |

---

## Country-by-Country Analysis

### South Africa

**Status**: **Strong Coverage**

**Configured Sources**:
| Source | Type | Language | Notes |
|--------|------|----------|-------|
| Platters | Panel Guide | English | 5-star scale, wineonaplatter.com |
| Veritas | Competition | English | Double Gold/Gold/Silver/Bronze |
| Old Mutual Trophy | Competition | English | Trophy/Gold/Silver/Bronze |
| Tim Atkin | Critic | English | 100-point, covers SA extensively |
| wine.co.za | Aggregator | English | Aggregates Platters, Tim Atkin, DWWA |

**Priority Order**: `['wine_co_za', 'platters', 'tim_atkin', 'veritas', 'old_mutual', 'decanter', 'vivino', 'wine_searcher']`

**Strengths**:
- All major SA competitions covered
- Tim Atkin's SA reports well indexed
- wine.co.za provides excellent aggregation

**Gaps**:
- Winemag.co.za not included (SA wine magazine)
- Christian Eedes (winemag.co.za critic) not separately tracked

---

### Australia

**Status**: **Strong Coverage**

**Configured Sources**:
| Source | Type | Language | Notes |
|--------|------|----------|-------|
| Halliday | Panel Guide | English | winecompanion.com.au, 100-point |
| Huon Hooke | Critic | English | huonhooke.com, 100-point |
| Gourmet Traveller Wine | Panel | English | gourmettravellerwine.com.au |
| Dan Murphy's | Aggregator | English | Shows Halliday, Campbell, Hooke |

**Priority Order**: `['halliday', 'huon_hooke', 'gourmet_traveller_wine', 'james_suckling', 'decanter', 'vivino', 'dan_murphys', 'wine_searcher']`

**Strengths**:
- James Halliday is the definitive Australian authority
- Dan Murphy's aggregation captures multiple critics
- Good coverage of premium wines

**Gaps**:
- Royal Wine Shows (Sydney, Melbourne, Adelaide) not included
- Wine Australia ratings not tracked
- Langton's Classification not incorporated

---

### New Zealand

**Status**: **Strong Coverage**

**Configured Sources**:
| Source | Type | Language | Notes |
|--------|------|----------|-------|
| Bob Campbell MW | Critic | English | bobcampbell.nz, 100-point |
| Wine Orbit | Critic | English | wineorbit.co.nz, 100-point |

**Priority Order**: `['bob_campbell', 'wine_orbit', 'james_suckling', 'decanter', 'vivino', 'wine_searcher']`

**Strengths**:
- Two NZ-specific critics covered
- Good Sauvignon Blanc coverage

**Gaps**:
- Michael Cooper (NZ wine guide author) not included
- Air NZ Wine Awards not tracked
- Raymond Chan reviews not included

---

### France

**Status**: **Good Coverage, Language Gap**

**Configured Sources**:
| Source | Type | Language | Notes |
|--------|------|----------|-------|
| Guide Hachette | Panel | **French** | Symbol-based (★★★) |
| RVF (Revue du Vin de France) | Panel | **French** | 20-point scale |
| Bettane+Desseauve | Panel | **French** | 20-point scale |
| Jancis Robinson | Critic | English | 20-point scale, global |
| Wine Advocate | Critic | English | 100-point, Bordeaux specialist |

**Priority Order**: `['guide_hachette', 'rvf', 'bettane_desseauve', 'jancis_robinson', 'wine_advocate', 'decanter', 'vivino', 'bbr', 'wine_searcher']`

**Strengths**:
- Major French guides configured
- Wine Advocate strong for Bordeaux
- Jancis Robinson excellent for Burgundy

**Critical Gaps**:
- **All searches conducted in English** despite French sources
- French search queries would be:
  - `"{wine}" {vintage} Guide Hachette étoiles`
  - `"{wine}" {vintage} RVF note /20`
  - `"{wine}" {vintage} Bettane Desseauve`
- La Revue du Vin de France website (larvf.com) may need French queries
- Gilbert & Gaillard not included
- Terre de Vins not included

---

### Italy

**Status**: **Good Coverage, Language Gap**

**Configured Sources**:
| Source | Type | Language | Notes |
|--------|------|----------|-------|
| Gambero Rosso | Panel | **Italian** | Symbol (Tre Bicchieri) |
| Bibenda | Panel | **Italian** | Symbol (5 grappoli) |
| Vinous | Critic | English | Italian specialist |
| Doctor Wine | Critic | **Italian** | doctorwine.it |

**Priority Order**: `['gambero_rosso', 'vinous', 'doctor_wine', 'bibenda', 'james_suckling', 'decanter', 'vivino', 'wine_searcher']`

**Strengths**:
- Gambero Rosso (most authoritative Italian guide)
- Vinous (Antonio Galloni) excellent for Italy
- Symbol conversion implemented (Bicchieri, grappoli)

**Critical Gaps**:
- **All searches in English** despite Italian sources
- Italian search queries would be:
  - `"{wine}" {vintage} Gambero Rosso bicchieri`
  - `"{wine}" {vintage} Bibenda grappoli`
  - `"{wine}" {vintage} Doctor Wine`
- L'Espresso guide not included
- Slow Wine not included
- Vitae (AIS) not included

---

### Spain

**Status**: **Moderate Coverage, Language Gap**

**Configured Sources**:
| Source | Type | Language | Notes |
|--------|------|----------|-------|
| Guia Penin | Panel | **Spanish** | guiapenin.com, 100-point |
| Guia Proensa | Critic | **Spanish** | guiaproensa.com |
| Tim Atkin | Critic | English | Rioja specialist |
| Bodeboca | Aggregator | **Spanish** | Spanish retailer |

**Priority Order**: `['guia_penin', 'tim_atkin', 'guia_proensa', 'decanter', 'james_suckling', 'vivino', 'bodeboca', 'wine_searcher']`

**Strengths**:
- Guia Penin is definitive Spanish reference
- Tim Atkin's Rioja reports well indexed
- Bodeboca aggregates multiple critics

**Critical Gaps**:
- **Searches in English, should be Spanish**:
  - `"{wine}" {vintage} Guía Peñín puntos`
  - `"{wine}" {vintage} bodeboca puntuación`
- Verema (Spanish wine community) not included
- Premios Bacchus not tracked
- Denominación de Origen pages not searched

---

### Chile

**Status**: **Moderate Coverage**

**Configured Sources**:
| Source | Type | Language | Notes |
|--------|------|----------|-------|
| Descorchados | Critic | **Spanish** | descorchados.com |
| Tim Atkin | Critic | English | Chile reports |
| Vinomanos | Panel | **Spanish** | vinomanos.com |

**Priority Order**: `['descorchados', 'tim_atkin', 'vinomanos', 'james_suckling', 'decanter', 'vivino', 'wine_searcher']`

**Gaps**:
- **No Spanish-language queries** implemented
- Wines of Chile official ratings not tracked
- Chile Wine Awards not included
- Local retailer aggregators not included

---

### Argentina

**Status**: **Moderate Coverage**

**Configured Sources**:
| Source | Type | Language | Notes |
|--------|------|----------|-------|
| Descorchados | Critic | **Spanish** | descorchados.com |
| Tim Atkin | Critic | English | Argentina reports |

**Priority Order**: `['descorchados', 'tim_atkin', 'james_suckling', 'decanter', 'vivino', 'wine_searcher']`

**Gaps**:
- **No Spanish-language queries**
- Vinomanos not in priority list (should be)
- Argentina Wine Awards not tracked
- Wines of Argentina official ratings

---

### Germany

**Status**: **Moderate Coverage**

**Configured Sources**:
| Source | Type | Language | Notes |
|--------|------|----------|-------|
| Falstaff | Panel | **German** | falstaff.com |
| Vinum | Panel | **German** | vinum.eu, 20-point |
| Weinwisser | Critic | **German** | weinwisser.com |

**Priority Order**: `['falstaff', 'weinwisser', 'vinum', 'jancis_robinson', 'decanter', 'vivino', 'wine_searcher']`

**Gaps**:
- **No German-language queries**:
  - `"{wine}" {vintage} Falstaff Punkte`
  - `"{wine}" {vintage} Vinum /20`
- Gault&Millau WeinGuide not included
- Eichelmann not included
- VDP classification not tracked

---

### Austria

**Status**: **Moderate Coverage**

**Configured Sources**:
| Source | Type | Language | Notes |
|--------|------|----------|-------|
| Falstaff | Panel | **German** | falstaff.com |
| Vinum | Panel | **German** | vinum.eu |

**Priority Order**: `['falstaff', 'vinum', 'decanter', 'vivino', 'wine_searcher']`

**Gaps**:
- Austrian Wine Marketing Board ratings
- Vinaria magazine not included
- No German-language queries

---

### Portugal

**Status**: **Weak Coverage**

**Configured Sources**:
| Source | Type | Language | Notes |
|--------|------|----------|-------|
| Revista de Vinhos | Panel | **Portuguese** | revistadevinhos.pt |

**Priority Order**: `['revista_vinhos', 'jancis_robinson', 'tim_atkin', 'decanter', 'vivino', 'wine_searcher']`

**Critical Gaps**:
- **Only one Portuguese source**
- **No Portuguese-language queries**
- Grandes Escolhas not included
- Wine & Soul ratings
- Wines of Portugal official not tracked
- Porto/Madeira specialist critics missing

---

### Greece

**Status**: **Weak Coverage**

**Configured Sources**:
| Source | Type | Language | Notes |
|--------|------|----------|-------|
| Elloinos | Panel | **Greek** | elloinos.com |

**Priority Order**: `['elloinos', 'decanter', 'vivino', 'wine_searcher']`

**Critical Gaps**:
- **Only one Greek source**
- **No Greek-language queries**
- Wine & Spirits magazine (Greek) not included
- Oinotita not included
- Greek wine competitions not tracked

---

### USA (California, Oregon, Washington)

**Status**: **Good for Critics, Missing Wine Shows**

**Configured Sources**:
| Source | Type | Language | Notes |
|--------|------|----------|-------|
| Wine Spectator | Critic | English | winespectator.com |
| Wine Enthusiast | Critic | English | winemag.com |
| Vinous | Critic | English | California coverage |
| Wine Advocate | Critic | English | Parker heritage |

**Priority Order**: `['wine_spectator', 'wine_enthusiast', 'vinous', 'wine_advocate', 'james_suckling', 'decanter', 'vivino', 'wine_searcher']`

**Gaps**:
- San Francisco Chronicle Wine Competition not tracked
- Sunset Magazine wine awards
- Seattle Wine Awards
- Winery of the Year awards
- Total Wine ratings not included
- K&L Wine Merchants ratings

---

## Language Strategy

### Current Implementation

**All searches are conducted in English**, regardless of the source's native language.

```javascript
// Current query template examples:
guia_penin: '{wine} {vintage} Guía Peñín puntos'  // Spanish keywords but English structure
gambero_rosso: '{wine} {vintage} Gambero Rosso bicchieri'  // Italian keywords
guide_hachette: '{wine} {vintage} Guide Hachette'  // Should include French keywords
```

### Drinking Window Patterns (Multi-Language)

The system **does** handle multi-language drinking window extraction:

```javascript
const DRINKING_WINDOW_PATTERNS = [
  // English
  { pattern: /drink\s*(\d{4})\s*[-–—to]+\s*(\d{4})/i },

  // Italian
  { pattern: /bere\s*entro\s*(?:il\s*)?(\d{4})/i },  // "Bere entro il 2030"

  // French
  { pattern: /[àa]\s*boire\s*jusqu[''u]?en\s*(\d{4})/i }  // "À boire jusqu'en 2028"
];
```

### Recommended Language Strategy

| Country | Primary Language | Query Example |
|---------|-----------------|---------------|
| France | French | `"{wine}" {vintage} Hachette étoiles OR "coup de coeur"` |
| Italy | Italian | `"{wine}" {vintage} "tre bicchieri" OR "cinque grappoli"` |
| Spain | Spanish | `"{wine}" {vintage} Peñín puntos OR "puntuación"` |
| Germany/Austria | German | `"{wine}" {vintage} Falstaff Punkte OR "Bewertung"` |
| Portugal | Portuguese | `"{wine}" {vintage} Revista Vinhos pontos` |
| Chile/Argentina | Spanish | `"{wine}" {vintage} Descorchados puntos` |

---

## Producer Website Strategy

### Current Implementation

**Implemented in `searchProviders.js` lines 1569-1617**

**Process**:
1. Extract producer name using `extractProducerName()`
   - Takes first 1-5 words before grape variety keywords
   - Stops at: cabernet, merlot, shiraz, blend, reserve, etc.
2. Search Google: `"{producer}" winery official site awards`
3. Filter results using `checkIfProducerSite()`
   - Excludes known retailers (Vivino, Wine-Searcher, etc.)
   - Checks domain for producer keywords
   - Looks for winery URL patterns (`/wines/`, `/product/`, etc.)
4. Fetch and extract awards from producer's site

**Domain Detection**:
```javascript
// TLDs recognized for wine-producing countries
const domainWithoutTld = domain.replace(
  /\.(com|co\.za|co\.nz|co\.uk|com\.au|wine|wines|vin|vino|fr|it|es|de|cl|ar|...)$/,
  ''
);
```

### Strengths

- Extracts producer name intelligently
- Handles multiple TLD variations
- Excludes known aggregators
- Awards page detection

### Gaps

- **No localized search queries** for producer websites
  - French producers: `"{producer}" domaine site officiel`
  - Italian producers: `"{producer}" cantina sito ufficiale`
  - Spanish producers: `"{producer}" bodega sitio oficial`
- No handling of:
  - Regional wine route websites
  - Appellation/DO official websites
  - Cooperative winery pages

---

## Aggregator Market Coverage

### Implemented Aggregators

| Aggregator | Country | Sources Aggregated | Status |
|------------|---------|-------------------|--------|
| Wine-Searcher | Global | 30+ critics | **Active** |
| Dan Murphy's | Australia | Halliday, Hooke, Campbell | **Active** |
| Bodeboca | Spain | Peñín, Parker, Suckling | **Active** |
| wine.co.za | South Africa | Platters, Tim Atkin, DWWA | **Active** |
| BBR | UK | Parker, Jancis, Vinous | **Active** |

### Missing Aggregator Markets

| Market | Potential Aggregators | Why Important |
|--------|----------------------|---------------|
| **USA** | Total Wine, K&L Wine Merchants, Wine.com | Largest import market |
| **Netherlands** | Wijnvoordeel, Gall & Gall | Major European importer |
| **Belgium** | Colruyt, Delhaize | Significant market |
| **Switzerland** | Mövenpick, Coop | High-value market |
| **Canada** | LCBO, SAQ, BC Liquor | Provincial monopolies aggregate ratings |
| **UK (additional)** | Majestic, Laithwaites | High-volume retailers |
| **Hong Kong** | Watson's Wine, ASC Fine Wines | Asian gateway market |
| **Singapore** | Wine Connection, 1855 The Bottle Shop | SEA market |

---

## Identified Gaps & Recommendations

### Priority 1: Language Support (High Impact)

**Current**: All searches in English
**Required**: Native language queries for non-English sources

**Implementation**:
```javascript
// Proposed: Add language-specific query templates
const LANGUAGE_QUERY_TEMPLATES = {
  'fr': {
    guide_hachette: '"{wine}" {vintage} Guide Hachette étoiles',
    rvf: '"{wine}" {vintage} RVF note',
    bettane_desseauve: '"{wine}" {vintage} Bettane Desseauve'
  },
  'it': {
    gambero_rosso: '"{wine}" {vintage} Gambero Rosso "tre bicchieri"',
    bibenda: '"{wine}" {vintage} Bibenda grappoli'
  },
  'es': {
    guia_penin: '"{wine}" {vintage} Guía Peñín puntos',
    descorchados: '"{wine}" {vintage} Descorchados puntos'
  },
  'de': {
    falstaff: '"{wine}" {vintage} Falstaff Punkte',
    vinum: '"{wine}" {vintage} Vinum Bewertung'
  },
  'pt': {
    revista_vinhos: '"{wine}" {vintage} Revista Vinhos pontos'
  }
};
```

### Priority 2: Missing Wine-Producing Countries

**Not Configured**:
- **Lebanon**: Chateau Musar, etc. (Use Tim Atkin, Jancis)
- **Israel**: Golan Heights, Carmel (Specialized critics needed)
- **Canada**: VQA wines (Use WineAlign, Natalie MacLean)
- **Hungary**: Tokaji (Need local Hungarian sources)
- **Slovenia/Croatia**: Emerging regions (No sources)
- **South Africa - Cape Independents**: Specialized boutique ratings

### Priority 3: Missing Competitions

| Competition | Coverage | Countries |
|-------------|----------|-----------|
| San Francisco Chronicle | Not tracked | USA |
| Concours des Vins de Bourgogne | Not tracked | France |
| Challenge International du Vin | Not tracked | Global |
| Asia Wine Trophy | Not tracked | Asia focus |
| Texsom | Not tracked | USA |
| Sommelier Wine Awards | Not tracked | UK |
| AWC Vienna | Not tracked | Austria |
| Berliner Wein Trophy | Not tracked | Germany |

### Priority 4: USA Aggregator Market

**Recommendation**: Add USA retail aggregators
- Total Wine & More (totalwine.com)
- K&L Wine Merchants (klwines.com)
- Wine.com
- Drizly

### Priority 5: European Importers

**Recommendation**: Add European import market aggregators
- Netherlands: Wijnvoordeel, Gall & Gall
- Belgium: Colruyt wine selection
- Switzerland: Mövenpick
- UK: Majestic, Laithwaites

---

## Appendix: Source Registry

### Complete Source List (50+ Sources)

#### Competitions (Global)
- `decanter` - Decanter World Wine Awards
- `iwc` - International Wine Challenge
- `iwsc` - International Wine & Spirit Competition
- `concours_mondial` - Concours Mondial de Bruxelles
- `mundus_vini` - Mundus Vini

#### Competitions (Regional)
- `veritas` - Veritas Awards (South Africa)
- `old_mutual` - Old Mutual Trophy Wine Show (South Africa)

#### Competitions (Varietal)
- `chardonnay_du_monde` - Chardonnay du Monde
- `syrah_du_monde` - Syrah du Monde
- `grenaches_du_monde` - Grenaches du Monde

#### Panel Guides
- `platters` - Platter's Wine Guide (South Africa)
- `halliday` - Halliday Wine Companion (Australia)
- `gourmet_traveller_wine` - Gourmet Traveller Wine (Australia)
- `guia_penin` - Guía Peñín (Spain)
- `gambero_rosso` - Gambero Rosso (Italy)
- `bibenda` - Bibenda (Italy)
- `guide_hachette` - Guide Hachette des Vins (France)
- `rvf` - Revue du Vin de France (France)
- `bettane_desseauve` - Bettane+Desseauve (France)
- `falstaff` - Falstaff (Germany/Austria)
- `vinum` - Vinum (German-speaking)
- `revista_vinhos` - Revista de Vinhos (Portugal)
- `elloinos` - Elloinos (Greece)
- `vinomanos` - Vinómanos (Chile/Argentina)

#### Critics
- `tim_atkin` - Tim Atkin MW
- `huon_hooke` - Huon Hooke (Australia)
- `bob_campbell` - Bob Campbell MW (New Zealand)
- `wine_orbit` - Wine Orbit (New Zealand)
- `guia_proensa` - Guía Proensa (Spain)
- `vinous` - Vinous (Antonio Galloni)
- `doctor_wine` - Doctor Wine (Italy)
- `weinwisser` - Weinwisser (Germany)
- `descorchados` - Descorchados (South America)
- `wine_advocate` - Wine Advocate / Robert Parker
- `wine_spectator` - Wine Spectator
- `james_suckling` - James Suckling
- `jancis_robinson` - Jancis Robinson
- `decanter_magazine` - Decanter Magazine
- `wine_enthusiast` - Wine Enthusiast
- `natalie_maclean` - Natalie MacLean

#### Community
- `cellar_tracker` - CellarTracker
- `wine_align` - WineAlign (Canada)
- `vivino` - Vivino

#### Aggregators
- `wine_searcher` - Wine-Searcher
- `dan_murphys` - Dan Murphy's (Australia)
- `bodeboca` - Bodeboca (Spain)
- `wine_co_za` - Wine.co.za (South Africa)
- `bbr` - Berry Bros & Rudd (UK)

#### Producer
- `producer_website` - Winery official website

---

## Conclusion

The current system is **architecturally sound** with sophisticated multi-tier search, intelligent caching, and AI-powered extraction. However, there are significant opportunities for improvement:

1. **Language Gap** is the most impactful issue - implementing native language queries could dramatically improve result quality for France, Italy, Spain, Germany, and Portugal.

2. **Missing Aggregator Markets** - USA and Netherlands represent huge import markets with untapped rating aggregation potential.

3. **Competition Coverage** - Several major wine shows and competitions are not tracked.

4. **Regional Gaps** - Portugal, Greece, and emerging regions lack adequate source coverage.

The system's modular design makes it well-suited for these enhancements - new sources can be added to `unifiedSources.js` and language templates can be added to the query building logic without major architectural changes.
