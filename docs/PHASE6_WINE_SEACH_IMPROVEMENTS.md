# Wine Search Source Expansion - Implementation Instructions

## Objective

Expand the wine rating search capability by adding region-specific and competition sources to `sourceRegistry.js` and updating `searchProviders.js` to handle grape-specific filtering and score normalisation.

---

## 1. Source Registry Updates

### 1.1 Add New Fields to Source Schema

Each source object should support these fields:

```javascript
{
  id: string,           // unique identifier
  name: string,         // display name
  domain: string,       // for site: searches
  lens: string,         // 'competition' | 'panel_guide' | 'critic' | 'community'
  credibility: number,  // 0-1 weighting
  language: string,     // 'en' | 'es' | 'it' | 'fr' | 'de'
  grape_affinity: string[] | null,  // NEW: limit to specific grapes, null = all
  score_type: string,   // 'points' | 'stars' | 'medal' | 'symbol'
  score_format: string  // NEW: regex or description for extraction
}
```

### 1.2 Add Competition Sources

Add to the competitions array in `sourceRegistry.js`:

```javascript
// Grape-specific competitions
{
  id: 'chardonnay_du_monde',
  name: 'Chardonnay du Monde',
  domain: 'chardonnay-du-monde.com',
  lens: 'competition',
  credibility: 0.85,
  language: 'fr',
  grape_affinity: ['chardonnay'],
  score_type: 'medal',
  score_format: 'Grand Gold|Gold|Silver|Bronze'
},
{
  id: 'syrah_du_monde',
  name: 'Syrah du Monde',
  domain: 'syrahdumonde.com',
  lens: 'competition',
  credibility: 0.85,
  language: 'fr',
  grape_affinity: ['syrah', 'shiraz'],
  score_type: 'medal',
  score_format: 'Grand Gold|Gold|Silver|Bronze'
},
{
  id: 'grenaches_du_monde',
  name: 'Grenaches du Monde',
  domain: 'grenachesdumonde.com',
  lens: 'competition',
  credibility: 0.85,
  language: 'fr',
  grape_affinity: ['grenache', 'garnacha'],
  score_type: 'medal',
  score_format: 'Grand Gold|Gold|Silver|Bronze'
},
// Global competitions
{
  id: 'concours_mondial_bruxelles',
  name: 'Concours Mondial de Bruxelles',
  domain: 'concoursmondial.com',
  lens: 'competition',
  credibility: 0.90,
  language: 'en',
  grape_affinity: null,
  score_type: 'medal',
  score_format: 'Grand Gold|Gold|Silver'
},
{
  id: 'iwc',
  name: 'International Wine Challenge',
  domain: 'internationalwinechallenge.com',
  lens: 'competition',
  credibility: 0.88,
  language: 'en',
  grape_affinity: null,
  score_type: 'medal',
  score_format: 'Trophy|Gold|Silver|Bronze|Commended'
}
```

### 1.3 Add Australia/New Zealand Sources

```javascript
// Australia
{
  id: 'halliday',
  name: 'Halliday Wine Companion',
  domain: 'winecompanion.com.au',
  lens: 'critic',
  credibility: 0.92,
  language: 'en',
  grape_affinity: null,
  score_type: 'points',
  score_format: '\\d{2,3}\\s*points?'
},
{
  id: 'huon_hooke',
  name: 'Huon Hooke',
  domain: 'huonhooke.com',
  lens: 'critic',
  credibility: 0.85,
  language: 'en',
  grape_affinity: null,
  score_type: 'points',
  score_format: '\\d{2}(\\.\\d)?/100'
},
{
  id: 'gourmet_traveller_wine',
  name: 'Gourmet Traveller Wine',
  domain: 'gourmettravellerwine.com.au',
  lens: 'panel_guide',
  credibility: 0.82,
  language: 'en',
  grape_affinity: null,
  score_type: 'points',
  score_format: '\\d{2,3}'
},
// New Zealand
{
  id: 'bob_campbell',
  name: 'Bob Campbell MW',
  domain: 'bobcampbell.nz',
  lens: 'critic',
  credibility: 0.90,
  language: 'en',
  grape_affinity: null,
  score_type: 'points',
  score_format: '\\d{2,3}'
},
{
  id: 'wine_orbit',
  name: 'Wine Orbit',
  domain: 'wineorbit.co.nz',
  lens: 'critic',
  credibility: 0.85,
  language: 'en',
  grape_affinity: null,
  score_type: 'points',
  score_format: '\\d{2,3}'
}
```

### 1.4 Add Spanish-Language Sources

