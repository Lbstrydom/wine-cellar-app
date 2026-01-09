# Wine Detail Panel Specification v2

**Feature:** Consolidated Tasting Notes, Serving Temperature & Drinking Window  
**Version:** 2.0  
**Date:** 9 January 2026  
**Status:** Ready for implementation

---

## Executive Summary

This spec consolidates three related UI sections (tasting notes, serving temperature, drinking window) into a single "Tasting & Service" card. Key changes from v1:

1. **Structured tasting notes** replace italic prose - scannable bullets grouped by nose/palate/finish
2. **Trust indicators** - evidence strength, source provenance, contradiction handling
3. **Normalised vocabulary** - consistent British English terms mapped from synonyms
4. **Style fingerprint** - single-line summary for quick wine characterisation
5. **Stored as JSON** - structured data is source of truth; UI renders from it
6. **Edge case handling** - sparkling, fortified, orange wines have appropriate fields

---

## Table of Contents

1. [Current State & Problems](#1-current-state--problems)
2. [Proposed UI Layout](#2-proposed-ui-layout)
3. [Structured Tasting Notes Schema](#3-structured-tasting-notes-schema)
4. [Normalised Vocabulary](#4-normalised-vocabulary)
5. [Trust & Provenance](#5-trust--provenance)
6. [Serving Temperature Lookup](#6-serving-temperature-lookup)
7. [Drinking Window](#7-drinking-window)
8. [API Endpoints](#8-api-endpoints)
9. [Database Schema](#9-database-schema)
10. [Frontend Components](#10-frontend-components)
11. [Edge Cases](#11-edge-cases)
12. [Definition of Done](#12-definition-of-done)
13. [Implementation Order](#13-implementation-order)

---

## 1. Current State & Problems

### 1.1 Current UI

- Tasting notes: Italic text block, unstructured paragraph
- Serving temperature: Broken ("Could not load temperature")
- Drinking window: Separate card with redundant inline "Set window" form
- My Rating: Separate section

### 1.2 Problems

| Problem | Impact |
|---------|--------|
| Unstructured prose notes | Not scannable, can't compare wines |
| No source provenance | Users don't trust AI-generated text |
| No synonym normalisation | "lemongrass" vs "lemon grass" breaks comparisons |
| Contradictions hidden | Forces false confidence when sources disagree |
| Stored as rendered text | Can't re-render when vocabulary improves |
| Related info scattered | Poor information architecture |
| Redundant "Set window" form | Wastes vertical space |

---

## 2. Proposed UI Layout

### 2.1 Card Structure

```
┌─────────────────────────────────────────────────────────────────┐
│  TASTING & SERVICE                                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  STYLE FINGERPRINT                                              │
│  Off-dry, high-acid, aromatic white; citrus and tropical,       │
│  light to medium body.                                          │
│                                                                 │
│  ──────────────────────────────────────────────────────────────│
│                                                                 │
│  NOSE                                          Evidence: Strong │
│  • Citrus: grapefruit, lemon                   ●●●○○ 3 sources │
│  • Tropical: pineapple, mango                                   │
│  • Herbal: grass, boxwood                                       │
│                                                [Show more ▼]    │
│                                                                 │
│  PALATE                                                         │
│  Structure: Off-dry | High acid | Light-medium body             │
│  • Citrus: grapefruit, lemon zest                               │
│  • Tropical: pineapple, passion fruit                           │
│  • Stone fruit: peach                                           │
│                                                                 │
│  FINISH                                                         │
│  Medium length • citrus, mineral                                │
│                                                                 │
│                                         [Sources ▼] [Report ⚑] │
│                                                                 │
│  ──────────────────────────────────────────────────────────────│
│                                                                 │
│  ┌─────────────────────────┐  ┌─────────────────────────────┐  │
│  │ 🌡️ SERVE AT             │  │ 🍷 DRINK                     │  │
│  │                         │  │                             │  │
│  │   8-10°C                │  │   2023 - 2027               │  │
│  │   (46-50°F)             │  │   peak 2024                 │  │
│  │                         │  │                             │  │
│  │ via Sauvignon Blanc     │  │   ⚠️ 1 YEAR LEFT         [✎]│  │
│  │                         │  │   via colour_fallback       │  │
│  └─────────────────────────┘  └─────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Component Hierarchy

```
TastingServiceCard
├── StyleFingerprint          # One-line summary
├── Divider
├── TastingNotesSection
│   ├── NoseSection
│   │   ├── EvidenceIndicator
│   │   └── CategoryBullets (max 6 total, grouped)
│   ├── PalateSection
│   │   ├── StructureLine
│   │   └── CategoryBullets (max 6 total, grouped)
│   ├── FinishSection
│   │   └── LengthAndNotes (max 3 notes)
│   ├── ShowMoreToggle
│   ├── SourcesDrawer (collapsed)
│   └── ReportButton
├── Divider
└── InfoCardsRow
    ├── ServingTemperatureCard
    └── DrinkingWindowCard
```

### 2.3 Bullet Limits (Main View)

| Section | Max Bullets | Behaviour |
|---------|-------------|-----------|
| Nose | 6 total across all categories | Show top 6 by frequency/confidence |
| Palate flavours | 6 total across all categories | Show top 6 by frequency/confidence |
| Finish | 3 notes max | Plus length descriptor |

"Show more" expands within structured sections (not raw prose).

---

## 3. Structured Tasting Notes Schema

### 3.1 JSON Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "StructuredTastingNotes",
  "type": "object",
  "properties": {
    "version": {
      "type": "string",
      "description": "Schema version",
      "const": "2.0"
    },
    "normaliser_version": {
      "type": "string",
      "description": "Version of normaliser/LLM used"
    },
    "generated_at": {
      "type": "string",
      "format": "date-time"
    },
    "wine_type": {
      "type": "string",
      "enum": ["still_white", "still_red", "still_rosé", "orange", "sparkling", "fortified", "dessert"]
    },
    "vintage_specific": {
      "type": "boolean",
      "description": "True if notes are vintage-specific, false if general profile"
    },
    
    "style_fingerprint": {
      "type": "string",
      "maxLength": 120,
      "description": "Single-line style summary"
    },
    
    "structure": {
      "type": "object",
      "properties": {
        "sweetness": {
          "type": "string",
          "enum": ["bone-dry", "dry", "off-dry", "medium-sweet", "sweet", "luscious"]
        },
        "acidity": {
          "type": "string",
          "enum": ["low", "medium-minus", "medium", "medium-plus", "high", "bracing"]
        },
        "body": {
          "type": "string",
          "enum": ["light", "light-medium", "medium", "medium-full", "full"]
        },
        "tannin": {
          "type": ["string", "null"],
          "enum": ["none", "low", "medium-minus", "medium", "medium-plus", "high", "grippy", null],
          "description": "Null for whites without skin contact"
        },
        "alcohol": {
          "type": ["string", "null"],
          "enum": ["low", "medium", "high", "hot", null]
        },
        "mousse": {
          "type": ["string", "null"],
          "enum": ["delicate", "fine", "creamy", "persistent", null],
          "description": "Sparkling wines only"
        },
        "dosage": {
          "type": ["string", "null"],
          "enum": ["brut-nature", "extra-brut", "brut", "extra-dry", "dry", "demi-sec", "doux", null],
          "description": "Sparkling wines only"
        }
      }
    },
    
    "nose": {
      "type": "object",
      "properties": {
        "intensity": {
          "type": "string",
          "enum": ["light", "medium-minus", "medium", "medium-plus", "pronounced"]
        },
        "categories": {
          "type": "object",
          "additionalProperties": {
            "type": "array",
            "items": { "type": "string" },
            "description": "Normalised descriptors within category"
          }
        },
        "all_descriptors": {
          "type": "array",
          "items": { "type": "string" },
          "description": "Flat list for display, ordered by confidence"
        }
      }
    },
    
    "palate": {
      "type": "object",
      "properties": {
        "categories": {
          "type": "object",
          "additionalProperties": {
            "type": "array",
            "items": { "type": "string" }
          }
        },
        "all_descriptors": {
          "type": "array",
          "items": { "type": "string" }
        }
      }
    },
    
    "finish": {
      "type": "object",
      "properties": {
        "length": {
          "type": "string",
          "enum": ["short", "medium-minus", "medium", "medium-plus", "long", "very-long"]
        },
        "descriptors": {
          "type": "array",
          "items": { "type": "string" },
          "maxItems": 5
        }
      }
    },
    
    "evidence": {
      "type": "object",
      "properties": {
        "strength": {
          "type": "string",
          "enum": ["strong", "medium", "weak"],
          "description": "Based on source count and agreement"
        },
        "source_count": {
          "type": "integer"
        },
        "source_types": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": ["critic", "merchant", "community", "producer"]
          }
        },
        "agreement_score": {
          "type": "number",
          "minimum": 0,
          "maximum": 1,
          "description": "How much sources agree (1 = unanimous)"
        },
        "contradictions": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "field": { "type": "string" },
              "values_found": { "type": "array", "items": { "type": "string" } },
              "resolution": { "type": "string" }
            }
          }
        }
      }
    },
    
    "sources": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": { "type": "string" },
          "type": { "type": "string", "enum": ["critic", "merchant", "community", "producer"] },
          "url": { "type": "string", "format": "uri" },
          "snippet": { "type": "string", "maxLength": 300 },
          "retrieved_at": { "type": "string", "format": "date-time" }
        }
      }
    },
    
    "flags": {
      "type": "object",
      "properties": {
        "needs_review": { "type": "boolean" },
        "user_reported": { "type": "boolean" },
        "low_confidence": { "type": "boolean" },
        "vintage_unknown": { "type": "boolean" }
      }
    }
  },
  "required": ["version", "wine_type", "style_fingerprint", "structure", "evidence"]
}
```

### 3.2 Example: Aromatic White

```json
{
  "version": "2.0",
  "normaliser_version": "1.0.0",
  "generated_at": "2026-01-09T14:30:00Z",
  "wine_type": "still_white",
  "vintage_specific": true,
  
  "style_fingerprint": "Off-dry, high-acid, aromatic white; citrus and tropical, light to medium body.",
  
  "structure": {
    "sweetness": "off-dry",
    "acidity": "high",
    "body": "light-medium",
    "tannin": null,
    "alcohol": "medium"
  },
  
  "nose": {
    "intensity": "pronounced",
    "categories": {
      "citrus": ["grapefruit", "lemon"],
      "tropical": ["pineapple", "mango", "passion fruit"],
      "herbal": ["grass", "boxwood"],
      "floral": ["honeysuckle"]
    },
    "all_descriptors": ["grapefruit", "pineapple", "mango", "lemon", "grass", "boxwood"]
  },
  
  "palate": {
    "categories": {
      "citrus": ["grapefruit", "lemon zest"],
      "tropical": ["pineapple", "passion fruit"],
      "stone_fruit": ["peach"]
    },
    "all_descriptors": ["grapefruit", "pineapple", "lemon zest", "passion fruit", "peach"]
  },
  
  "finish": {
    "length": "medium",
    "descriptors": ["citrus", "mineral"]
  },
  
  "evidence": {
    "strength": "strong",
    "source_count": 3,
    "source_types": ["critic", "merchant", "community"],
    "agreement_score": 0.85,
    "contradictions": []
  },
  
  "sources": [
    {
      "name": "Decanter",
      "type": "critic",
      "url": "https://decanter.com/...",
      "snippet": "Explosive nose with citrus and tropical notes...",
      "retrieved_at": "2026-01-08T10:00:00Z"
    }
  ],
  
  "flags": {
    "needs_review": false,
    "user_reported": false,
    "low_confidence": false,
    "vintage_unknown": false
  }
}
```

### 3.3 Example: Sparkling Wine

```json
{
  "version": "2.0",
  "wine_type": "sparkling",
  "vintage_specific": false,
  
  "style_fingerprint": "Brut traditional-method sparkling; citrus, apple, brioche; fine persistent mousse.",
  
  "structure": {
    "sweetness": "dry",
    "acidity": "high",
    "body": "medium",
    "tannin": null,
    "alcohol": "medium",
    "mousse": "fine",
    "dosage": "brut"
  },
  
  "nose": {
    "intensity": "medium-plus",
    "categories": {
      "citrus": ["lemon", "grapefruit"],
      "orchard": ["green apple", "pear"],
      "autolytic": ["brioche", "toast", "almond"]
    },
    "all_descriptors": ["lemon", "green apple", "brioche", "toast", "pear", "almond"]
  }
}
```

### 3.4 Example: Red with Contradiction

```json
{
  "version": "2.0",
  "wine_type": "still_red",
  
  "structure": {
    "sweetness": "dry",
    "acidity": "medium-plus",
    "body": "medium-full",
    "tannin": "medium-plus"
  },
  
  "evidence": {
    "strength": "medium",
    "source_count": 4,
    "source_types": ["critic", "merchant"],
    "agreement_score": 0.65,
    "contradictions": [
      {
        "field": "body",
        "values_found": ["medium", "full"],
        "resolution": "Most sources suggest medium-full"
      }
    ]
  }
}
```

---

## 4. Normalised Vocabulary

### 4.1 Principles

1. **British English spelling** (colour, flavour, centre)
2. **Consistent terminology** - map synonyms to canonical terms
3. **Grouped categories** - related terms under parent categories
4. **Noise suppression** - filter food pairing terms, marketing hyperbole

### 4.2 Category Hierarchy

```yaml
citrus:
  canonical: [lemon, lime, grapefruit, orange, tangerine, citrus zest, citrus pith]
  synonyms:
    "lemon zest": "lemon"
    "lime zest": "lime"
    "orange peel": "orange"

tropical:
  canonical: [pineapple, mango, passion fruit, guava, papaya, lychee, banana]
  synonyms:
    "passionfruit": "passion fruit"
    "exotic fruit": "tropical fruit"

orchard:
  canonical: [apple, pear, quince]
  subtypes:
    apple: [green apple, red apple, baked apple, apple skin]
    pear: [ripe pear, pear drop, asian pear]

stone_fruit:
  canonical: [peach, apricot, nectarine, plum, cherry]
  subtypes:
    cherry: [red cherry, black cherry, sour cherry, cherry pit]
    plum: [red plum, black plum, damson, prune]

berry:
  canonical: [strawberry, raspberry, blackberry, blueberry, cranberry, redcurrant, blackcurrant, mulberry]
  synonyms:
    "red fruits": ["strawberry", "raspberry", "redcurrant"]
    "black fruits": ["blackberry", "blackcurrant", "blueberry"]
    "dark fruits": ["blackberry", "blackcurrant", "black plum"]

herbal:
  canonical: [grass, hay, herbs, mint, eucalyptus, dill, fennel, basil, thyme, rosemary, sage, lavender]
  synonyms:
    "cut grass": "grass"
    "fresh herbs": "herbs"
    "dried herbs": "herbs"
    "green herbs": "herbs"

vegetal:
  canonical: [bell pepper, asparagus, green bean, artichoke, olive, tomato leaf, capsicum]
  synonyms:
    "green pepper": "bell pepper"
    "pyrazine": "bell pepper"

floral:
  canonical: [rose, violet, jasmine, honeysuckle, elderflower, blossom, orange blossom, acacia]
  synonyms:
    "flowers": "floral"
    "perfumed": "floral"

earthy:
  canonical: [earth, mushroom, truffle, forest floor, wet leaves, undergrowth, beetroot]
  synonyms:
    "sous-bois": "forest floor"
    "damp earth": "earth"

mineral:
  canonical: [mineral, flint, chalk, slate, wet stone, graphite, gravel, saline]
  synonyms:
    "minerality": "mineral"
    "flinty": "flint"
    "chalky": "chalk"
    "stony": "wet stone"
    "salinity": "saline"

oak:
  canonical: [oak, vanilla, toast, cedar, coconut, smoke, char, coffee, chocolate, mocha]
  synonyms:
    "toasted": "toast"
    "smoky": "smoke"
    "charred": "char"
    "woody": "oak"

spice:
  canonical: [pepper, black pepper, white pepper, cinnamon, clove, nutmeg, anise, liquorice, ginger]
  synonyms:
    "spicy": "spice"
    "peppery": "pepper"
    "licorice": "liquorice"

autolytic:  # Sparkling/aged wines
  canonical: [brioche, bread, toast, biscuit, yeast, dough, almond]
  synonyms:
    "bready": "bread"
    "toasty": "toast"
    "nutty": "almond"

oxidative:  # Sherry, aged wines
  canonical: [almond, walnut, hazelnut, caramel, toffee, butterscotch, dried fruit, raisin, fig, date]

fortified:  # Port, Madeira
  canonical: [dried fruit, raisin, fig, date, prune, chocolate, coffee, caramel, toffee, molasses]
```

### 4.3 Noise Terms to Suppress

Filter these when they appear in context suggesting food pairing, not wine character:

```yaml
food_pairing_noise:
  - "cheese"
  - "cream"
  - "oil"
  - "butter" # Unless clearly describing texture
  - "fish"
  - "meat"
  - "shellfish"
  - "pairs with"
  - "serve with"
  - "complement"

marketing_hyperbole:
  - "explosive"
  - "amazing"
  - "incredible"
  - "stunning"
  - "exceptional"
  - "world-class"
  - "outstanding"
  - "superb"
  - "brilliant"
```

### 4.4 Normalisation Rules

```javascript
// src/services/vocabularyNormaliser.js

const VOCABULARY = require('./vocabulary.json');
const NOISE_TERMS = require('./noiseterms.json');

function normaliseDescriptor(descriptor, context = {}) {
  const term = descriptor.toLowerCase().trim();
  
  // Check noise suppression
  if (isNoiseTerm(term, context)) {
    return null;
  }
  
  // Check direct synonym mapping
  for (const [category, data] of Object.entries(VOCABULARY)) {
    if (data.synonyms && data.synonyms[term]) {
      return {
        canonical: data.synonyms[term],
        category: category
      };
    }
    if (data.canonical && data.canonical.includes(term)) {
      return {
        canonical: term,
        category: category
      };
    }
  }
  
  // Fuzzy matching for close variants
  const fuzzyMatch = findFuzzyMatch(term);
  if (fuzzyMatch) {
    return fuzzyMatch;
  }
  
  // Unknown term - flag for review
  return {
    canonical: term,
    category: 'other',
    flagged: true
  };
}

function isNoiseTerm(term, context) {
  // Check if term appears in noise lists
  if (NOISE_TERMS.food_pairing_noise.includes(term)) {
    // Check surrounding context for food pairing indicators
    if (context.surroundingText) {
      const text = context.surroundingText.toLowerCase();
      if (text.includes('pair') || text.includes('serve') || text.includes('match')) {
        return true;
      }
    }
    // If no context, be conservative - suppress
    return !context.surroundingText;
  }
  
  if (NOISE_TERMS.marketing_hyperbole.includes(term)) {
    return true;
  }
  
  return false;
}
```

---

## 5. Trust & Provenance

### 5.1 Evidence Strength Calculation

```javascript
function calculateEvidenceStrength(sources, agreement) {
  const sourceCount = sources.length;
  const hasMultipleTypes = new Set(sources.map(s => s.type)).size > 1;
  
  // Strong: 3+ sources, good agreement, multiple source types
  if (sourceCount >= 3 && agreement >= 0.7 && hasMultipleTypes) {
    return 'strong';
  }
  
  // Medium: 2+ sources with decent agreement OR 1 critic source
  if (sourceCount >= 2 && agreement >= 0.5) {
    return 'medium';
  }
  if (sourceCount === 1 && sources[0].type === 'critic') {
    return 'medium';
  }
  
  // Weak: single source, poor agreement, or community-only
  return 'weak';
}
```

### 5.2 Agreement Score Calculation

```javascript
function calculateAgreement(extractedNotes) {
  // Compare key structural elements across sources
  const sweetness = extractedNotes.map(n => n.structure?.sweetness).filter(Boolean);
  const acidity = extractedNotes.map(n => n.structure?.acidity).filter(Boolean);
  const body = extractedNotes.map(n => n.structure?.body).filter(Boolean);
  
  const scores = [];
  
  if (sweetness.length > 1) {
    scores.push(calculateFieldAgreement(sweetness));
  }
  if (acidity.length > 1) {
    scores.push(calculateFieldAgreement(acidity));
  }
  if (body.length > 1) {
    scores.push(calculateFieldAgreement(body));
  }
  
  // Average agreement across fields
  return scores.length > 0 
    ? scores.reduce((a, b) => a + b, 0) / scores.length 
    : 1; // No disagreement possible with single source
}

function calculateFieldAgreement(values) {
  const total = values.length;
  const mostCommon = mode(values);
  const agreeing = values.filter(v => v === mostCommon).length;
  return agreeing / total;
}
```

### 5.3 Contradiction Handling

```javascript
function detectContradictions(extractedNotes) {
  const contradictions = [];
  const fields = ['sweetness', 'body', 'tannin', 'acidity'];
  
  for (const field of fields) {
    const values = extractedNotes
      .map(n => n.structure?.[field])
      .filter(Boolean);
    
    if (values.length < 2) continue;
    
    const unique = [...new Set(values)];
    if (unique.length > 1) {
      // Check if values are adjacent on scale (minor disagreement) or distant (major)
      const isMinor = areAdjacentOnScale(unique, field);
      
      if (!isMinor) {
        contradictions.push({
          field: field,
          values_found: unique,
          resolution: generateResolution(unique, values)
        });
      }
    }
  }
  
  return contradictions;
}

function generateResolution(unique, values) {
  const mostCommon = mode(values);
  const count = values.filter(v => v === mostCommon).length;
  const total = values.length;
  
  if (count > total / 2) {
    return `Most sources suggest ${mostCommon}`;
  }
  return `Sources vary between ${unique.join(' and ')}`;
}
```

### 5.4 UI Display

**Evidence indicator (top right of notes section):**
```
Evidence: Strong
●●●○○ 3 sources
```

**Source type icons (tooltip shows details):**
```
🎖️ Critic  📦 Merchant  👥 Community  🏭 Producer
```

**Contradiction display (when present):**
```
⚠️ Sources vary on body (medium vs full)
```

---

## 6. Serving Temperature Lookup

### 6.1 Lookup Algorithm

Unchanged from v1 - 5-tier priority cascade:
1. Exact appellation match
2. Grape + style modifier
3. Grape only
4. Colour + body
5. Colour fallback

See v1 spec for full implementation.

### 6.2 UI Display

```
┌─────────────────────────┐
│ 🌡️ SERVE AT             │
│                         │
│   8-10°C                │
│   (46-50°F)             │
│                         │
│ via Sauvignon Blanc     │
└─────────────────────────┘
```

---

## 7. Drinking Window

### 7.1 Display Card

Unchanged from v1 - shows window, peak, urgency badge, source.

### 7.2 Edit Modal

Accessed via pencil icon. Allows manual override or revert to calculated default.

### 7.3 Urgency Badge Logic

| Condition | Badge | Colour |
|-----------|-------|--------|
| Past drink-by | PAST WINDOW | Red |
| ≤1 year remaining | 1 YEAR LEFT | Amber |
| ≤2 years remaining | 2 YEARS LEFT | Yellow |
| >2 years remaining | (none) | - |
| Before drink-from | HOLD UNTIL {year} | Blue |

---

## 8. API Endpoints

### 8.1 Get Structured Tasting Notes

```
GET /api/wines/:id/tasting-notes

Response:
{
  "success": true,
  "notes": {
    "version": "2.0",
    "style_fingerprint": "Off-dry, high-acid, aromatic white...",
    "structure": { ... },
    "nose": { ... },
    "palate": { ... },
    "finish": { ... },
    "evidence": { ... }
  },
  "sources": [ ... ]  // Only if ?include_sources=true
}
```

### 8.2 Regenerate Tasting Notes

```
POST /api/wines/:id/tasting-notes/regenerate

Request:
{
  "reason": "poor_quality" | "outdated" | "user_request"
}

Response:
{
  "success": true,
  "job_id": "abc123",
  "status": "queued"
}
```

### 8.3 Report Tasting Notes Issue

```
POST /api/wines/:id/tasting-notes/report

Request:
{
  "issue_type": "inaccurate" | "missing_info" | "wrong_wine" | "other",
  "details": "The sweetness is listed as dry but this wine is clearly off-dry"
}

Response:
{
  "success": true,
  "report_id": "xyz789"
}
```

### 8.4 Get Serving Temperature

```
GET /api/wines/:id/serving-temperature

Response:
{
  "success": true,
  "temperature": {
    "min_celsius": 8,
    "max_celsius": 10,
    "min_fahrenheit": 46,
    "max_fahrenheit": 50,
    "source": "grape",
    "match_type": "Sauvignon Blanc"
  }
}
```

### 8.5 Drinking Window Endpoints

```
GET  /api/wines/:id/drinking-window
PUT  /api/wines/:id/drinking-window
DELETE /api/wines/:id/drinking-window/override
```

---

## 9. Database Schema

### 9.1 Wines Table Additions

```sql
-- Structured tasting notes (JSON)
ALTER TABLE wines ADD COLUMN tasting_notes_structured JSON;
ALTER TABLE wines ADD COLUMN tasting_notes_version TEXT DEFAULT '2.0';
ALTER TABLE wines ADD COLUMN normaliser_version TEXT;
ALTER TABLE wines ADD COLUMN tasting_notes_generated_at DATETIME;

-- Legacy rendered text (keep for fallback/migration)
ALTER TABLE wines ADD COLUMN tasting_notes_rendered TEXT;

-- Flags
ALTER TABLE wines ADD COLUMN tasting_notes_needs_review BOOLEAN DEFAULT FALSE;
ALTER TABLE wines ADD COLUMN tasting_notes_user_reported BOOLEAN DEFAULT FALSE;

-- Serving temperature cache
ALTER TABLE wines ADD COLUMN serving_temp_min_c INTEGER;
ALTER TABLE wines ADD COLUMN serving_temp_max_c INTEGER;
ALTER TABLE wines ADD COLUMN serving_temp_source TEXT;

-- Drinking window (if not present)
ALTER TABLE wines ADD COLUMN drink_from INTEGER;
ALTER TABLE wines ADD COLUMN drink_by INTEGER;
ALTER TABLE wines ADD COLUMN drink_peak INTEGER;
ALTER TABLE wines ADD COLUMN drinking_window_source TEXT DEFAULT 'auto';
```

### 9.2 Tasting Note Sources Table

```sql
CREATE TABLE tasting_note_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wine_id INTEGER NOT NULL REFERENCES wines(id) ON DELETE CASCADE,
  source_name TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('critic', 'merchant', 'community', 'producer')),
  source_url TEXT,
  snippet TEXT,
  retrieved_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(wine_id, source_url)
);

CREATE INDEX idx_tns_wine_id ON tasting_note_sources(wine_id);
```

### 9.3 Tasting Note Reports Table

```sql
CREATE TABLE tasting_note_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wine_id INTEGER NOT NULL REFERENCES wines(id) ON DELETE CASCADE,
  issue_type TEXT NOT NULL,
  details TEXT,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'resolved', 'dismissed')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME
);
```

### 9.4 Serving Temperatures Table

```sql
CREATE TABLE wine_serving_temperatures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wine_type TEXT NOT NULL,
  category TEXT NOT NULL,
  subcategory TEXT,
  grape_varieties TEXT,
  regions TEXT,
  body TEXT,
  temp_min_celsius INTEGER NOT NULL,
  temp_max_celsius INTEGER NOT NULL,
  temp_min_fahrenheit INTEGER NOT NULL,
  temp_max_fahrenheit INTEGER NOT NULL,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_wst_wine_type ON wine_serving_temperatures(wine_type);
CREATE INDEX idx_wst_category ON wine_serving_temperatures(category);
CREATE INDEX idx_wst_grape ON wine_serving_temperatures(grape_varieties);
```

---

## 10. Frontend Components

### 10.1 Component Files

```
src/
  components/
    wine-detail/
      TastingServiceCard.js
      StyleFingerprint.js
      TastingNotesSection.js
      NoseSection.js
      PalateSection.js
      FinishSection.js
      EvidenceIndicator.js
      SourcesDrawer.js
      ReportButton.js
      ServingTemperatureCard.js
      DrinkingWindowCard.js
      DrinkingWindowModal.js
```

### 10.2 Key Component: TastingNotesSection

```javascript
// src/components/wine-detail/TastingNotesSection.js

export function TastingNotesSection({ notes }) {
  const [expanded, setExpanded] = useState(false);
  const [showSources, setShowSources] = useState(false);
  
  const noseDescriptors = expanded 
    ? notes.nose.all_descriptors 
    : notes.nose.all_descriptors.slice(0, 6);
  
  const palateDescriptors = expanded
    ? notes.palate.all_descriptors
    : notes.palate.all_descriptors.slice(0, 6);
  
  const finishDescriptors = expanded
    ? notes.finish.descriptors
    : notes.finish.descriptors.slice(0, 3);
  
  return (
    <div className="tasting-notes-section">
      <NoseSection 
        intensity={notes.nose.intensity}
        categories={notes.nose.categories}
        descriptors={noseDescriptors}
        evidence={notes.evidence}
      />
      
      <PalateSection
        structure={notes.structure}
        categories={notes.palate.categories}
        descriptors={palateDescriptors}
      />
      
      <FinishSection
        length={notes.finish.length}
        descriptors={finishDescriptors}
      />
      
      {hasMoreContent(notes, expanded) && (
        <button 
          className="show-more-toggle"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Show less ▲' : 'Show more ▼'}
        </button>
      )}
      
      <div className="notes-footer">
        <button 
          className="sources-toggle"
          onClick={() => setShowSources(!showSources)}
        >
          Sources {showSources ? '▲' : '▼'}
        </button>
        <ReportButton wineId={notes.wine_id} />
      </div>
      
      {showSources && (
        <SourcesDrawer sources={notes.sources} />
      )}
    </div>
  );
}
```

### 10.3 Structure Line Component

```javascript
// src/components/wine-detail/StructureLine.js

export function StructureLine({ structure, wineType }) {
  const elements = [];
  
  // Sweetness
  if (structure.sweetness) {
    elements.push(formatSweetness(structure.sweetness));
  }
  
  // Acidity
  if (structure.acidity) {
    elements.push(`${formatLevel(structure.acidity)} acid`);
  }
  
  // Body
  if (structure.body) {
    elements.push(`${structure.body} body`);
  }
  
  // Tannin (reds, orange wines)
  if (structure.tannin && ['still_red', 'orange'].includes(wineType)) {
    elements.push(`${formatLevel(structure.tannin)} tannin`);
  }
  
  // Mousse (sparkling)
  if (structure.mousse && wineType === 'sparkling') {
    elements.push(`${structure.mousse} mousse`);
  }
  
  return (
    <div className="structure-line">
      {elements.join(' | ')}
    </div>
  );
}
```

---

## 11. Edge Cases

### 11.1 Sparkling Wines

**Additional fields:**
- `mousse`: delicate | fine | creamy | persistent
- `dosage`: brut-nature | extra-brut | brut | extra-dry | dry | demi-sec | doux

**Structure line format:**
```
Brut | High acid | Medium body | Fine mousse
```

**Do not include:**
- Tannin (always null for sparkling)
- Standard finish length (replace with "persistent" for mousse quality)

### 11.2 Fortified Wines

**Additional considerations:**
- `alcohol`: Often "high" or "hot"
- May include oxidative notes (almond, caramel, dried fruit)
- Finish often described as "warming" or "long"

**Sherry-specific:**
- Biological vs oxidative ageing style
- Flor character for Fino/Manzanilla

**Port-specific:**
- Ruby vs Tawny character
- Vintage declaration

### 11.3 Orange/Skin-Contact Wines

**Key differences:**
- `tannin`: Can be present (low to medium typically)
- May have oxidative notes
- Phenolic grip separate from tannin

**Structure line:**
```
Dry | Medium acid | Medium body | Light tannin
```

### 11.4 Dessert Wines

**Key differences:**
- `sweetness`: Usually medium-sweet to luscious
- Botrytis character may be a category
- Residual sugar level may be noted

### 11.5 Vintage Unknown

When vintage is not available:
- Set `vintage_specific: false`
- Add to `style_fingerprint`: "General profile"
- Flag: `vintage_unknown: true`

**Display:**
```
STYLE FINGERPRINT
[General profile] Off-dry, high-acid, aromatic white...
```

---

## 12. Definition of Done

### 12.1 Tasting Notes v1 Checklist

| Requirement | Acceptance Criteria |
|-------------|---------------------|
| **Structured JSON** | All notes stored as JSON matching schema v2.0 |
| **Style fingerprint** | Max 120 characters, always present |
| **Vocabulary mapping** | All terms normalised to canonical vocabulary |
| **Bullet limits** | Nose ≤6, Palate ≤6, Finish ≤3 in collapsed view |
| **Evidence rating** | Every note has strength (strong/medium/weak) |
| **Source count** | Displayed with evidence indicator |
| **Source provenance** | Sources drawer shows name, type, snippet |
| **Contradiction handling** | Explicit when agreement < 0.5 on structural fields |
| **Noise suppression** | Food pairing and hyperbole terms filtered |
| **Wine type handling** | Correct fields shown per wine type (sparkling, fortified, etc.) |
| **Report workflow** | User can flag incorrect notes |
| **Regenerate workflow** | Admin can trigger re-generation |
| **Versioning** | `tasting_notes_version` and `normaliser_version` stored |

### 12.2 UI Sections in "Tasting & Service" Card

| Section | Required Elements |
|---------|-------------------|
| **Style Fingerprint** | One-line summary, max 120 chars |
| **Nose** | Intensity (optional), categorised bullets, max 6 |
| **Palate** | Structure line, categorised bullets, max 6 |
| **Finish** | Length descriptor, max 3 notes |
| **Evidence** | Strength indicator, source count |
| **Sources** | Collapsed drawer with snippets |
| **Report** | Flag button |
| **Serving Temp** | Celsius (Fahrenheit), source |
| **Drinking Window** | Years, peak, urgency badge, edit button |

### 12.3 Performance Targets

| Metric | Target |
|--------|--------|
| Card render time | < 100ms |
| Temperature lookup | < 50ms |
| Notes fetch (cached) | < 20ms |
| Notes regeneration | < 30s (background job) |

---

## 13. Implementation Order

### Phase 1: Database & Schema (1 day)
- [ ] Add columns to wines table
- [ ] Create tasting_note_sources table
- [ ] Create tasting_note_reports table
- [ ] Seed wine_serving_temperatures table
- [ ] Migration script for existing data

### Phase 2: Vocabulary Normaliser (2 days)
- [ ] Create vocabulary.json
- [ ] Create noiseterms.json
- [ ] Implement normaliseDescriptor()
- [ ] Unit tests for normalisation

### Phase 3: Tasting Notes Service (3 days)
- [ ] Implement structured note extraction
- [ ] Implement evidence calculation
- [ ] Implement contradiction detection
- [ ] Implement style fingerprint generation
- [ ] API endpoints
- [ ] Unit tests

### Phase 4: Serving Temperature Service (1 day)
- [ ] Implement 5-tier lookup
- [ ] API endpoint
- [ ] Unit tests

### Phase 5: Frontend Components (3 days)
- [ ] TastingServiceCard shell
- [ ] StyleFingerprint component
- [ ] TastingNotesSection + children
- [ ] EvidenceIndicator component
- [ ] SourcesDrawer component
- [ ] ServingTemperatureCard component
- [ ] DrinkingWindowCard component
- [ ] DrinkingWindowModal component
- [ ] ReportButton component

### Phase 6: Integration & Polish (2 days)
- [ ] Integrate into wine detail modal
- [ ] Loading states
- [ ] Error handling
- [ ] Mobile responsive
- [ ] Accessibility audit

### Phase 7: Admin Tools (1 day)
- [ ] Regenerate notes UI
- [ ] Review flagged notes queue
- [ ] Report management

**Total estimate: 13 days**

---

## Appendix A: CSS Variables

```css
:root {
  --card-bg: #1a1a1a;
  --card-bg-darker: #141414;
  --text-primary: #ffffff;
  --text-secondary: #b3b3b3;
  --text-muted: #666666;
  --accent: #f59e0b;
  --border-subtle: #333333;
  
  /* Evidence colours */
  --evidence-strong: #22c55e;
  --evidence-medium: #f59e0b;
  --evidence-weak: #ef4444;
  
  /* Urgency colours */
  --urgency-danger: #ef4444;
  --urgency-warning: #f59e0b;
  --urgency-caution: #eab308;
  --urgency-hold: #3b82f6;
}
```

---

## Appendix B: Source Type Icons

| Type | Icon | Colour |
|------|------|--------|
| Critic | 🎖️ | Gold |
| Merchant | 📦 | Blue |
| Community | 👥 | Green |
| Producer | 🏭 | Grey |

Or use SVG icons from Lucide:
- Critic: `Award`
- Merchant: `Store`
- Community: `Users`
- Producer: `Factory`
