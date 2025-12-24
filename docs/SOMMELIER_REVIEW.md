# Wine Cellar App - Sommelier Review Report

**Date:** December 23, 2025
**Test Database:** 114 bottles across 70+ unique wines

---

## Executive Summary

The Wine Cellar App is a comprehensive digital cellar management system designed to help wine enthusiasts track, manage, and optimise consumption of their wine collection. The application combines traditional inventory management with AI-powered recommendations and drinking window intelligence.

---

## Cellar Overview

| Metric | Value |
|--------|-------|
| **Total Bottles** | 114 |
| **Red Wines** | 59 bottles (52%) |
| **White Wines** | 53 bottles (46%) |
| **Rosé Wines** | 2 bottles (2%) |
| **Priority "Reduce Now"** | 22 wines flagged |
| **Empty Slots** | 64 available |

### Storage Zones
- **Fridge Zone:** 8 slots (2 rows) - White wines chilled for immediate drinking
- **Cellar Zone:** 170 slots (19 rows) - Temperature-controlled storage

---

## Feature Analysis

### 1. Visual Cellar Grid
The application displays a visual grid representation of the wine cellar with:
- **Colour-coded slots** showing red, white, and rosé wines at a glance
- **Location codes** (e.g., F1 for Fridge slot 1, R12C5 for Row 12, Column 5)
- **Empty slot identification** for planning new acquisitions
- **Click-through to wine details** including ratings, tasting notes, and drinking windows

**Sommelier Assessment:** This provides excellent inventory visibility. The visual approach makes it easy to locate specific bottles and understand cellar composition at a glance.

### 2. Drinking Window Intelligence (NEW)

The application now tracks optimal drinking windows for each wine:

| Wine | Vintage | Window | Peak | Status |
|------|---------|--------|------|--------|
| Biscardo Enigma | 2018 | 2019-2024 | 2022 | **CRITICAL** - Past window |
| Papale Primitivo di Manduria | 2020 | 2022-2027 | 2025 | **AT PEAK** - Drink now |
| Prinsi Barbaresco | 2015 | 2020-2028 | 2025 | **AT PEAK** - Drink now |
| Marques de Valdecanas Carinena Gran Reserva | 2012 | 2018-2025 | 2023 | Closing soon |
| Nederburg Two Centuries Cabernet | 2019 | 2022-2032 | 2027 | Holding well |

**Urgency Classification:**
- **Critical:** Past drinking window - consume immediately
- **High:** Final year of window
- **Medium:** Window closing within threshold (configurable, default 12 months)
- **Peak:** At optimal drinking year
- **Unknown:** No window data (uses age/rating fallback)
- **Low:** Low-rated wines to clear

**Sommelier Assessment:** This is a sophisticated approach that mirrors professional cellar management. The multi-source priority system (manual > critic > community) respects the sommelier's expertise while incorporating external data.

### 3. Reduce-Now Priority System

The auto-evaluation engine identified candidates based on drinking window analysis:

**Current Evaluation Results:**
```
Total candidates: 3
├── Critical (past window): 1 wine
│   └── Biscardo Enigma 2018 - Italian Red Blend
├── At Peak: 2 wines
│   ├── Papale Primitivo di Manduria 2020
│   └── Prinsi Barbaresco Gaia Principe 2015
└── Fallback candidates: 0 (all wines have window data)
```

**Sommelier Assessment:** The priority system correctly identifies wines that need attention. The Barbaresco at 10 years old being flagged for peak drinking aligns with Nebbiolo's typical development curve.

### 4. Multi-Lens Rating System

Ratings are aggregated from multiple source types with credibility weighting:

| Lens | Credibility | Sources |
|------|-------------|---------|
| **Competition** | 3.0x | DWWA, IWC, IWSC, Mundus Vini, Chardonnay du Monde, etc. |
| **Panel Guide** | 2.5x | Halliday, Platter's, Gambero Rosso, Guide Hachette |
| **Critic** | 1.5x | Tim Atkin MW, Jancis Robinson, Wine Spectator |
| **Community** | 1.0x | Vivino, CellarTracker |

**Score Normalisation:**
- Medal awards converted: Trophy/Platinum → 98, Gold → 94, Silver → 88
- Tre Bicchieri → 95 points
- Platter's 5 stars → 100 points
- French /20 scores multiplied by 5

**User Preference:** Configurable slider from "Community-focused" (-100) to "Competition-focused" (+100), currently set to +40 (slightly favoring competition awards).

**Sommelier Assessment:** The multi-lens approach provides balanced perspective. Competition medals often indicate technical excellence, while community ratings reflect consumer appeal. The weighting system is well-considered.

### 5. AI-Powered Sommelier Pairing