```javascript
// Spain
{
  id: 'guia_penin',
  name: 'Guía Peñín',
  domain: 'guiapenin.com',
  lens: 'panel_guide',
  credibility: 0.92,
  language: 'es',
  grape_affinity: null,
  score_type: 'points',
  score_format: '\\d{2,3}\\s*(puntos)?'
},
{
  id: 'guia_proensa',
  name: 'Guía Proensa',
  domain: 'guiaproensa.com',
  lens: 'critic',
  credibility: 0.80,
  language: 'es',
  grape_affinity: null,
  score_type: 'points',
  score_format: '\\d{2,3}'
},
// South America
{
  id: 'descorchados',
  name: 'Descorchados',
  domain: 'descorchados.com',
  lens: 'critic',
  credibility: 0.90,
  language: 'es',
  grape_affinity: null,
  score_type: 'points',
  score_format: '\\d{2,3}'
},
{
  id: 'vinomanos',
  name: 'Vinómanos',
  domain: 'vinomanos.com',
  lens: 'panel_guide',
  credibility: 0.78,
  language: 'es',
  grape_affinity: null,
  score_type: 'points',
  score_format: '\\d{2,3}'
}
```

### 1.5 Add Italian Sources

```javascript
{
  id: 'gambero_rosso',
  name: 'Gambero Rosso',
  domain: 'gamberorosso.it',
  lens: 'panel_guide',
  credibility: 0.93,
  language: 'it',
  grape_affinity: null,
  score_type: 'symbol',
  score_format: 'Tre Bicchieri|Due Bicchieri Rossi|Due Bicchieri|Un Bicchiere'
},
{
  id: 'doctor_wine',
  name: 'Doctor Wine',
  domain: 'doctorwine.it',
  lens: 'critic',
  credibility: 0.85,
  language: 'it',
  grape_affinity: null,
  score_type: 'points',
  score_format: '\\d{2,3}'
},
{
  id: 'bibenda',
  name: 'Bibenda',
  domain: 'bibenda.it',
  lens: 'panel_guide',
  credibility: 0.85,
  language: 'it',
  grape_affinity: null,
  score_type: 'symbol',
  score_format: '[1-5]\\s*grappoli|cinque grappoli|quattro grappoli'
},
{
  id: 'vinous',
  name: 'Vinous',
  domain: 'vinous.com',
  lens: 'critic',
  credibility: 0.92,
  language: 'en',
  grape_affinity: null,
  score_type: 'points',
  score_format: '\\d{2,3}\\+?'
}
```

### 1.6 Add French Sources

```javascript
{
  id: 'guide_hachette',
  name: 'Guide Hachette',
  domain: 'hachette-vins.com',
  lens: 'panel_guide',
  credibility: 0.88,
  language: 'fr',
  grape_affinity: null,
  score_type: 'symbol',
  score_format: '★{1,3}|Coup de C[oœ]ur'
},
{
  id: 'rvf',
  name: 'Revue du Vin de France',
  domain: 'larvf.com',
  lens: 'panel_guide',
  credibility: 0.90,
  language: 'fr',
  grape_affinity: null,
  score_type: 'points',
  score_format: '\\d{1,2}/20|\\d{2,3}/100'
},
{
  id: 'bettane_desseauve',
  name: 'Bettane+Desseauve',
  domain: 'mybettanedesseauve.fr',
  lens: 'panel_guide',
  credibility: 0.88,
  language: 'fr',
  grape_affinity: null,
  score_type: 'points',
  score_format: '\\d{1,2}/20|\\d{2,3}'
}
```

---

## 2. Region-Source Mapping

Add or update the region-to-source priority mapping:

```javascript
const regionSourcePriority = {
  'Australia': ['halliday', 'huon_hooke', 'gourmet_traveller_wine', 'decanter', 'vivino'],
  'New Zealand': ['bob_campbell', 'wine_orbit', 'decanter', 'vivino'],
  'Spain': ['guia_penin', 'guia_proensa', 'decanter', 'tim_atkin', 'vivino'],
  'Chile': ['descorchados', 'vinomanos', 'tim_atkin', 'decanter', 'vivino'],
  'Argentina': ['descorchados', 'tim_atkin', 'decanter', 'vivino'],
  'Italy': ['gambero_rosso', 'vinous', 'doctor_wine', 'bibenda', 'decanter', 'vivino'],
  'France': ['guide_hachette', 'rvf', 'bettane_desseauve', 'decanter', 'vivino'],
  'South Africa': ['platters', 'tim_atkin', 'veritas', 'vivino'],
  'USA': ['wine_enthusiast', 'wine_spectator', 'vinous', 'decanter', 'vivino'],
  'Germany': ['falstaff', 'weinwisser', 'decanter', 'vivino'],
  'Portugal': ['revista_de_vinhos', 'decanter', 'vivino'],
  // Default fallback for unlisted regions
  '_default': ['decanter', 'wine_enthusiast', 'vivino', 'cellartracker']
};
```

---

## 3. Search Provider Updates

### 3.1 Grape-Affinity Filtering

In `searchProviders.js`, update the source selection logic in `searchWineRatings()`:

