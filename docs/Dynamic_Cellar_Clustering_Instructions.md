# Dynamic Cellar Clustering System v2

**Purpose:** Implement an AI-assisted cellar organisation system that maintains thematic wine clusters and suggests reorganisation when inventory changes.

**Version:** 2.0 - Incorporates review feedback on row collisions, scoring bugs, and missing categories.

---

## Key Changes from v1

| Issue | v1 Problem | v2 Fix |
|-------|------------|--------|
| Row collisions | Multiple zones claimed same rows via overflow | Dedicated buffer rows; no shared rows |
| Score normalisation | Could exceed 100 | Cap at 100; track possible points |
| Fragmentation sort | Lexicographic (R10 before R2) | Numeric row/col parsing |
| Curiosities overload | Both curated + catch-all | Split into Curiosities + Unclassified |
| Missing categories | No Rosé, Sparkling, Dessert, Pinot | Added dedicated zones |
| Style overload | Mixed region/appellation/style | Separate canonical fields |
| Move suggestions | Gave up when zone full | Fallback chain with swap proposals |
| AI guardrails | No validation | JSON schema + XSS-safe rendering |
| Trigger thresholds | Too aggressive | Minimum thresholds before nagging |

---

## 1. Cellar Layout (Revised)

### Physical Structure

```
FRIDGE: F1-F9 (9 slots) - Chilled, drink soon

CELLAR: 19 rows × 9 columns = 171 slots
- Rows R1-R19
- Columns C1-C9
- Slot format: R{row}C{col} e.g., R5C3
```

### Zone Allocation (No Overlaps)

| Row(s) | Zone ID | Display Name | Purpose |
|--------|---------|--------------|---------|
| R1 | sauvignon_blanc | Sauvignon Blanc | Primary SB storage |
| R2 | sauvignon_blanc_overflow | Sauvignon Blanc 2 | SB overflow only |
| R3 | chenin_blanc | Chenin Blanc | Chenin + Vouvray |
| R4 | aromatic_whites | Aromatic Whites | Riesling, Gewürz, Viognier |
| R5 | chardonnay | Chardonnay | Oaked and unoaked |
| R6 | loire_light | Loire & Light | Muscadet, Picpoul, Verdejo |
| R7 | rose_sparkling | Rosé & Sparkling | Pink wines + bubbles |
| R8 | iberian_fresh | Iberian Fresh | Young Spanish reds |
| R9 | rioja_ribera | Rioja & Ribera | Aged Spanish reds |
| R10 | portugal | Portugal | All Portuguese reds |
| R11 | southern_france | Southern France | Rhône, Languedoc, SW |
| R12 | puglia_primitivo | Puglia & Primitivo | Southern Italian |
| R13 | appassimento | Appassimento | Dried grape wines |
| R14 | piedmont | Piedmont | Nebbiolo, Barbera |
| R15 | romagna_tuscany | Romagna & Tuscany | Sangiovese country |
| R16 | cabernet | Cabernet Sauvignon | Single varietal Cab |
| R17 | sa_blends | SA Blends | Cape Bordeaux blends |
| R18 | shiraz | Shiraz / Syrah | Single varietal Shiraz |
| R19 | pinot_noir | Pinot Noir | Lighter reds |
| — | white_buffer | White Buffer | Virtual overflow for whites |
| — | red_buffer | Red Buffer | Virtual overflow for reds |
| — | curiosities | Curiosities | Curated unusual wines |
| — | unclassified | Unclassified | True catch-all (flag to user) |

**Note:** Buffer zones and Curiosities/Unclassified don't have dedicated rows - they use available slots across the cellar when primary zones are full.

---

## 2. Data Model

### 2.1 Wine Attributes (Canonical Fields)

Store wines with properly separated fields to avoid matching ambiguity:

```javascript
// src/models/wine.js
const WineSchema = {
  id: 'integer primary key',
  wine_name: 'text not null',
  vintage: 'integer',
  
  // Canonical classification fields
  color: 'text',           // 'red' | 'white' | 'rosé' | 'sparkling' | 'dessert' | 'fortified'
  grapes: 'text',          // JSON array: ['cabernet sauvignon', 'merlot']
  country: 'text',
  region: 'text',          // e.g., 'Western Cape', 'Piedmont'
  appellation: 'text',     // e.g., 'Stellenbosch', 'Barolo DOCG'
  
  // Winemaking attributes
  winemaking: 'text',      // JSON array: ['appassimento', 'oak_aged', 'organic']
  sweetness: 'text',       // 'dry' | 'off-dry' | 'medium-sweet' | 'sweet'
  
  // Cellar management
  slot_id: 'text',
  zone_id: 'text',         // Assigned zone
  zone_confidence: 'text', // 'high' | 'medium' | 'low'
  
  // Metadata
  created_at: 'datetime',
  updated_at: 'datetime'
};
```

### 2.2 Zone Configuration