The application includes an AI sommelier feature powered by Claude:
- Natural language dish description input
- Wine recommendations from cellar inventory
- Preference for "Reduce Now" wines when appropriate
- Colour filtering (red/white/rosé/any)

**Manual Pairing Signals:**
- Proteins: Chicken, Pork, Beef, Lamb, Fish, Cheese
- Flavours: Garlic/Onion, Herbal, Roasted, Acidic/Citrus, Sweet, Umami, Creamy

**Sommelier Assessment:** The AI pairing feature adds significant value for collectors seeking guidance. The integration with the reduce-now list encourages consumption of wines at optimal maturity.

### 6. Wine Details & Tasting Notes

Each wine entry includes:
- **Vintage and Style** (e.g., "Primitivo di Manduria" vs "Primitivo (Puglia)")
- **Vivino Rating** from community data
- **Purchase Price** in EUR
- **Tasting Notes** when available
- **Personal Rating** (user's own 1-5 score)
- **Drinking Windows** from multiple sources

---

## Sample Wine Profiles

### Wine 1: Papale Primitivo di Manduria 2020
- **Style:** Primitivo di Manduria
- **Colour:** Red
- **Location:** R11C2
- **Vivino Rating:** 4.1/5
- **Price:** €22.50
- **Drinking Window:** 2022-2027 (peak 2025)
- **Status:** **AT PEAK** - Ideal time to drink

### Wine 2: Prinsi Barbaresco Gaia Principe 2015
- **Style:** Northern Italian Red (Barbaresco/Nebbiolo)
- **Colour:** Red
- **Location:** R12C5
- **Vivino Rating:** 3.9/5
- **Price:** €31.30
- **Drinking Window:** 2020-2028 (peak 2025)
- **Status:** **AT PEAK** - Classic Nebbiolo at 10 years

### Wine 3: Marques de Valdecanas Carinena Gran Reserva 2012
- **Style:** Carinena (Spain)
- **Colour:** Red
- **Location:** R14C1-R14C4 (4 bottles)
- **Vivino Rating:** 3.8/5
- **Price:** €9.00
- **Drinking Window:** 2018-2025 (peak 2023)
- **Status:** Final year - Priority 1 reduce-now

### Wine 4: Biscardo Enigma 2018
- **Style:** Italian Red Blend
- **Colour:** Red
- **Location:** R12C7
- **Vivino Rating:** 4.3/5
- **Price:** €16.49
- **Drinking Window:** 2019-2024 (peak 2022)
- **Status:** **CRITICAL** - Past optimal window

### Wine 5: Nederburg Two Centuries Cabernet Sauvignon 2019
- **Style:** Cabernet Sauvignon (South Africa)
- **Colour:** Red
- **Location:** R16C7
- **Vivino Rating:** 4.4/5
- **Price:** €25.00
- **Drinking Window:** 2022-2032 (peak 2027)
- **Status:** Holding well - years of development ahead

---

## Technical Observations

### Strengths
1. **Comprehensive data model** - Wine style, vintage, ratings, pricing, location all tracked
2. **Drinking window integration** - Critical feature for cellar optimization
3. **Multi-source rating aggregation** - Professional-grade source hierarchy
4. **Visual inventory management** - Intuitive fridge/cellar grid layout
5. **AI integration** - Modern approach to food pairing recommendations

### Areas for Enhancement
1. **Pairing rule refinement** - Beef+roasted currently suggests whites before reds
2. **Rating fetch automation** - Many wines lack external ratings (requires manual fetch)
3. **Producer tracking** - Wine entries don't separate producer from wine name
4. **Region data** - Country/region fields could be more consistently populated

---

## Recommendations for Cellar Management

Based on the data analysis:

1. **Immediate Action Required:**
   - Biscardo Enigma 2018 - Past drinking window, consume within 1-2 months

2. **Optimal Drinking Now (Peak 2025):**
   - Papale Primitivo di Manduria 2020
   - Prinsi Barbaresco Gaia Principe 2015

3. **Priority This Year:**
   - Marques de Valdecanas Carinena Gran Reserva 2012 (4 bottles) - Final year of window

4. **Long-term Cellaring:**
   - Nederburg Two Centuries Cabernet 2019 - Hold until 2027 peak

---

## Conclusion

The Wine Cellar App provides a robust platform for personal wine collection management. The integration of drinking window intelligence elevates it beyond simple inventory tracking to a proper cellar optimization tool. The multi-lens rating system and AI pairing features add professional-grade capabilities accessible to enthusiast collectors.

**Overall Rating: 4.2/5**

The application successfully bridges the gap between casual wine collecting and professional cellar management, with the drinking window feature being particularly valuable for optimizing consumption timing.

---

*Report generated by Wine Cellar App v1.0*
