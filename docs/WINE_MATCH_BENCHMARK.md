# Wine Match Benchmark

> **Purpose**: Establish baseline accuracy of wine matching before implementing the confirmation feature. Re-run after implementation to measure improvement.

---

## Benchmark Date: 2026-01-02 (Baseline - Before Confirmation Feature)

### Test Methodology

1. Select 10 diverse wines from cellar (different regions, styles, producers)
2. For each wine, search Vivino manually to find the correct match
3. Record what our system currently has vs. what Vivino shows
4. Score: Correct match / Partial match / Wrong match / Not found

---

## Test Wines

### Wine 1: Nederburg Private Bin Cabernet Sauvignon 2019

| Field | Our System | Vivino (Manual Search) | Match? |
|-------|-----------|------------------------|--------|
| Wine Name | Nederburg private bin Cabernet Sauvignon | Nederburg Private Bin Cabernet Sauvignon | ✅ |
| Vintage | 2019 | 2019 available | ✅ |
| Vivino Rating (ours) | 4.4 | ? | ⚠️ To verify |
| Vivino URL | Not stored | https://www.vivino.com/nederburg-estate-private-bin-cabernet-sauvignon/w/1160367 | ❌ Missing |

**Issue**: This was the wine that prompted this feature. The label shows "Private Bin Two Centuries" but we have it as just "Private Bin Cabernet Sauvignon". Need to verify if this is the correct wine or a different one.

**Status**: ⚠️ NEEDS VERIFICATION

---

### Wine 2: Kleine Zalze Chenin Blanc Vineyard Selection 2023

| Field | Our System | Vivino (Manual Search) | Match? |
|-------|-----------|------------------------|--------|
| Wine Name | Kleine Zalze Chenin Blanc (vineyard Selection) | Kleine Zalze Vineyard Selection Chenin Blanc | ✅ |
| Vintage | 2023 | 2023 available | ✅ |
| Vivino Rating (ours) | 4.0 | ~4.0 | ✅ |
| Producer | Not stored explicitly | Kleine Zalze | ❌ Missing |

**Status**: ✅ LIKELY CORRECT

---

### Wine 3: Doppio Passo Primitivo 2021

| Field | Our System | Vivino (Manual Search) | Match? |
|-------|-----------|------------------------|--------|
| Wine Name | Doppio Passo Primitivo | Doppio Passo Primitivo | ✅ |
| Vintage | 2021 | 2021 available | ✅ |
| Vivino Rating (ours) | 3.9 | ~3.9 | ✅ |
| Country | Not stored | Italy | ❌ Missing |

**Status**: ✅ LIKELY CORRECT

---

### Wine 4: 1865 Selected Vineyards Carmenere 2018

| Field | Our System | Vivino (Manual Search) | Match? |
|-------|-----------|------------------------|--------|
| Wine Name | 1865 Selected Vineyards Carmenere | San Pedro 1865 Selected Vineyards Carmenere | ⚠️ Missing producer |
| Vintage | 2018 | 2018 available | ✅ |
| Vivino Rating (ours) | 4.1 | ~4.1 | ✅ |

**Status**: ✅ LIKELY CORRECT (but missing producer "San Pedro")

---

### Wine 5: Biscardo Enigma 2018

| Field | Our System | Vivino (Manual Search) | Match? |
|-------|-----------|------------------------|--------|
| Wine Name | Biscardo Enigma | Biscardo Enigma | ✅ |
| Vintage | 2018 | 2018 available | ✅ |
| Vivino Rating (ours) | 4.3 | ~4.3 | ✅ |
| Style | Italian Red Blend | Red Blend from Veneto | ✅ |

**Status**: ✅ LIKELY CORRECT

---

### Wine 6: Prinsi Barbaresco Gaia Principe 2015

| Field | Our System | Vivino (Manual Search) | Match? |
|-------|-----------|------------------------|--------|
| Wine Name | Prinsi Barbaresco Gaia Principe | Prinsi Gaia Principe Barbaresco | ✅ |
| Vintage | 2015 | 2015 available | ✅ |
| Vivino Rating (ours) | 3.9 | ~4.0 | ⚠️ Close |

**Status**: ✅ LIKELY CORRECT

---

### Wine 7: Matsu El Recio 2023

| Field | Our System | Vivino (Manual Search) | Match? |
|-------|-----------|------------------------|--------|
| Wine Name | Matsu El Recio | Matsu El Recio | ✅ |
| Vintage | 2023 | 2023 available | ✅ |
| Vivino Rating (ours) | null | ~4.3 | ❌ Missing |
| Style | Spanish Red (Toro tempranillo) | Toro | ✅ |

**Status**: ⚠️ MISSING RATING

---

### Wine 8: Albert Bichot Bourgogne Pinot Noir Origins 2023