```javascript
// src/config/cellarZones.js

export const CELLAR_ZONES = {
  fridge: {
    slots: ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9'],
    capacity: 9,
    purpose: 'drink_soon',
    description: 'Chilled wines ready to drink within 1-2 weeks'
  },
  
  zones: [
    // ========== WHITE WINES ==========
    {
      id: 'sauvignon_blanc',
      displayName: 'Sauvignon Blanc',
      rows: ['R1'],
      capacity: 9,
      overflowZoneId: 'sauvignon_blanc_overflow',
      color: 'white',
      rules: {
        grapes: ['sauvignon blanc'],
        keywords: ['fumé blanc', 'pouilly-fumé', 'sancerre']
      },
      sortPreference: ['country', 'producer', 'vintage']
    },
    {
      id: 'sauvignon_blanc_overflow',
      displayName: 'Sauvignon Blanc 2',
      rows: ['R2'],
      capacity: 9,
      overflowZoneId: 'white_buffer',
      color: 'white',
      rules: {
        // Same as parent - only receives overflow
        grapes: ['sauvignon blanc'],
        keywords: ['fumé blanc']
      },
      isOverflowZone: true,
      parentZoneId: 'sauvignon_blanc',
      sortPreference: ['country', 'producer', 'vintage']
    },
    {
      id: 'chenin_blanc',
      displayName: 'Chenin Blanc',
      rows: ['R3'],
      capacity: 9,
      overflowZoneId: 'white_buffer',
      color: 'white',
      rules: {
        grapes: ['chenin blanc'],
        keywords: ['vouvray', 'savennières', 'steen'],
        appellations: ['Vouvray', 'Savennières', 'Anjou']
      },
      sortPreference: ['sweetness', 'country', 'vintage']
    },
    {
      id: 'aromatic_whites',
      displayName: 'Aromatic Whites',
      rows: ['R4'],
      capacity: 9,
      overflowZoneId: 'white_buffer',
      color: 'white',
      rules: {
        grapes: ['riesling', 'gewürztraminer', 'gewurztraminer', 'viognier', 
                 'torrontés', 'muscat', 'moscato', 'malvasia', 'albariño', 'albarino'],
        keywords: ['aromatic', 'spätlese', 'auslese', 'kabinett']
      },
      sortPreference: ['grape', 'sweetness', 'country']
    },
    {
      id: 'chardonnay',
      displayName: 'Chardonnay',
      rows: ['R5'],
      capacity: 9,
      overflowZoneId: 'white_buffer',
      color: 'white',
      rules: {
        grapes: ['chardonnay'],
        keywords: ['white burgundy', 'chablis', 'meursault', 'pouilly-fuissé', 'montrachet']
      },
      sortPreference: ['winemaking', 'country', 'vintage'] // oaked vs unoaked
    },
    {
      id: 'loire_light',
      displayName: 'Loire & Light',
      rows: ['R6'],
      capacity: 9,
      overflowZoneId: 'white_buffer',
      color: 'white',
      rules: {
        grapes: ['melon de bourgogne', 'picpoul', 'vermentino', 'verdejo', 
                 'grüner veltliner', 'gruner veltliner', 'assyrtiko'],
        keywords: ['muscadet', 'côtes de gascogne', 'vinho verde', 'picpoul de pinet'],
        regions: ['Loire', 'Gascony', 'Galicia']
      },
      sortPreference: ['region', 'vintage']
    },
    
    // ========== ROSÉ & SPARKLING ==========
    {
      id: 'rose_sparkling',
      displayName: 'Rosé & Sparkling',
      rows: ['R7'],
      capacity: 9,
      overflowZoneId: 'white_buffer',
      color: ['rosé', 'sparkling'], // Accepts either
      rules: {
        grapes: [], // Any grape
        keywords: ['rosé', 'rose', 'rosado', 'sparkling', 'champagne', 'prosecco', 
                   'cava', 'crémant', 'cremant', 'spumante', 'sekt', 'méthode traditionnelle'],
        winemaking: ['méthode champenoise', 'charmat', 'pet-nat']
      },
      sortPreference: ['color', 'country', 'vintage']
    },
    
    // ========== IBERIAN REDS ==========
    {
      id: 'iberian_fresh',
      displayName: 'Iberian Fresh',
      rows: ['R8'],
      capacity: 9,
      overflowZoneId: 'red_buffer',
      color: 'red',
      rules: {
        grapes: ['tempranillo', 'garnacha', 'grenache', 'bobal', 'mencía', 'mencia', 
                 'monastrell', 'cariñena'],
        keywords: ['joven', 'tinto joven', 'garnacha'],
        countries: ['Spain'],
        excludeKeywords: ['reserva', 'gran reserva', 'rioja', 'ribera del duero']
      },
      sortPreference: ['region', 'vintage']
    },
    {
      id: 'rioja_ribera',
      displayName: 'Rioja & Ribera',
      rows: ['R9'],
      capacity: 9,
      overflowZoneId: 'red_buffer',
      color: 'red',
      rules: {
        grapes: ['tempranillo', 'tinto fino', 'tinta del país'],
        keywords: ['rioja', 'ribera del duero', 'reserva', 'gran reserva', 'crianza', 'toro'],
        appellations: ['Rioja', 'Ribera del Duero', 'Toro'],
        countries: ['Spain']
      },
      sortPreference: ['appellation', 'classification', 'vintage']
    },
    {
      id: 'portugal',
      displayName: 'Portugal',
      rows: ['R10'],
      capacity: 9,
      overflowZoneId: 'red_buffer',
      color: 'red',
      rules: {
        grapes: ['touriga nacional', 'touriga franca', 'tinta roriz', 'castelão', 
                 'baga', 'trincadeira', 'alicante bouschet'],
        keywords: ['douro', 'dão', 'alentejo', 'bairrada'],
        countries: ['Portugal']
      },
      sortPreference: ['region', 'vintage']
    },
    
    // ========== FRENCH REDS ==========
    {
      id: 'southern_france',
      displayName: 'Southern France',
      rows: ['R11'],
      capacity: 9,
      overflowZoneId: 'red_buffer',
      color: 'red',
      rules: {
        grapes: ['syrah', 'grenache', 'mourvèdre', 'carignan', 'cinsault', 'malbec'],
        keywords: ['côtes du rhône', 'cotes du rhone', 'languedoc', 'roussillon', 
                   'cabardes', 'minervois', 'corbières', 'cahors', 'châteauneuf'],
        regions: ['Rhône', 'Languedoc', 'Roussillon', 'Southwest France'],
        countries: ['France'],
        excludeRegions: ['Bordeaux', 'Burgundy', 'Loire']
      },
      sortPreference: ['region', 'vintage']
    },
    
    // ========== ITALIAN REDS ==========
    {
      id: 'puglia_primitivo',
      displayName: 'Puglia & Primitivo',
      rows: ['R12'],
      capacity: 9,
      overflowZoneId: 'red_buffer',
      color: 'red',
      rules: {
        grapes: ['primitivo', 'negroamaro', 'susumaniello', 'nero di troia', 'malvasia nera'],
        keywords: ['primitivo', 'salice salentino', 'manduria', 'puglia', 'salento'],
        regions: ['Puglia', 'Apulia', 'Salento'],
        countries: ['Italy'],
        excludeWinemaking: ['appassimento'] // Those go to appassimento zone
      },
      sortPreference: ['grape', 'vintage']
    },
    {
      id: 'appassimento',
      displayName: 'Appassimento',
      rows: ['R13'],
      capacity: 9,
      overflowZoneId: 'red_buffer',
      color: 'red',
      rules: {
        // Winemaking method takes priority over grape
        winemaking: ['appassimento', 'dried grape', 'raisined'],
        keywords: ['appassimento', 'amarone', 'ripasso', 'recioto', 'passito'],
        countries: ['Italy']
      },
      priority: 'high', // Check before grape-based Italian zones
      sortPreference: ['style', 'vintage']
    },
    {
      id: 'piedmont',
      displayName: 'Piedmont',
      rows: ['R14'],
      capacity: 9,
      overflowZoneId: 'red_buffer',
      color: 'red',
      rules: {
        grapes: ['nebbiolo', 'barbera', 'dolcetto'],
        keywords: ['barolo', 'barbaresco', 'langhe', 'roero', 'gattinara', 'ghemme'],
        regions: ['Piedmont', 'Piemonte'],
        countries: ['Italy']
      },
      sortPreference: ['appellation', 'vintage']
    },
    {
      id: 'romagna_tuscany',
      displayName: 'Romagna & Tuscany',
      rows: ['R15'],
      capacity: 9,
      overflowZoneId: 'red_buffer',
      color: 'red',
      rules: {
        grapes: ['sangiovese', 'montepulciano', 'canaiolo', 'colorino'],
        keywords: ['chianti', 'brunello', 'vino nobile', 'morellino', 'rosso di montalcino'],
        regions: ['Tuscany', 'Toscana', 'Romagna', 'Emilia-Romagna', 'Umbria'],
        countries: ['Italy']
      },
      sortPreference: ['appellation', 'vintage']
    },
    
    // ========== NEW WORLD REDS ==========
    {
      id: 'cabernet',
      displayName: 'Cabernet Sauvignon',
      rows: ['R16'],
      capacity: 9,
      overflowZoneId: 'red_buffer',
      color: 'red',
      rules: {
        grapes: ['cabernet sauvignon'],
        keywords: ['cabernet sauvignon'],
        excludeKeywords: ['bordeaux blend', 'meritage', 'cape blend'],
        minGrapePercent: 85 // Must be predominantly Cab
      },
      sortPreference: ['country', 'producer', 'vintage']
    },
    {
      id: 'sa_blends',
      displayName: 'SA Blends',
      rows: ['R17'],
      capacity: 9,
      overflowZoneId: 'red_buffer',
      color: 'red',
      rules: {
        grapes: ['cabernet sauvignon', 'merlot', 'cabernet franc', 'petit verdot', 
                 'malbec', 'pinotage'],
        keywords: ['bordeaux blend', 'meritage', 'cape blend', 'red blend'],
        countries: ['South Africa'],
        minGrapes: 2 // Must be a blend
      },
      sortPreference: ['producer', 'vintage']
    },
    {
      id: 'shiraz',
      displayName: 'Shiraz / Syrah',
      rows: ['R18'],
      capacity: 9,
      overflowZoneId: 'red_buffer',
      color: 'red',
      rules: {
        grapes: ['shiraz', 'syrah'],
        keywords: ['shiraz', 'syrah'],
        excludeKeywords: ['rhône blend', 'gsm', 'côtes du rhône']
      },
      sortPreference: ['country', 'producer', 'vintage']
    },
    {
      id: 'pinot_noir',
      displayName: 'Pinot Noir',
      rows: ['R19'],
      capacity: 9,
      overflowZoneId: 'red_buffer',
      color: 'red',
      rules: {
        grapes: ['pinot noir'],
        keywords: ['pinot noir', 'red burgundy', 'bourgogne rouge', 'spätburgunder']
      },
      sortPreference: ['country', 'region', 'vintage']
    },
    
    // ========== BUFFER & FALLBACK ZONES ==========
    {
      id: 'white_buffer',
      displayName: 'White Reserve',
      rows: [], // No dedicated row - finds gaps in white zones
      capacity: null, // Dynamic
      overflowZoneId: 'unclassified',
      color: 'white',
      isBufferZone: true,
      slotSearchOrder: ['R6', 'R4', 'R5', 'R3', 'R2', 'R1'], // Prefer less-used rows
      rules: {
        color: ['white', 'rosé', 'sparkling']
      },
      sortPreference: ['zone_preference', 'vintage']
    },
    {
      id: 'red_buffer',
      displayName: 'Red Reserve',
      rows: [], // No dedicated row - finds gaps in red zones
      capacity: null, // Dynamic
      overflowZoneId: 'unclassified',
      color: 'red',
      isBufferZone: true,
      slotSearchOrder: ['R19', 'R11', 'R10', 'R8'], // Prefer less-used rows
      rules: {
        color: ['red']
      },
      sortPreference: ['zone_preference', 'vintage']
    },
    {
      id: 'curiosities',
      displayName: 'Curiosities',
      rows: [], // No dedicated row - shares with unclassified
      capacity: null,
      overflowZoneId: 'unclassified',
      color: null, // Any
      isCuratedZone: true, // Intentionally unusual - NOT a fallback
      rules: {
        // Specific unusual varieties/regions - curated list
        grapes: ['saperavi', 'xinomavro', 'agiorgitiko', 'plavac mali', 
                 'blaufränkisch', 'zweigelt', 'kadarka', 'furmint', 'fetească'],
        countries: ['Georgia', 'Greece', 'Croatia', 'Hungary', 'Austria', 
                    'Slovenia', 'Bulgaria', 'Romania', 'Lebanon', 'Israel'],
        keywords: ['orange wine', 'skin contact', 'amphora', 'qvevri']
      },
      sortPreference: ['country', 'grape', 'vintage']
    },
    {
      id: 'unclassified',
      displayName: 'Unclassified',
      rows: [], // Uses any available slot
      capacity: null,
      overflowZoneId: null, // Terminal - nowhere else to go
      color: null,
      isFallbackZone: true, // TRUE catch-all
      alertOnPlacement: true, // Always notify user
      rules: {
        // Accepts anything - but flags for review
      },
      sortPreference: ['color', 'country', 'vintage']
    }
  ]
};

/**
 * Zone evaluation order - specific zones first, fallbacks last
 * Zones with 'priority: high' are checked before others in their category
 */
export const ZONE_PRIORITY_ORDER = [
  // High priority - winemaking method zones (check first)
  'appassimento',
  
  // Color-first check
  'rose_sparkling',
  
  // Region-specific (most specific)
  'piedmont',
  'romagna_tuscany',
  'puglia_primitivo',
  'rioja_ribera',
  'portugal',
  'southern_france',
  
  // Country + blend
  'sa_blends',
  
  // Country + young/fresh
  'iberian_fresh',
  
  // Single grape varieties (less specific)
  'sauvignon_blanc',
  'sauvignon_blanc_overflow',
  'chenin_blanc',
  'aromatic_whites',
  'chardonnay',
  'loire_light',
  'cabernet',
  'shiraz',
  'pinot_noir',
  
  // Curated unusual
  'curiosities',
  
  // Buffer zones
  'white_buffer',
  'red_buffer',
  
  // True fallback - always last
  'unclassified'
];
```