```javascript
function getSourcesForWine(country, grape = null) {
  // Get base sources for country
  const countrySources = regionSourcePriority[country] || regionSourcePriority['_default'];
  
  // Get all source objects
  let sources = countrySources.map(id => sourceRegistry.find(s => s.id === id)).filter(Boolean);
  
  // Add grape-specific competitions if grape is known
  if (grape) {
    const grapeNormalised = grape.toLowerCase();
    const grapeCompetitions = sourceRegistry.filter(s => 
      s.lens === 'competition' && 
      s.grape_affinity && 
      s.grape_affinity.some(g => grapeNormalised.includes(g) || g.includes(grapeNormalised))
    );
    sources = [...grapeCompetitions, ...sources];
  }
  
  // Add global competitions
  const globalCompetitions = sourceRegistry.filter(s => 
    s.lens === 'competition' && 
    s.grape_affinity === null &&
    !sources.some(existing => existing.id === s.id)
  );
  
  return [...sources, ...globalCompetitions];
}
```

### 3.2 Grape Detection Helper

Add a helper to detect grape variety from wine name:

```javascript
const GRAPE_PATTERNS = {
  chardonnay: /chardonnay/i,
  syrah: /syrah|shiraz/i,
  grenache: /grenache|garnacha/i,
  cabernet_sauvignon: /cabernet\s*sauvignon/i,
  merlot: /merlot/i,
  pinot_noir: /pinot\s*noir/i,
  sauvignon_blanc: /sauvignon\s*blanc/i,
  riesling: /riesling/i,
  malbec: /malbec/i,
  tempranillo: /tempranillo/i,
  nebbiolo: /nebbiolo|barolo|barbaresco/i,
  sangiovese: /sangiovese|chianti|brunello/i
};

function detectGrape(wineName) {
  for (const [grape, pattern] of Object.entries(GRAPE_PATTERNS)) {
    if (pattern.test(wineName)) {
      return grape;
    }
  }
  return null;
}
```

---

## 4. Score Normalisation

### 4.1 Add Normalisation Map

Create a normalisation function to convert various score formats to a 0-100 scale:

```javascript
const SCORE_NORMALISATION = {
  // Medal awards
  'Grand Gold': 98,
  'Trophy': 98,
  'Gold': 94,
  'Silver': 88,
  'Bronze': 82,
  'Commended': 78,
  
  // Gambero Rosso
  'Tre Bicchieri': 95,
  'Due Bicchieri Rossi': 90,
  'Due Bicchieri': 87,
  'Un Bicchiere': 82,
  
  // Bibenda grappoli
  '5 grappoli': 95,
  'cinque grappoli': 95,
  '4 grappoli': 90,
  'quattro grappoli': 90,
  '3 grappoli': 85,
  
  // Hachette
  '★★★': 94,
  '★★': 88,
  '★': 82,
  'Coup de Coeur': 96,
  'Coup de Cœur': 96
};

function normaliseScore(rawScore, scoreType) {
  // Direct lookup for symbols/medals
  if (SCORE_NORMALISATION[rawScore]) {
    return SCORE_NORMALISATION[rawScore];
  }
  
  // Handle numeric scores
  const numericMatch = rawScore.match(/(\d+(?:\.\d+)?)/);
  if (numericMatch) {
    const value = parseFloat(numericMatch[1]);
    
    // Already on 100-point scale
    if (value >= 50 && value <= 100) {
      return Math.round(value);
    }
    
    // 20-point scale (French)
    if (value <= 20) {
      return Math.round((value / 20) * 100);
    }
    
    // 5-star scale
    if (value <= 5) {
      return Math.round((value / 5) * 100);
    }
  }
  
  return null; // Unable to normalise
}
```

### 4.2 Update Extraction Response Schema

Update the Claude extraction prompt to request the score_type so normalisation can be applied:

```javascript
// In the extraction prompt, add:
For each rating, provide:
- source: source id
- lens: competition | panel_guide | critic | community
- score_type: medal | points | stars | symbol
- raw_score: exactly as shown (e.g., "Gold", "92", "4.2", "Tre Bicchieri")
- normalised_score: convert to 100-point scale if possible, otherwise null
- evidence_excerpt: proof quote from text
- match_confidence: high | medium | low
```

---

## 5. Testing Checklist

After implementation, test with these wines to verify each source type:

| Wine | Country | Expected Source |
|------|---------|-----------------|
| Penfolds Grange 2018 | Australia | Halliday |
| Cloudy Bay Sauvignon Blanc 2022 | New Zealand | Bob Campbell |
| Vega Sicilia Unico 2012 | Spain | Guía Peñín |
| Catena Zapata Malbec 2020 | Argentina | Descorchados |
| Tignanello 2019 | Italy | Gambero Rosso |
| Château Margaux 2015 | France | Guide Hachette, RVF |
| Kumeu River Chardonnay 2021 | New Zealand | Bob Campbell + Chardonnay du Monde |

---

## 6. File Changes Summary

| File | Changes |
|------|---------|
| `sourceRegistry.js` | Add 20+ new source definitions with new schema fields |
| `searchProviders.js` | Add grape detection, grape-affinity filtering, score normalisation |
| `claude.js` | Update extraction prompt to handle new score types |

---

## Notes

- Halliday, Gambero Rosso, and Guía Peñín are paywalled but search snippets often contain scores
- French /20 scores should be converted to /100 for consistency
- Symbol-based scores (Tre Bicchieri, stars) need the normalisation map
- Test blocked-page fallback with each new domain to verify snippet extraction works