| Field | Our System | Vivino (Manual Search) | Match? |
|-------|-----------|------------------------|--------|
| Wine Name | Albert Bichot Bourgogne Pinot Noir Origins | Albert Bichot Bourgogne Pinot Noir Origines | ✅ |
| Vintage | 2023 | 2023 may not be available yet | ⚠️ |
| Vivino Rating (ours) | null | ~3.8 | ❌ Missing |

**Status**: ⚠️ MISSING RATING

---

### Wine 9: Rijks Reserve Chenin Blanc 2024

| Field | Our System | Vivino (Manual Search) | Match? |
|-------|-----------|------------------------|--------|
| Wine Name | Rijks Reserve Chenin Blanc | Rijks Cellar Reserve Chenin Blanc | ⚠️ Slight diff |
| Vintage | 2024 | 2024 may not be available | ⚠️ |
| Vivino Rating (ours) | 4.2 | ~4.2 | ✅ |

**Status**: ✅ LIKELY CORRECT

---

### Wine 10: Backsberg Patriach 2022

| Field | Our System | Vivino (Manual Search) | Match? |
|-------|-----------|------------------------|--------|
| Wine Name | Backsberg Patriach | Backsberg The Patriarch | ⚠️ Missing "The" |
| Vintage | 2022 | ? | ⚠️ |
| Vivino Rating (ours) | null | ? | ❌ Missing |
| Style | Cabernet Franc | ? | ⚠️ |

**Status**: ⚠️ NEEDS VERIFICATION - May be misnamed

---

## Baseline Summary

| Status | Count | Wines |
|--------|-------|-------|
| ✅ Likely Correct | 5 | Kleine Zalze Chenin, Doppio Passo, 1865 Carmenere, Biscardo Enigma, Prinsi Barbaresco |
| ⚠️ Needs Verification | 4 | Nederburg Private Bin, Matsu El Recio, Albert Bichot, Rijks Reserve |
| ❌ Wrong Match | 1 | Backsberg Patriach (possibly wrong name) |

### Baseline Metrics

| Metric | Value |
|--------|-------|
| **Correct Matches** | 5/10 (50%) |
| **Partial/Unverified** | 4/10 (40%) |
| **Wrong/Missing** | 1/10 (10%) |
| **Wines with Vivino ID stored** | 0/10 (0%) |
| **Wines with Vivino URL stored** | 0/10 (0%) |
| **Wines missing ratings** | 4/10 (40%) |

---

## Issues Identified

### 1. No Vivino Reference Stored
- We don't store `vivino_id` or `vivino_url`
- Can't verify if rating is from correct wine
- Can't link user to Vivino page for verification

### 2. Producer Name Often Missing or Inconsistent
- "1865" should be "San Pedro 1865"
- "Backsberg Patriach" should be "Backsberg The Patriarch"
- Producer not stored as separate field

### 3. No User Confirmation Step
- Wine matched automatically without verification
- User has no way to see alternatives
- Wrong matches persist undetected

### 4. Missing Ratings for Recent Wines
- 4/10 wines have null ratings
- May be lookup failures or wines not found

---

## Target Metrics (After Implementation)

| Metric | Baseline | Target |
|--------|----------|--------|
| Correct Matches | 50% | 90%+ |
| Vivino ID stored | 0% | 100% |
| User verified | 0% | 100% |
| Missing ratings | 40% | <10% |

---

## Re-run Instructions

After implementing the Wine Confirmation feature:

1. Add 10 new wines using the new flow
2. For each wine, note if user confirmed correct match
3. Verify against Vivino manually
4. Calculate new metrics
5. Compare to baseline

---

## Appendix: Full Wine List for Reference

Wines selected for benchmark (from cellar):

```
ID 37: Nederburg private bin Cabernet Sauvignon (2019) - SA Cab
ID 55: Kleine Zalze Chenin Blanc Vineyard Selection (2023) - SA White
ID 15: Doppio Passo Primitivo (2021) - Italian Red
ID 45: 1865 Selected Vineyards Carmenere (2018) - Chilean Red
ID 25: Biscardo Enigma (2018) - Italian Blend
ID 23: Prinsi Barbaresco Gaia Principe (2015) - Italian Nebbiolo
ID 78: Matsu El Recio (2023) - Spanish Toro
ID 90: Albert Bichot Bourgogne Pinot Noir Origins (2023) - French Burgundy
ID 61: Rijks Reserve Chenin Blanc (2024) - SA White
ID 84: Backsberg Patriach (2022) - SA Cab Franc
```

Criteria for selection:
- Mix of countries (SA, Italy, Chile, Spain, France)
- Mix of styles (Cab, Chenin, Primitivo, Carmenere, Nebbiolo, Tempranillo, Pinot Noir)
- Mix of price points
- Some with ratings, some without
- Some potentially problematic names