---

## 3. Placement Algorithm (Fixed)

### 3.1 Create `src/services/cellarPlacement.js`

```javascript
import { CELLAR_ZONES, ZONE_PRIORITY_ORDER } from '../config/cellarZones.js';

/**
 * Determine the best zone for a wine based on its attributes
 * @param {Object} wine - Wine object with canonical fields
 * @returns {Object} - { zoneId, confidence, reason, alternativeZones }
 */
export function findBestZone(wine) {
  const normalizedWine = normalizeWineAttributes(wine);
  const matches = [];

  for (const zoneId of ZONE_PRIORITY_ORDER) {
    const zone = CELLAR_ZONES.zones.find(z => z.id === zoneId);
    if (!zone) continue;
    
    // Skip overflow zones in primary matching - they're only for spillover
    if (zone.isOverflowZone) continue;
    
    // Skip buffer/fallback zones - they're checked separately
    if (zone.isBufferZone || zone.isFallbackZone) continue;

    const matchResult = calculateZoneMatch(normalizedWine, zone);
    
    if (matchResult.score > 0) {
      matches.push({ 
        zoneId, 
        zone, 
        score: matchResult.score,
        matchedOn: matchResult.matchedOn
      });
    }
  }

  // Sort by score descending
  matches.sort((a, b) => b.score - a.score);

  // If no matches, check curiosities then fallback
  if (matches.length === 0) {
    const curiositiesZone = CELLAR_ZONES.zones.find(z => z.id === 'curiosities');
    const curiositiesMatch = calculateZoneMatch(normalizedWine, curiositiesZone);
    
    if (curiositiesMatch.score > 30) {
      return {
        zoneId: 'curiosities',
        displayName: 'Curiosities',
        confidence: 'medium',
        score: curiositiesMatch.score,
        reason: `Unusual variety/region: ${curiositiesMatch.matchedOn.join(', ')}`,
        alternativeZones: [],
        requiresReview: false
      };
    }
    
    // True fallback
    return {
      zoneId: 'unclassified',
      displayName: 'Unclassified',
      confidence: 'low',
      score: 0,
      reason: 'No matching zone found - requires manual classification',
      alternativeZones: [],
      requiresReview: true // Alert user
    };
  }

  const best = matches[0];
  const confidence = calculateConfidence(best.score, matches);

  return {
    zoneId: best.zoneId,
    displayName: best.zone.displayName,
    confidence,
    score: best.score,
    reason: `Matched on: ${best.matchedOn.join(', ')}`,
    alternativeZones: matches.slice(1, 4).map(m => ({
      zoneId: m.zoneId,
      displayName: m.zone.displayName,
      score: m.score,
      matchedOn: m.matchedOn
    })),
    requiresReview: confidence === 'low'
  };
}

/**
 * Calculate how well a wine matches a zone's rules
 * FIXED: Proper normalisation, capped at 100
 * @returns {Object} { score: 0-100, matchedOn: string[] }
 */
function calculateZoneMatch(wine, zone) {
  const rules = zone.rules;
  let earnedPoints = 0;
  let possiblePoints = 0;
  const matchedOn = [];

  // Color match (weight: 15 points)
  if (zone.color) {
    possiblePoints += 15;
    const zoneColors = Array.isArray(zone.color) ? zone.color : [zone.color];
    if (wine.color && zoneColors.includes(wine.color.toLowerCase())) {
      earnedPoints += 15;
      matchedOn.push(`color: ${wine.color}`);
    } else if (wine.color && !zoneColors.includes(wine.color.toLowerCase())) {
      // Wrong color = disqualify
      return { score: 0, matchedOn: [] };
    }
  }

  // Grape match (weight: 35 points)
  if (rules.grapes && rules.grapes.length > 0) {
    possiblePoints += 35;
    const grapeMatch = wine.grapes.find(g => 
      rules.grapes.some(rg => g.toLowerCase().includes(rg.toLowerCase()))
    );
    if (grapeMatch) {
      earnedPoints += 35;
      matchedOn.push(`grape: ${grapeMatch}`);
    }
  }

  // Keyword match (weight: 25 points)
  if (rules.keywords && rules.keywords.length > 0) {
    possiblePoints += 25;
    const searchText = `${wine.name} ${wine.style} ${wine.appellation}`.toLowerCase();
    const keywordMatch = rules.keywords.find(k => searchText.includes(k.toLowerCase()));
    if (keywordMatch) {
      earnedPoints += 25;
      matchedOn.push(`keyword: ${keywordMatch}`);
    }
  }

  // Country match (weight: 15 points)
  if (rules.countries && rules.countries.length > 0) {
    possiblePoints += 15;
    if (wine.country && rules.countries.some(c => 
      wine.country.toLowerCase() === c.toLowerCase()
    )) {
      earnedPoints += 15;
      matchedOn.push(`country: ${wine.country}`);
    }
  }

  // Region match (weight: 10 points)
  if (rules.regions && rules.regions.length > 0) {
    possiblePoints += 10;
    if (wine.region && rules.regions.some(r => 
      wine.region.toLowerCase().includes(r.toLowerCase())
    )) {
      earnedPoints += 10;
      matchedOn.push(`region: ${wine.region}`);
    }
  }

  // Winemaking match (weight: 30 points) - high weight for method-based zones
  if (rules.winemaking && rules.winemaking.length > 0) {
    possiblePoints += 30;
    const wmMatch = wine.winemaking.find(wm =>
      rules.winemaking.some(rwm => wm.toLowerCase().includes(rwm.toLowerCase()))
    );
    if (wmMatch) {
      earnedPoints += 30;
      matchedOn.push(`winemaking: ${wmMatch}`);
    }
  }

  // Exclusion checks - disqualify if matched
  if (rules.excludeKeywords) {
    const searchText = `${wine.name} ${wine.style} ${wine.appellation}`.toLowerCase();
    if (rules.excludeKeywords.some(k => searchText.includes(k.toLowerCase()))) {
      return { score: 0, matchedOn: [] };
    }
  }

  if (rules.excludeRegions && wine.region) {
    if (rules.excludeRegions.some(r => 
      wine.region.toLowerCase().includes(r.toLowerCase())
    )) {
      return { score: 0, matchedOn: [] };
    }
  }

  if (rules.excludeWinemaking && wine.winemaking.length > 0) {
    if (rules.excludeWinemaking.some(wm =>
      wine.winemaking.some(wwm => wwm.toLowerCase().includes(wm.toLowerCase()))
    )) {
      return { score: 0, matchedOn: [] };
    }
  }

  // Calculate final score (0-100), capped
  const score = possiblePoints > 0 
    ? Math.min(100, Math.round((earnedPoints / possiblePoints) * 100))
    : 0;

  return { score, matchedOn };
}

/**
 * Calculate confidence based on score and alternatives
 */
function calculateConfidence(bestScore, allMatches) {
  if (bestScore >= 70) {
    // High score and clear winner
    if (allMatches.length === 1 || allMatches[1].score < bestScore - 20) {
      return 'high';
    }
    return 'medium';
  }
  if (bestScore >= 40) {
    return 'medium';
  }
  return 'low';
}

/**
 * Find an available slot for a wine in a zone
 * FIXED: Fallback chain when zone is full
 * @param {string} zoneId 
 * @param {Array} occupiedSlots - List of currently occupied slot IDs
 * @param {Object} wine - Wine object (for buffer zone color matching)
 * @returns {Object} - { slotId, zoneId, isOverflow, requiresSwap }
 */
export function findAvailableSlot(zoneId, occupiedSlots, wine = null) {
  const zone = CELLAR_ZONES.zones.find(z => z.id === zoneId);
  if (!zone) return null;

  // Try primary zone rows
  const slot = findSlotInRows(zone.rows, occupiedSlots);
  if (slot) {
    return { slotId: slot, zoneId, isOverflow: false, requiresSwap: false };
  }

  // Try overflow zone
  if (zone.overflowZoneId) {
    const overflowResult = findAvailableSlot(zone.overflowZoneId, occupiedSlots, wine);
    if (overflowResult) {
      return { ...overflowResult, isOverflow: true };
    }
  }

  // For buffer zones, search in preferred order
  if (zone.isBufferZone && zone.slotSearchOrder) {
    for (const row of zone.slotSearchOrder) {
      const bufferSlot = findSlotInRows([row], occupiedSlots);
      if (bufferSlot) {
        return { slotId: bufferSlot, zoneId, isOverflow: true, requiresSwap: false };
      }
    }
  }

  // Zone is full - return null (caller should handle swap suggestion)
  return null;
}

/**
 * Find first available slot in given rows
 * FIXED: Numeric sorting
 */
function findSlotInRows(rows, occupiedSlots) {
  // Sort rows numerically
  const sortedRows = [...rows].sort((a, b) => {
    const numA = parseInt(a.replace('R', ''));
    const numB = parseInt(b.replace('R', ''));
    return numA - numB;
  });

  for (const row of sortedRows) {
    for (let col = 1; col <= 9; col++) {
      const slotId = `${row}C${col}`;
      if (!occupiedSlots.includes(slotId)) {
        return slotId;
      }
    }
  }
  return null;
}

/**
 * Normalize wine attributes for matching
 */
function normalizeWineAttributes(wine) {
  return {
    name: wine.wine_name || wine.name || '',
    grapes: parseGrapes(wine),
    style: wine.style || '',
    color: wine.color || inferColor(wine),
    country: wine.country || '',
    region: wine.region || '',
    appellation: wine.appellation || '',
    winemaking: parseWinemaking(wine),
    sweetness: wine.sweetness || 'dry',
    vintage: wine.vintage
  };
}

function parseGrapes(wine) {
  if (wine.grapes) {
    return Array.isArray(wine.grapes) ? wine.grapes : JSON.parse(wine.grapes || '[]');
  }
  return extractGrapesFromText(wine);
}

function parseWinemaking(wine) {
  if (wine.winemaking) {
    return Array.isArray(wine.winemaking) ? wine.winemaking : JSON.parse(wine.winemaking || '[]');
  }
  return extractWinemakingFromText(wine);
}

function inferColor(wine) {
  const text = `${wine.wine_name || ''} ${wine.style || ''}`.toLowerCase();
  
  if (text.includes('rosé') || text.includes('rose') || text.includes('rosado')) return 'rosé';
  if (text.includes('sparkling') || text.includes('champagne') || text.includes('prosecco')) return 'sparkling';
  if (text.includes('port') || text.includes('sherry') || text.includes('madeira')) return 'fortified';
  
  // Check grape for color hint
  const whiteGrapes = ['chardonnay', 'sauvignon', 'riesling', 'chenin', 'pinot grigio', 'gewürz'];
  const redGrapes = ['cabernet', 'merlot', 'shiraz', 'syrah', 'pinot noir', 'tempranillo', 'sangiovese'];
  
  if (whiteGrapes.some(g => text.includes(g))) return 'white';
  if (redGrapes.some(g => text.includes(g))) return 'red';
  
  return null;
}

function extractGrapesFromText(wine) {
  const grapePatterns = [
    'sauvignon blanc', 'chenin blanc', 'chardonnay', 'riesling', 
    'gewürztraminer', 'gewurztraminer', 'viognier', 'malvasia', 'albariño',
    'cabernet sauvignon', 'merlot', 'pinot noir', 'shiraz', 'syrah',
    'tempranillo', 'garnacha', 'grenache', 'sangiovese', 'nebbiolo',
    'primitivo', 'negroamaro', 'corvina', 'barbera', 'dolcetto',
    'touriga nacional', 'saperavi', 'malbec', 'carmenere', 'pinotage'
  ];

  const text = `${wine.wine_name || ''} ${wine.style || ''}`.toLowerCase();
  return grapePatterns.filter(grape => text.includes(grape));
}

function extractWinemakingFromText(wine) {
  const wmPatterns = ['appassimento', 'ripasso', 'oak', 'unoaked', 'organic', 'biodynamic'];
  const text = `${wine.wine_name || ''} ${wine.style || ''}`.toLowerCase();
  return wmPatterns.filter(wm => text.includes(wm));
}
```

---

## 4. Analysis Engine (Fixed)

### 4.1 Create `src/services/cellarAnalysis.js`

```javascript
import { CELLAR_ZONES } from '../config/cellarZones.js';
import { findBestZone, findAvailableSlot } from './cellarPlacement.js';

/**
 * Analyse current cellar state and identify issues
 * @param {Array} wines - All wines with slot assignments
 * @returns {Object} - Analysis report
 */
export function analyseCellar(wines) {
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      totalBottles: wines.filter(w => w.slot_id).length,
      zonesUsed: 0,
      correctlyPlaced: 0,
      misplacedBottles: 0,
      overflowingZones: [],
      fragmentedZones: [],
      emptyZones: [],
      unclassifiedCount: 0
    },
    zoneAnalysis: [],
    misplacedWines: [],
    suggestedMoves: [],
    alerts: []
  };

  // Build slot -> wine lookup
  const slotToWine = new Map();
  wines.forEach(w => {
    if (w.slot_id) slotToWine.set(w.slot_id, w);
  });

  // Analyse each physical zone (skip buffer/fallback)
  for (const zone of CELLAR_ZONES.zones) {
    if (zone.isBufferZone || zone.isFallbackZone || zone.isCuratedZone) continue;
    if (zone.rows.length === 0) continue;
    
    const zoneWines = getWinesInZone(zone, slotToWine);
    const analysis = analyseZone(zone, zoneWines, wines);
    report.zoneAnalysis.push(analysis);

    // Update summary
    if (analysis.misplaced.length > 0) {
      report.misplacedWines.push(...analysis.misplaced);
      report.summary.misplacedBottles += analysis.misplaced.length;
    }
    report.summary.correctlyPlaced += analysis.correctlyPlaced.length;

    if (analysis.isOverflowing) {
      report.summary.overflowingZones.push(zone.displayName);
    }
    if (analysis.fragmentationScore > 40) {
      report.summary.fragmentedZones.push(zone.displayName);
    }
    if (zoneWines.length === 0) {
      report.summary.emptyZones.push(zone.displayName);
    } else {
      report.summary.zonesUsed++;
    }
  }

  // Check for unclassified wines
  const unclassified = wines.filter(w => w.zone_id === 'unclassified');
  report.summary.unclassifiedCount = unclassified.length;
  if (unclassified.length > 0) {
    report.alerts.push({
      type: 'unclassified_wines',
      severity: 'warning',
      message: `${unclassified.length} wine(s) are unclassified and need manual review`,
      wines: unclassified.map(w => ({ id: w.id, name: w.wine_name }))
    });
  }

  // Generate move suggestions with fallback chain
  report.suggestedMoves = generateMoveSuggestions(report.misplacedWines, wines, slotToWine);

  return report;
}

/**
 * Get all wines physically located in a zone's rows
 */
function getWinesInZone(zone, slotToWine) {
  const wines = [];
  for (const row of zone.rows) {
    for (let col = 1; col <= 9; col++) {
      const slotId = `${row}C${col}`;
      const wine = slotToWine.get(slotId);
      if (wine) wines.push(wine);
    }
  }
  return wines;
}

/**
 * Analyse a single zone
 */
function analyseZone(zone, zoneWines, allWines) {
  const analysis = {
    zoneId: zone.id,
    displayName: zone.displayName,
    rows: zone.rows,
    capacity: zone.capacity,
    currentCount: zoneWines.length,
    utilizationPercent: Math.round((zoneWines.length / zone.capacity) * 100),
    isOverflowing: zoneWines.length > zone.capacity,
    correctlyPlaced: [],
    misplaced: [],
    fragmentationScore: 0
  };

  // Check each wine in the zone
  for (const wine of zoneWines) {
    const bestZone = findBestZone(wine);
    
    if (bestZone.zoneId === zone.id || 
        (zone.isOverflowZone && bestZone.zoneId === zone.parentZoneId)) {
      analysis.correctlyPlaced.push({
        wineId: wine.id,
        name: wine.wine_name,
        slot: wine.slot_id,
        confidence: bestZone.confidence
      });
    } else {
      analysis.misplaced.push({
        wineId: wine.id,
        name: wine.wine_name,
        currentSlot: wine.slot_id,
        currentZone: zone.displayName,
        suggestedZone: bestZone.displayName,
        suggestedZoneId: bestZone.zoneId,
        confidence: bestZone.confidence,
        score: bestZone.score,
        reason: bestZone.reason,
        alternatives: bestZone.alternativeZones
      });
    }
  }

  // Calculate fragmentation
  analysis.fragmentationScore = calculateFragmentation(zone.rows, zoneWines);

  return analysis;
}

/**
 * Calculate fragmentation score (0-100, lower is better)
 * FIXED: Numeric sorting of slots
 */
function calculateFragmentation(rows, wines) {
  if (wines.length <= 1) return 0;

  // Parse and sort slots numerically
  const slots = wines
    .map(w => parseSlot(w.slot_id))
    .filter(s => s !== null)
    .sort((a, b) => {
      if (a.row !== b.row) return a.row - b.row;
      return a.col - b.col;
    });

  if (slots.length <= 1) return 0;

  let gaps = 0;
  for (let i = 1; i < slots.length; i++) {
    const prev = slots[i - 1];
    const curr = slots[i];

    if (prev.row === curr.row) {
      gaps += (curr.col - prev.col - 1);
    } else {
      // Different rows - count remaining slots in prev row + leading slots in curr row
      gaps += (9 - prev.col) + (curr.col - 1);
    }
  }

  const maxPossibleGaps = (rows.length * 9) - wines.length;
  return maxPossibleGaps > 0 ? Math.round((gaps / maxPossibleGaps) * 100) : 0;
}

/**
 * Parse slot ID to numeric row/col
 * FIXED: Returns numeric values
 */
function parseSlot(slotId) {
  if (!slotId) return null;
  const match = slotId.match(/R(\d+)C(\d+)/);
  return match ? { row: parseInt(match[1], 10), col: parseInt(match[2], 10) } : null;
}

/**
 * Generate move suggestions with fallback chain
 * FIXED: Handles full zones with swap proposals
 */
function generateMoveSuggestions(misplacedWines, allWines, slotToWine) {
  const occupiedSlots = new Set(allWines.map(w => w.slot_id).filter(Boolean));
  const suggestions = [];
  const pendingMoves = new Map(); // Track planned moves

  // Sort by confidence (high confidence moves first)
  const sortedMisplaced = [...misplacedWines].sort((a, b) => {
    const confOrder = { high: 0, medium: 1, low: 2 };
    return (confOrder[a.confidence] || 2) - (confOrder[b.confidence] || 2);
  });

  for (const wine of sortedMisplaced) {
    // Calculate currently available slots (accounting for pending moves)
    const currentlyOccupied = new Set(occupiedSlots);
    pendingMoves.forEach((toSlot, fromSlot) => {
      currentlyOccupied.delete(fromSlot);
      currentlyOccupied.add(toSlot);
    });

    // Try to find slot in target zone
    const slot = findAvailableSlot(
      wine.suggestedZoneId, 
      Array.from(currentlyOccupied),
      wine
    );

    if (slot) {
      suggestions.push({
        type: 'move',
        wineId: wine.wineId,
        wineName: wine.name,
        from: wine.currentSlot,
        to: slot.slotId,
        toZone: wine.suggestedZone,
        reason: wine.reason,
        confidence: wine.confidence,
        isOverflow: slot.isOverflow,
        priority: wine.confidence === 'high' ? 1 : wine.confidence === 'medium' ? 2 : 3
      });
      
      pendingMoves.set(wine.currentSlot, slot.slotId);
    } else {
      // Zone is full - suggest swap if there's a lower-confidence wine there
      const swapCandidate = findSwapCandidate(wine, allWines, currentlyOccupied);
      
      if (swapCandidate) {
        suggestions.push({
          type: 'swap',
          wineId: wine.wineId,
          wineName: wine.name,
          from: wine.currentSlot,
          to: swapCandidate.slot,
          swapWith: {
            wineId: swapCandidate.wine.id,
            wineName: swapCandidate.wine.wine_name
          },
          toZone: wine.suggestedZone,
          reason: `${wine.reason} (swap with lower-confidence placement)`,
          confidence: wine.confidence,
          priority: 2
        });
      } else {
        // No solution found
        suggestions.push({
          type: 'manual',
          wineId: wine.wineId,
          wineName: wine.name,
          currentSlot: wine.currentSlot,
          suggestedZone: wine.suggestedZone,
          reason: `${wine.reason} - zone full, manual intervention needed`,
          confidence: wine.confidence,
          priority: 3
        });
      }
    }
  }

  return suggestions.sort((a, b) => a.priority - b.priority);
}

/**
 * Find a wine in the target zone that could be swapped out
 */
function findSwapCandidate(targetWine, allWines, occupiedSlots) {
  const targetZone = CELLAR_ZONES.zones.find(z => z.id === targetWine.suggestedZoneId);
  if (!targetZone || targetZone.rows.length === 0) return null;

  // Find wines currently in target zone with lower confidence
  const winesInTargetZone = allWines.filter(w => {
    if (!w.slot_id) return false;
    const slot = parseSlot(w.slot_id);
    if (!slot) return false;
    const row = `R${slot.row}`;
    return targetZone.rows.includes(row);
  });

  // Find one that doesn't really belong there
  for (const candidate of winesInTargetZone) {
    const bestZone = findBestZone(candidate);
    if (bestZone.zoneId !== targetZone.id && bestZone.confidence !== 'high') {
      return {
        wine: candidate,
        slot: candidate.slot_id,
        betterZone: bestZone
      };
    }
  }

  return null;
}
```

---

## 5. AI Integration (With Guardrails)

### 5.1 JSON Schema for AI Response

```javascript
// src/schemas/cellarAdviceSchema.js
import { z } from 'zod';

export const CellarAdviceSchema = z.object({
  confirmedMoves: z.array(z.object({
    wineId: z.number(),
    from: z.string(),
    to: z.string()
  })),
  modifiedMoves: z.array(z.object({
    wineId: z.number(),
    from: z.string(),
    to: z.string(),
    reason: z.string()
  })),
  rejectedMoves: z.array(z.object({
    wineId: z.number(),
    reason: z.string()
  })),
  ambiguousWines: z.array(z.object({
    wineId: z.number(),
    name: z.string(),
    options: z.array(z.string()),
    recommendation: z.string()
  })),
  zoneAdjustments: z.array(z.object({
    zoneId: z.string(),
    suggestion: z.string()
  })),
  fridgeCandidates: z.array(z.object({
    wineId: z.number(),
    name: z.string(),
    reason: z.string()
  })),
  summary: z.string()
});

export type CellarAdvice = z.infer<typeof CellarAdviceSchema>;
```

### 5.2 AI Service with Validation

```javascript
// src/services/cellarAI.js
import Anthropic from '@anthropic-ai/sdk';
import { CellarAdviceSchema } from '../schemas/cellarAdviceSchema.js';
import { escapeHtml } from '../utils/sanitize.js';

const anthropic = new Anthropic();

/**
 * Get AI recommendations for cellar organisation
 * @param {Object} analysisReport - Output from analyseCellar()
 * @returns {Object} - Validated AI recommendations
 */
export async function getCellarOrganisationAdvice(analysisReport) {
  const prompt = buildCellarAdvicePrompt(analysisReport);
  
  let attempts = 0;
  const maxAttempts = 2;
  
  while (attempts < maxAttempts) {
    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }]
      });

      const text = response.content[0].text;
      
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || 
                        text.match(/\{[\s\S]*\}/);
      
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const jsonStr = jsonMatch[1] || jsonMatch[0];
      const parsed = JSON.parse(jsonStr);
      
      // Validate against schema
      const validated = CellarAdviceSchema.parse(parsed);
      
      return {
        success: true,
        advice: validated,
        raw: text
      };
      
    } catch (err) {
      attempts++;
      if (attempts >= maxAttempts) {
        return {
          success: false,
          error: `Failed to get valid AI response: ${err.message}`,
          fallback: generateFallbackAdvice(analysisReport)
        };
      }
      // Retry with more explicit instruction
      prompt = prompt + '\n\nIMPORTANT: Respond with valid JSON only, no additional text.';
    }
  }
}

function buildCellarAdvicePrompt(report) {
  // Sanitize wine names to prevent prompt injection
  const sanitizedMisplaced = report.misplacedWines.slice(0, 15).map(w => ({
    ...w,
    name: escapeHtml(w.name).substring(0, 100)
  }));

  return `You are a sommelier reviewing a wine cellar organisation report.

## Current State
- Total bottles: ${report.summary.totalBottles}
- Correctly placed: ${report.summary.correctlyPlaced}
- Misplaced: ${report.summary.misplacedBottles}
- Overflowing zones: ${report.summary.overflowingZones.join(', ') || 'None'}
- Fragmented zones: ${report.summary.fragmentedZones.join(', ') || 'None'}
- Unclassified: ${report.summary.unclassifiedCount}

## Misplaced Wines (Top 15)
${sanitizedMisplaced.map(w => 
  `- ID:${w.wineId} "${w.name}" in ${w.currentZone} → suggested: ${w.suggestedZone} (${w.confidence})`
).join('\n')}

## System-Generated Moves
${report.suggestedMoves.slice(0, 15).map(m => 
  `- ${m.type.toUpperCase()}: ID:${m.wineId} "${escapeHtml(m.wineName).substring(0, 50)}" ${m.from} → ${m.to || 'manual'}`
).join('\n')}

## Your Task
1. Review suggested moves - confirm, modify, or reject each
2. Flag ambiguous wines that could fit multiple categories
3. Suggest zone adjustments if patterns have shifted
4. Identify wines to move to fridge (drink soon based on age/type)

Respond ONLY with valid JSON matching this structure:
{
  "confirmedMoves": [{ "wineId": number, "from": "slot", "to": "slot" }],
  "modifiedMoves": [{ "wineId": number, "from": "slot", "to": "slot", "reason": "string" }],
  "rejectedMoves": [{ "wineId": number, "reason": "string" }],
  "ambiguousWines": [{ "wineId": number, "name": "string", "options": ["zone1", "zone2"], "recommendation": "string" }],
  "zoneAdjustments": [{ "zoneId": "string", "suggestion": "string" }],
  "fridgeCandidates": [{ "wineId": number, "name": "string", "reason": "string" }],
  "summary": "Brief overall assessment"
}`;
}

function generateFallbackAdvice(report) {
  return {
    confirmedMoves: report.suggestedMoves
      .filter(m => m.type === 'move' && m.confidence === 'high')
      .map(m => ({ wineId: m.wineId, from: m.from, to: m.to })),
    modifiedMoves: [],
    rejectedMoves: [],
    ambiguousWines: report.suggestedMoves
      .filter(m => m.confidence === 'low')
      .map(m => ({ 
        wineId: m.wineId, 
        name: m.wineName, 
        options: [m.toZone, 'unclassified'],
        recommendation: 'Manual review recommended'
      })),
    zoneAdjustments: [],
    fridgeCandidates: [],
    summary: 'AI analysis unavailable - showing system suggestions only'
  };
}
```

### 5.3 Sanitization Utility

```javascript
// src/utils/sanitize.js

/**
 * Escape HTML entities to prevent XSS
 */
export function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Sanitize for safe DOM insertion
 */
export function sanitizeForDom(str) {
  return escapeHtml(str).substring(0, 200);
}
```

---

## 6. Trigger Thresholds

### 6.1 Configuration

```javascript
// src/config/cellarThresholds.js

export const REORG_THRESHOLDS = {
  // Don't suggest reorganisation unless:
  minMisplacedForReorg: 5,              // At least 5 misplaced bottles
  minMisplacedPercent: 10,              // OR 10% of cellar
  minFragmentationScore: 40,            // Fragmentation above 40%
  minZoneUtilizationForFragCheck: 30,   // Only check fragmentation if zone >30% full
  
  // Overflow alerts
  overflowAlertAfterDays: 3,            // Alert if overflow persists 3+ days
  overflowAlertAfterBottles: 5,         // OR if 5+ bottles in overflow
  
  // AI review triggers
  triggerAIReviewAfter: {
    misplacedCount: 8,
    overflowingZones: 2,
    unclassifiedCount: 3
  },
  
  // Frequency limits
  maxReorgSuggestionsPerWeek: 2,        // Don't nag more than twice/week
  minDaysBetweenFullAnalysis: 3         // Full analysis at most every 3 days
};

export const NOTIFICATION_SEVERITY = {
  unclassified_wine: 'info',            // Single unclassified wine
  zone_overflow: 'warning',             // Zone at capacity
  fragmentation_high: 'info',           // High fragmentation (optional fix)
  reorg_recommended: 'action',          // Reorganisation beneficial
  fridge_candidate: 'info'              // Wine ready to drink
};
```

### 6.2 Trigger Service

```javascript
// src/services/cellarTriggers.js

import { REORG_THRESHOLDS } from '../config/cellarThresholds.js';
import { analyseCellar } from './cellarAnalysis.js';
import { getCellarOrganisationAdvice } from './cellarAI.js';
import { getLastAnalysisDate, saveAnalysisDate, getReorgCountThisWeek } from './cellarState.js';

/**
 * Evaluate whether reorganisation should be suggested
 * @param {Object} report - Analysis report
 * @returns {Object} - { shouldSuggest, reasons, severity }
 */
export function evaluateReorgNeed(report) {
  const reasons = [];
  let severity = 'none';
  
  const { summary } = report;
  const totalBottles = summary.totalBottles || 1;
  const misplacedPercent = (summary.misplacedBottles / totalBottles) * 100;

  // Check misplaced threshold
  if (summary.misplacedBottles >= REORG_THRESHOLDS.minMisplacedForReorg ||
      misplacedPercent >= REORG_THRESHOLDS.minMisplacedPercent) {
    reasons.push(`${summary.misplacedBottles} misplaced bottles (${misplacedPercent.toFixed(1)}%)`);
    severity = 'action';
  }

  // Check overflow
  if (summary.overflowingZones.length >= REORG_THRESHOLDS.triggerAIReviewAfter.overflowingZones) {
    reasons.push(`${summary.overflowingZones.length} zones overflowing`);
    severity = severity === 'none' ? 'warning' : severity;
  }

  // Check unclassified
  if (summary.unclassifiedCount >= REORG_THRESHOLDS.triggerAIReviewAfter.unclassifiedCount) {
    reasons.push(`${summary.unclassifiedCount} unclassified wines need review`);
    severity = severity === 'none' ? 'warning' : severity;
  }

  // Check fragmentation (only for well-utilized zones)
  const fragmentedAndBusy = report.zoneAnalysis.filter(z => 
    z.fragmentationScore >= REORG_THRESHOLDS.minFragmentationScore &&
    z.utilizationPercent >= REORG_THRESHOLDS.minZoneUtilizationForFragCheck
  );
  if (fragmentedAndBusy.length > 0) {
    reasons.push(`${fragmentedAndBusy.length} zone(s) fragmented`);
  }

  // Check frequency limits
  const reorgCountThisWeek = getReorgCountThisWeek();
  if (reorgCountThisWeek >= REORG_THRESHOLDS.maxReorgSuggestionsPerWeek) {
    return {
      shouldSuggest: false,
      reasons: ['Weekly suggestion limit reached'],
      severity: 'none',
      suppressed: true
    };
  }

  return {
    shouldSuggest: reasons.length > 0 && severity !== 'none',
    reasons,
    severity,
    suppressed: false
  };
}

/**
 * Handle wine added event
 */
export async function onWineAdded(wine, placement) {
  const notifications = [];

  // Alert if placed in unclassified
  if (placement.zoneId === 'unclassified') {
    notifications.push({
      type: 'unclassified_wine',
      severity: 'info',
      title: 'Wine needs classification',
      message: `"${wine.wine_name}" couldn't be auto-classified. Please review.`,
      wineId: wine.id,
      actions: ['classify', 'dismiss']
    });
  }

  // Alert if low confidence
  if (placement.confidence === 'low' && placement.zoneId !== 'unclassified') {
    notifications.push({
      type: 'low_confidence_placement',
      severity: 'info',
      title: 'Placement needs review',
      message: `"${wine.wine_name}" placed in ${placement.displayName} with low confidence.`,
      wineId: wine.id,
      alternatives: placement.alternativeZones,
      actions: ['confirm', 'change', 'dismiss']
    });
  }

  // Check if this addition triggers zone overflow
  if (placement.isOverflow) {
    notifications.push({
      type: 'zone_overflow',
      severity: 'warning',
      title: `${placement.displayName} overflow`,
      message: `Primary zone full. Wine placed in overflow area.`,
      wineId: wine.id,
      actions: ['reorganise', 'dismiss']
    });
  }

  return notifications;
}

/**
 * Handle wine removed event
 */
export async function onWineRemoved(wineId, slot) {
  // Quick fragmentation check for affected zone
  const zone = getZoneForSlot(slot);
  if (!zone) return [];

  const wines = await getWinesInZone(zone.id);
  const fragScore = calculateQuickFragmentation(zone, wines);

  if (fragScore > REORG_THRESHOLDS.minFragmentationScore) {
    return [{
      type: 'fragmentation_high',
      severity: 'info',
      title: 'Consolidation opportunity',
      message: `${zone.displayName} has gaps that could be consolidated.`,
      zoneId: zone.id,
      actions: ['consolidate', 'dismiss']
    }];
  }

  return [];
}

/**
 * Scheduled analysis (run daily or weekly)
 */
export async function scheduledAnalysis() {
  const lastAnalysis = getLastAnalysisDate();
  const daysSince = (Date.now() - lastAnalysis) / (1000 * 60 * 60 * 24);

  if (daysSince < REORG_THRESHOLDS.minDaysBetweenFullAnalysis) {
    return { skipped: true, reason: 'Too soon since last analysis' };
  }

  const wines = await getAllWines();
  const report = analyseCellar(wines);
  const reorgNeed = evaluateReorgNeed(report);

  if (reorgNeed.shouldSuggest) {
    // Get AI recommendations
    const aiResult = await getCellarOrganisationAdvice(report);
    
    saveAnalysisDate(Date.now());
    
    return {
      skipped: false,
      report,
      aiAdvice: aiResult.success ? aiResult.advice : aiResult.fallback,
      notification: {
        type: 'reorg_recommended',
        severity: reorgNeed.severity,
        title: 'Cellar reorganisation recommended',
        message: reorgNeed.reasons.join('; '),
        actions: ['review', 'dismiss']
      }
    };
  }

  saveAnalysisDate(Date.now());
  return { skipped: false, report, notification: null };
}
```

---

## 7. UI Components (XSS-Safe)

### 7.1 Safe DOM Builder

```javascript
// public/js/domBuilder.js

/**
 * Create element with safe text content
 */
export function createElement(tag, options = {}) {
  const el = document.createElement(tag);
  
  if (options.className) el.className = options.className;
  if (options.id) el.id = options.id;
  if (options.textContent) el.textContent = options.textContent; // Safe
  if (options.dataset) {
    Object.entries(options.dataset).forEach(([k, v]) => {
      el.dataset[k] = v;
    });
  }
  if (options.children) {
    options.children.forEach(child => el.appendChild(child));
  }
  
  return el;
}

/**
 * Create button with event listener (no inline handlers)
 */
export function createButton(text, onClick, className = '') {
  const btn = createElement('button', { 
    textContent: text, 
    className 
  });
  btn.addEventListener('click', onClick);
  return btn;
}

/**
 * Create move suggestion card (safe)
 */
export function createMoveSuggestionCard(move, onAccept, onReject) {
  const card = createElement('div', { className: 'move-card' });
  
  const title = createElement('div', { 
    className: 'move-title',
    textContent: move.wineName // Safe - textContent escapes
  });
  
  const detail = createElement('div', {
    className: 'move-detail',
    textContent: `${move.from} → ${move.to}`
  });
  
  const reason = createElement('div', {
    className: 'move-reason',
    textContent: move.reason
  });
  
  const actions = createElement('div', { className: 'move-actions' });
  actions.appendChild(createButton('Accept', () => onAccept(move), 'btn-accept'));
  actions.appendChild(createButton('Reject', () => onReject(move), 'btn-reject'));
  
  card.appendChild(title);
  card.appendChild(detail);
  card.appendChild(reason);
  card.appendChild(actions);
  
  return card;
}
```

### 7.2 Analysis Dashboard (Safe)

```javascript
// public/js/cellarDashboard.js

import { createElement, createButton, createMoveSuggestionCard } from './domBuilder.js';

export async function renderAnalysisDashboard(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  // Clear safely
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }

  // Show loading
  container.appendChild(createElement('div', { 
    className: 'loading', 
    textContent: 'Analysing cellar...' 
  }));

  try {
    const response = await fetch('/api/cellar/analyse/ai');
    const { report, aiAdvice } = await response.json();
    
    // Clear loading
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    // Summary section
    const summary = createElement('div', { className: 'analysis-summary' });
    summary.appendChild(createElement('h2', { textContent: 'Cellar Analysis' }));
    
    const stats = createElement('div', { className: 'stats-grid' });
    stats.appendChild(createStatCard('Total', report.summary.totalBottles));
    stats.appendChild(createStatCard('Correct', report.summary.correctlyPlaced, 'good'));
    stats.appendChild(createStatCard('Misplaced', report.summary.misplacedBottles, 
      report.summary.misplacedBottles > 5 ? 'warning' : ''));
    stats.appendChild(createStatCard('Unclassified', report.summary.unclassifiedCount,
      report.summary.unclassifiedCount > 0 ? 'warning' : ''));
    
    summary.appendChild(stats);
    container.appendChild(summary);

    // AI Summary
    if (aiAdvice?.summary) {
      const aiSection = createElement('div', { className: 'ai-summary' });
      aiSection.appendChild(createElement('h3', { textContent: 'AI Assessment' }));
      aiSection.appendChild(createElement('p', { textContent: aiAdvice.summary }));
      container.appendChild(aiSection);
    }

    // Suggested moves
    if (aiAdvice?.confirmedMoves?.length > 0) {
      const movesSection = createElement('div', { className: 'moves-section' });
      movesSection.appendChild(createElement('h3', { 
        textContent: `Suggested Moves (${aiAdvice.confirmedMoves.length})` 
      }));
      
      const movesList = createElement('div', { className: 'moves-list' });
      
      // Merge with full move data
      const fullMoves = aiAdvice.confirmedMoves.map(cm => {
        const full = report.suggestedMoves.find(m => m.wineId === cm.wineId);
        return { ...cm, ...full };
      });
      
      fullMoves.forEach(move => {
        movesList.appendChild(createMoveSuggestionCard(
          move,
          (m) => executeMove(m),
          (m) => rejectMove(m)
        ));
      });
      
      movesSection.appendChild(movesList);
      
      // Execute all button
      movesSection.appendChild(createButton(
        'Execute All Confirmed Moves',
        () => executeAllMoves(aiAdvice.confirmedMoves),
        'btn-primary'
      ));
      
      container.appendChild(movesSection);
    }

    // Fridge candidates
    if (aiAdvice?.fridgeCandidates?.length > 0) {
      const fridgeSection = createElement('div', { className: 'fridge-section' });
      fridgeSection.appendChild(createElement('h3', { textContent: 'Consider Moving to Fridge' }));
      
      const list = createElement('ul', { className: 'fridge-list' });
      aiAdvice.fridgeCandidates.forEach(wine => {
        const item = createElement('li');
        item.appendChild(createElement('strong', { textContent: wine.name }));
        item.appendChild(createElement('span', { textContent: ` - ${wine.reason}` }));
        list.appendChild(item);
      });
      
      fridgeSection.appendChild(list);
      container.appendChild(fridgeSection);
    }

  } catch (err) {
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
    container.appendChild(createElement('div', {
      className: 'error',
      textContent: `Analysis failed: ${err.message}`
    }));
  }
}

function createStatCard(label, value, modifier = '') {
  const card = createElement('div', { 
    className: `stat-card ${modifier}` 
  });
  card.appendChild(createElement('div', { 
    className: 'stat-value', 
    textContent: String(value) 
  }));
  card.appendChild(createElement('div', { 
    className: 'stat-label', 
    textContent: label 
  }));
  return card;
}

async function executeMove(move) {
  const response = await fetch('/api/cellar/execute-moves', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ moves: [{ wineId: move.wineId, toSlot: move.to }] })
  });
  
  if (response.ok) {
    showToast(`Moved "${move.wineName}" to ${move.to}`);
    // Refresh dashboard
    renderAnalysisDashboard('analysis-container');
  }
}

async function executeAllMoves(moves) {
  const response = await fetch('/api/cellar/execute-moves', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      moves: moves.map(m => ({ wineId: m.wineId, toSlot: m.to }))
    })
  });
  
  if (response.ok) {
    showToast(`Executed ${moves.length} moves`);
    renderAnalysisDashboard('analysis-container');
  }
}

function rejectMove(move) {
  // Mark as user-rejected (won't suggest again this session)
  sessionStorage.setItem(`rejected-move-${move.wineId}`, 'true');
  // Remove card from UI
  const cards = document.querySelectorAll('.move-card');
  cards.forEach(card => {
    if (card.querySelector('.move-title')?.textContent === move.wineName) {
      card.remove();
    }
  });
}
```

---

## 8. Testing Checklist

### Placement Tests
- [ ] Appassimento wine goes to Appassimento zone (not Primitivo)
- [ ] Rosé goes to Rosé & Sparkling
- [ ] Champagne goes to Rosé & Sparkling
- [ ] Georgian Saperavi goes to Curiosities
- [ ] Unknown variety goes to Unclassified with alert
- [ ] SA Cab (single varietal) goes to Cabernet, not SA Blends
- [ ] SA Cab-Merlot blend goes to SA Blends

### Overflow Tests
- [ ] Fill Sauvignon Blanc row → overflow to SB Overflow
- [ ] Fill SB Overflow → goes to White Buffer
- [ ] Fill White Buffer → goes to Unclassified with alert

### Scoring Tests
- [ ] Score never exceeds 100
- [ ] Exclusion rules disqualify correctly
- [ ] Color mismatch disqualifies

### Fragmentation Tests
- [ ] R10C1, R10C3, R10C9 → high fragmentation score
- [ ] R10C1, R10C2, R10C3 → low fragmentation score
- [ ] R2C1 sorts before R10C1 (numeric sort)

### AI Tests
- [ ] Invalid JSON → retry once, then fallback
- [ ] Wine name with `<script>` → safely escaped
- [ ] AI unavailable → fallback advice returned

### Threshold Tests
- [ ] 4 misplaced wines → no reorg suggestion
- [ ] 6 misplaced wines → reorg suggested
- [ ] 3rd suggestion in week → suppressed

---

## 9. Files to Create/Modify

| File | Action |
|------|--------|
| `src/config/cellarZones.js` | Create - zone definitions |
| `src/config/cellarThresholds.js` | Create - trigger thresholds |
| `src/schemas/cellarAdviceSchema.js` | Create - Zod schema |
| `src/services/cellarPlacement.js` | Create - placement algorithm |
| `src/services/cellarAnalysis.js` | Create - analysis engine |
| `src/services/cellarAI.js` | Create - AI integration |
| `src/services/cellarTriggers.js` | Create - event handlers |
| `src/utils/sanitize.js` | Create - XSS protection |
| `src/routes/cellar.js` | Create - API endpoints |
| `public/js/domBuilder.js` | Create - safe DOM helpers |
| `public/js/cellarDashboard.js` | Create - dashboard UI |
| `src/models/wine.js` | Modify - add canonical fields |
| `data/schema.sql` | Modify - add new columns |

---

## 10. Migration Notes

### Database Migration

```sql
-- Add canonical fields to wines table
ALTER TABLE wines ADD COLUMN color TEXT;
ALTER TABLE wines ADD COLUMN grapes TEXT; -- JSON array
ALTER TABLE wines ADD COLUMN appellation TEXT;
ALTER TABLE wines ADD COLUMN winemaking TEXT; -- JSON array
ALTER TABLE wines ADD COLUMN sweetness TEXT DEFAULT 'dry';
ALTER TABLE wines ADD COLUMN zone_id TEXT;
ALTER TABLE wines ADD COLUMN zone_confidence TEXT;

-- Backfill color from existing style data
UPDATE wines SET color = 'white' WHERE style LIKE '%white%' OR style LIKE '%blanc%';
UPDATE wines SET color = 'red' WHERE style LIKE '%red%' OR style LIKE '%rouge%';
UPDATE wines SET color = 'rosé' WHERE style LIKE '%ros%';
```
