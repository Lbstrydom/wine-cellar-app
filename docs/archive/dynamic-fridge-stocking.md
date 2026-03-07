# Plan: Dynamic Fridge Stocking Algorithm

- **Date**: 2026-03-06
- **Status**: Draft (rev 5 — incorporates review feedback rounds 1, 2, 3 & 4)
- **Author**: Claude + User

---

## 1. Context Summary

### What Exists Today

The fridge stocking system is in `src/services/cellar/fridgeStocking.js` with config in `src/config/fridgeParLevels.js`. Key observations:

1. **Par-levels are hardcoded** — `FRIDGE_PAR_LEVELS` defines fixed `min`/`max` per category (e.g., 2 crisp whites, 1 sparkling) totalling 8 slots + 1 flex = 9. These don't scale to a 48-bottle wine fridge or a 6-slot kitchen fridge.

2. **Storage types already exist** — The DB schema (`storage_areas.storage_type`) already supports `wine_fridge` and `kitchen_fridge` as distinct types. `getFridgeStorageType()` in `cellar.js` already queries which type a cellar has.

3. **Basic filtering exists** — `fridgeStocking.js` already has `RED_FRIDGE_CATEGORIES` and filters reds out when `fridgeType === 'kitchen_fridge'`. But the par-level allocation itself doesn't change — it still asks for 1 chillable red then filters it away, wasting a slot.

4. **Multiple fridge areas possible** — `getStorageAreasByType()` returns arrays per type. A user could have both a `wine_fridge` AND a `kitchen_fridge`. Today, only the first fridge area is used (`LIMIT 1`).

5. **Dynamic capacity exists partially** — `analyseFridge()` already computes `dynamicFridgeCapacity` from `storage_area_rows`. But the par-levels that decide *what goes where* are still hardcoded.

6. **Zone allocation pattern** — The zone system (`rowAllocationSolver.js`) uses a demand-driven algorithm: count wines by style, compute proportional row allocation, then solve constraints. This is the pattern we should mirror.

7. **Per-area slot attribution exists** — The `slots` table already has `storage_area_id` (UUID FK, added in migration 038). This means we can query occupied fridge wines scoped to a specific storage area, not just by `location_code.startsWith('F')`.

### Reusable Components

- `categoriseWine()` — wine classification logic (keep as-is, it's good)
- `findSuitableWines()` — ranking/scoring logic (keep, parameterize)
- `getStorageAreasByType()` — already groups areas by type
- `buildCandidateObject()`, `buildFillReason()` — display helpers (keep)

### What Needs to Change

The **par-level computation** must become a function of:
1. **Fridge type** — what categories are eligible
2. **Capacity** — how many slots to allocate across categories
3. **Cellar inventory** — what wines the user actually has

---

## 2. Proposed Architecture

### Core Concept: Compute Par-Levels, Don't Hardcode Them

Replace the static `FRIDGE_PAR_LEVELS` config with a **two-layer system**:

```
Layer 1: CATEGORY_REGISTRY (static)         Layer 2: computeParLevels() (dynamic)
  - What categories exist                     - Which are eligible for this fridge type
  - How to match wines to categories          - How many slots each gets (proportional)
  - Temperature suitability per type          - Based on actual cellar inventory
  - Priority ordering                         - Scaled to actual capacity
  - Pairing signals
```

### Component Diagram

```
src/config/fridgeCategories.js     NEW - Category registry (replaces fridgeParLevels.js)
  |
  v
src/services/cellar/fridgeAllocator.js   NEW - Dynamic par-level computation + cross-area coordination
  |
  v
src/services/cellar/fridgeStocking.js    MODIFY - Use computed par-levels instead of static
  |
  v
src/routes/cellarAnalysis.js             MODIFY - Sequential multi-area planning with inventory reservation
src/routes/cellar.js                     MODIFY - Multi-area fridge queries
```

### Data Flow

```
1. cellarAnalysis route
   |
   |- getStorageAreasByType(cellarId)
   |    -> { wine_fridge: [{id, rows, capacity}], kitchen_fridge: [{id, rows, capacity}] }
   |
   |- countInventoryByCategory(allWines, categoriseFn)      ← TOTAL collection
   |    -> { sparkling: 3, crispWhite: 8, chillableRed: 12, ... }
   |    NOTE: Counts ALL wines (including those already in fridges) to determine
   |    the target mix. If all sparkling is already chilled, the allocator still
   |    reserves sparkling slots because the user owns sparkling.
   |
   |- sortedAreas = sortFridgeAreasByPriority(allFridgeAreas)
   |    (wine_fridge before kitchen_fridge — wine fridges get first pick)
   |
   |- allFridgeAreaIds = new Set(allFridgeAreas.map(a => a.id))
   |- reservedSlotIds = new Set()                            ← grows as areas are planned
   |    NOTE: Keyed by slot ID (not wine ID) because a user can own multiple
   |    bottles of the same wine in different slots. Reserving by wine ID would
   |    block all bottles after recommending just one.
   |- priorAllocations = {}                                  ← tracks targeted slots per category
   |
   |- For EACH fridge area (sequentially, priority order):
   |    |
   |    |- parLevels = computeParLevels(totalInventoryCounts, area.storage_type,
   |    |                                area.capacity, priorAllocations)
   |    |    -> { sparkling: {min:1, max:2}, crispWhite: {min:2, max:4}, ... }
   |    |    NOTE: Uses TOTAL counts for proportional mix. Global stock cap uses
   |    |    priorAllocations to prevent collective over-targeting.
   |    |
   |    |- getWinesByArea(allWines, area.id)                  ← per-area occupied bottles
   |    |    -> wines currently in THIS fridge (via storage_area_id on allWines)
   |    |
   |    |- getAvailableCandidates(allWines, allFridgeAreaIds, reservedSlotIds)
   |    |    -> bottle-slots not in ANY fridge AND not already reserved by a prior area
   |    |
   |    |- analyseFridge(areaFridgeWines, candidates, parLevels, ...)
   |    |    -> gaps, candidates, alternatives
   |    |
   |    |- for each recommended candidate: reservedSlotIds.add(candidate.slotId)
   |    |- for each category in parLevels: priorAllocations[cat] += parLevels[cat].min
   |    |    Both prevent double-booking: candidates by slot, targets by count
   |    |
   |- detectFridgeTransfers(fridgeAnalysis, allFridgeAreas)   ← cross-area misplacement pass
   |    -> transferSuggestions[] (e.g., chillable red: kitchen → wine fridge)
   |
   |- fridgeAnalysis[] = merged results per area + transferSuggestions
   |- fridgeStatus = fridgeAnalysis[0]                       ← backward compat alias
```

### Key Design Decisions

**Decision 1: Category registry is static, allocation is dynamic**
*Principles: Single Source of Truth (#10), Open/Closed (#3), No Hardcoding (#8)*

The *definition* of what makes a wine "crisp white" vs "aromatic white" doesn't change between users. The *number of slots* allocated to each category does. Separating these concerns means:
- Adding a new category = add to registry, no algorithm changes
- Changing allocation logic = modify algorithm, no category changes

**Decision 2: Proportional allocation based on total collection, not remaining inventory**
*Principles: No Hardcoding (#8), Long-Term Flexibility (#20)*

**Why total collection, not non-fridge remainder**: If a user owns 5 sparkling wines and all 5 are already chilled, the target mix should still include sparkling slots. The allocator answers "what should the fridge look like?" based on what the user owns — not "what's left to chill?" The *candidate selector* (not the allocator) filters to wines not yet chilled.

Algorithm:
1. Count **all** cellar wines (including fridge wines) by eligible category
2. Compute proportional share: `categoryShare = categoryCount / totalEligibleCount`
3. Scale to capacity: `rawSlots = categoryShare * availableSlots`
4. Apply floor guarantees: each category with stock gets at least 1 slot
5. Distribute remainder proportionally, priority tiebreaker for fractional remainders
6. **Global stock cap**: clamp each category to `min(allocatedSlots, stockCount - priorAllocations[category])` — never target more slots across all areas than wines owned. Excess slots from capping are redistributed to flex. The `priorAllocations` map tracks how many slots prior areas have already targeted for each category.

Example — 12-slot wine fridge, user has 15 whites, 8 reds, 3 sparkling, 2 rose:
```
Total eligible: 28 wines across 6 categories
Floor guarantees: 6 categories * 1 slot = 6 slots
Remaining: 6 slots distributed proportionally
  crispWhite (8/28): 1 + 2 = 3 slots
  textureWhite (7/28): 1 + 1 = 2 slots
  chillableRed (8/28): 1 + 2 = 3 slots
  sparkling (3/28): 1 + 1 = 2 slots
  rose (2/28): 1 + 0 = 1 slot
  aromaticWhite (0/28): 0 slots (no stock)
  flex: 1 slot
```

Example — 6-slot kitchen fridge, same inventory (reds excluded):
```
Eligible: 20 wines across 4 categories (no chillableRed, no textureWhite)
Floor guarantees: 4 categories * 1 = 4 slots
Remaining: 2 slots
  crispWhite: 1 + 1 = 2 slots
  sparkling: 1 + 0 = 1 slot
  aromaticWhite: 1 + 0 = 1 slot
  rose: 1 + 0 = 1 slot
  flex: 1 slot
```

**Decision 3: Temperature suitability drives eligibility**
*Principles: Defensive Validation (#12), Single Responsibility (#2)*

Each category in the registry declares which storage types it's suitable for:

```javascript
chillableRed: {
  suitableFor: ['wine_fridge'],  // NOT kitchen_fridge — 5C kills light reds
  ...
},
textureWhite: {
  suitableFor: ['wine_fridge'],  // Oaked whites need 10-13C, not 5C
  ...
},
crispWhite: {
  suitableFor: ['wine_fridge', 'kitchen_fridge'],  // Fine at 5C for serving
  ...
}
```

This replaces the current `RED_FRIDGE_CATEGORIES` exclusion set with a positive declaration — more extensible, clearer intent.

**Decision 4: Coordinated multi-area planning with inventory reservation**
*Principles: Long-Term Flexibility (#20), Backward Compatibility (#18), Data Integrity*

A user might have:
- Wine fridge (24 bottles) + kitchen fridge (6 bottles)
- Two wine fridges (one for whites, one for reds)
- Just a kitchen fridge

**Cross-area coordination rule**: Areas are planned sequentially by priority (wine fridge first, then kitchen fridge). Each area's *par-level targets* are computed from total collection counts (so the target mix is stable regardless of order). But *candidate selection* deducts wines already recommended to prior areas, preventing the same bottle from being suggested for multiple fridges.

This avoids the double-counting problem without complex global optimization:
- Par-levels are deterministic (total collection counts → same targets regardless of order)
- Candidates are exclusive at the **slot level** (each bottle-slot is offered to at most one area). A user with 3 bottles of the same wine can have one recommended to the wine fridge and another to the kitchen fridge — only the specific slot is reserved, not the wine ID.
- Wine fridges get priority access to the candidate pool

The analysis route produces a `fridgeAnalysis[]` array. For backward compatibility, the first entry is also exposed as `fridgeStatus`.

**Decision 5: Per-area bottle attribution via storage_area_id**
*Principles: Single Source of Truth (#10), Existing Infrastructure*

Each fridge area knows its occupied bottles by joining `slots.storage_area_id = area.id`. This replaces the current `location_code.startsWith('F')` approach, which is area-blind.

For gap analysis, each area compares its par-level targets against its own occupied bottles — not against all fridge bottles globally. This means:
- Wine fridge gap analysis only sees wine fridge bottles
- Kitchen fridge gap analysis only sees kitchen fridge bottles
- Swap suggestions only propose swaps within the same area

**Cross-area transfer suggestions**: After per-area analysis, a separate pass identifies *misplaced fridge wines* — bottles in one fridge area that belong to a category ineligible for that area's storage type (e.g., a chillable red in a kitchen fridge). These are surfaced as `transferSuggestions` in the response: "Move Pinot Noir from Kitchen Fridge → Wine Fridge". This handles the case where a wine is already chilled but in the wrong fridge. See Decision 8.

**Decision 6: Flex slots are capacity-dependent**
*Principles: No Hardcoding (#8)*

Current: always 1 flex slot. New: flex gets `max(1, floor(capacity * 0.1))` — 10% of capacity, minimum 1. A 48-bottle wine fridge gets ~5 flex slots; a 6-slot kitchen fridge gets 1.

**Decision 7: fridgeStatus is a first-area backward-compat shim, not a cellar-wide summary**
*Principles: Backward Compatibility (#18)*

The existing frontend consumes `report.fridgeStatus` as a single object. Post-migration:
- `fridgeStatus` = `fridgeAnalysis[0]` (first area by priority)
- `fridgeAnalysis[]` = full array for multi-fridge UI (frontend follow-up)

This is explicitly NOT a cellar-wide aggregation. Aggregating gaps/candidates across areas with different temperature profiles would produce misleading results (e.g., a "sparkling gap" summed across wine fridge + kitchen fridge is meaningless if one area is already full).

**Decision 8: Cross-area transfer suggestions for misplaced fridge wines**
*Principles: Data Integrity, User Value*

The candidate pool for each area is non-fridge wines only — this is correct for *new* recommendations. But it creates a blind spot: a chillable red already sitting in a kitchen fridge (where it's too cold at 5°C) would never be surfaced as the best candidate for a wine fridge gap.

**Solution**: After all per-area analyses complete, run a `detectFridgeTransfers()` pass:

1. For each fridge area, find occupied wines whose category is *ineligible* for that area's storage type (e.g., `chillableRed` in a `kitchen_fridge`)
2. Check if another area exists where the category IS eligible and has a **remaining gap or flex slot** (after candidates were already assigned)
3. Surface these as `transferSuggestions: [{ wine, fromArea, toArea, category, reason }]`
4. **Transfers consume destination capacity**: each accepted transfer reduces the destination area's remaining gap count for that category (or flex count). If a transfer fills the last chillableRed gap in the wine fridge, the candidate that was assigned to that gap is demoted to `alternatives` (still shown, but not the primary recommendation)
5. Transfers are never generated for slots that already have a candidate assigned AND sufficient stock — they only fill remaining gaps or replace candidates when the transfer is a strictly better fit (misplacement correction > new addition)

This is a post-analysis pass, not part of the per-area loop, because it requires all areas to be analyzed first. Transfer suggestions are advisory — the user decides whether to act on them.

**Scope limit**: Only suggest transfers where the source category is ineligible for the source area. A sparkling wine in a wine fridge is not "misplaced" even if the kitchen fridge also has a sparkling gap — that's a preference, not a correction.

**No conflicting advice**: Because transfers consume destination capacity, the response never shows both "add wine X from cellar" and "transfer wine Y from kitchen fridge" competing for the same slot. If the destination has 2 chillableRed gaps and 1 transfer fills one of them, only 1 cellar candidate is shown for the remaining gap.

---

## 3. Sustainability Notes

### Assumptions That Could Change

| Assumption | Likelihood | Mitigation |
|-----------|-----------|-----------|
| Categories are universal (same worldwide) | Medium — some regions may want dessert/fortified as fridge categories | Registry is extensible: add new entry, suitability tags, done |
| Users have at most 2-3 fridge areas | High probability for now | Array-based design handles N areas |
| Proportional allocation is the right algorithm | Could evolve to preference-weighted | `computeParLevels()` is a single function — swap algorithm without touching consumers |
| Kitchen fridge = chilling only | Stable — physics doesn't change | Suitability is data-driven, can add edge cases |
| Sequential priority ordering (wine fridge first) is fair | High — wine fridges are purpose-built | Priority is configurable per area; could add user override |

### Extension Points

1. **New category** — Add to `CATEGORY_REGISTRY`, no other changes needed
2. **New storage type** — Add suitability entries to existing categories
3. **User preference weighting** — `computeParLevels()` could accept a `preferences` param to bias allocation (e.g., "I drink more sparkling")
4. **Seasonal adjustment** — Summer = more rose/white bias, winter = more red. Could be a future multiplier in the algorithm
5. **Smart learning** — Track what the user actually drinks from the fridge and adjust proportions over time

---

## 4. File-Level Plan

### 4.1 CREATE: `src/config/fridgeCategories.js`

**Replaces**: `src/config/fridgeParLevels.js`
**Purpose**: Category registry — defines what categories exist, how to match wines, and temperature suitability
**Principles**: Single Source of Truth (#10), Open/Closed (#3)

```javascript
/**
 * Fridge category registry.
 * Defines wine categories, match rules, and storage type suitability.
 * Par-level quantities are NOT here — computed dynamically by fridgeAllocator.
 */
export const CATEGORY_REGISTRY = {
  sparkling: {
    priority: 1,
    description: 'Celebration-ready bubbles',
    signals: ['celebration', 'aperitif', 'champagne', 'prosecco'],
    preferredZones: ['rose_sparkling'],
    suitableFor: ['wine_fridge', 'kitchen_fridge'],
    // Temperature notes: sparkling is best at 5-7C (fine in either fridge type)
    matchRules: {
      colours: ['sparkling'],
      keywords: ['champagne', 'prosecco', 'cava', 'cremant', 'sparkling', 'brut']
    }
  },
  crispWhite: {
    priority: 2,
    description: 'High-acid whites for seafood & salads',
    signals: ['fish', 'seafood', 'salad', 'light'],
    preferredZones: ['sauvignon_blanc', 'loire_light', 'aromatic_whites'],
    suitableFor: ['wine_fridge', 'kitchen_fridge'],
    // Temperature notes: serve at 7-10C, fine in kitchen fridge for short-term
    matchRules: {
      colours: ['white'],
      grapes: ['sauvignon blanc', 'picpoul', 'muscadet', 'albarino', 'assyrtiko', 'gruner veltliner'],
      excludeWinemaking: ['oaked', 'barrel aged']
    }
  },
  aromaticWhite: {
    priority: 3,
    description: 'Off-dry/aromatic for spicy food',
    signals: ['spicy', 'asian', 'thai', 'indian', 'sweet'],
    preferredZones: ['aromatic_whites'],
    suitableFor: ['wine_fridge', 'kitchen_fridge'],
    // Temperature notes: serve at 8-12C, kitchen fridge OK for pre-serve chill
    matchRules: {
      colours: ['white'],
      grapes: ['riesling', 'gewurztraminer', 'viognier', 'torrontes', 'muscat'],
      keywords: ['aromatic', 'off-dry', 'semi-sweet']
    }
  },
  textureWhite: {
    priority: 4,
    description: 'Fuller whites for creamy dishes',
    signals: ['creamy', 'roasted', 'rich', 'butter'],
    preferredZones: ['chardonnay', 'chenin_blanc'],
    suitableFor: ['wine_fridge'],
    // Temperature notes: serve at 10-13C, too cold in kitchen fridge
    matchRules: {
      colours: ['white'],
      grapes: ['chardonnay', 'chenin blanc'],
      winemaking: ['oaked', 'barrel aged', 'malolactic'],
      keywords: ['burgundy', 'meursault', 'oaked']
    }
  },
  rose: {
    priority: 5,
    description: 'Versatile weeknight option',
    signals: ['chicken', 'pork', 'light', 'summer'],
    preferredZones: ['rose_sparkling'],
    suitableFor: ['wine_fridge', 'kitchen_fridge'],
    // Temperature notes: serve at 8-12C, kitchen fridge fine
    matchRules: {
      colours: ['rose'],
      keywords: ['rose', 'rosado']
    }
  },
  chillableRed: {
    priority: 6,
    description: 'Light red for charcuterie',
    signals: ['pork', 'charcuterie', 'cheese', 'light red'],
    preferredZones: ['pinot_noir', 'iberian_fresh'],
    suitableFor: ['wine_fridge'],
    // Temperature notes: serve at 12-14C, kitchen fridge at 5C is far too cold
    matchRules: {
      colours: ['red'],
      grapes: ['pinot noir', 'gamay', 'frappato', 'mencia', 'grenache'],
      excludeKeywords: ['full body', 'oaked', 'reserve']
    }
  },
  dessertFortified: {
    priority: 7,
    description: 'Sweet/fortified wines',
    signals: ['dessert', 'cheese', 'after dinner'],
    preferredZones: ['dessert_fortified'],
    suitableFor: ['wine_fridge'],
    // Temperature notes: serve at 8-12C (sweet whites) or 14-16C (port)
    matchRules: {
      colours: ['dessert', 'fortified'],
      keywords: ['port', 'sherry', 'madeira', 'sauternes', 'tokaji', 'ice wine',
                 'late harvest', 'noble late', 'straw wine', 'vin santo']
    }
  }
};

/**
 * Flex category — always last, matches anything.
 * Separated from registry because it has no match rules.
 */
export const FLEX_CATEGORY = {
  priority: 99,
  optional: true,
  description: "Any wine you're excited to drink soon",
  signals: [],
  preferredZones: [],
  suitableFor: ['wine_fridge', 'kitchen_fridge'],
  matchRules: {}
};

/**
 * Category display order for fridge organization (coldest → warmest).
 */
export const FRIDGE_CATEGORY_ORDER = [
  'sparkling',
  'crispWhite',
  'aromaticWhite',
  'textureWhite',
  'rose',
  'dessertFortified',
  'chillableRed',
  'flex'
];

/**
 * Human-readable category names.
 */
export const CATEGORY_DISPLAY_NAMES = {
  sparkling: 'Sparkling',
  crispWhite: 'Crisp White',
  aromaticWhite: 'Aromatic White',
  textureWhite: 'Oaked White',
  rose: 'Rose',
  chillableRed: 'Light Red',
  dessertFortified: 'Dessert/Fortified',
  flex: 'Flex'
};
```

**Key changes from `fridgeParLevels.js`**:
- No `min`/`max` — computed dynamically
- Added `suitableFor` per category — drives eligibility
- Added `dessertFortified` category (extensibility)
- Display names extracted to constant (DRY)
- `FRIDGE_CAPACITY` removed — comes from storage area rows

### 4.2 CREATE: `src/services/cellar/fridgeAllocator.js`

**Purpose**: Compute dynamic par-levels and coordinate cross-area inventory reservation
**Principles**: Single Responsibility (#2), No Hardcoding (#8), Testability (#11)

Key exports:
```javascript
/**
 * Count ALL cellar wines by fridge category (including fridge wines).
 *
 * WHY include fridge wines: The allocator determines the target mix based on
 * what the user OWNS, not what's left to chill. If all 5 sparkling wines are
 * already in the fridge, we still want sparkling slots in the target.
 * Candidate selection (separate concern) handles what's available to move.
 *
 * @param {Array} allWines - ALL wines in the cellar (fridge + non-fridge)
 * @param {Function} categoriseFn - Wine categorisation function
 * @returns {Object} Counts by category, e.g. { sparkling: 3, crispWhite: 8, ... }
 */
export function countInventoryByCategory(allWines, categoriseFn)

/**
 * Compute par-levels for a specific fridge area.
 *
 * This is a PURE quota allocator — it determines how many slots each category
 * should get based on collection proportions. It has no urgency awareness;
 * urgency (drink-soon priority) is handled downstream by findSuitableWines()
 * when ranking candidates within each allocated category.
 *
 * Algorithm:
 * 1. Filter categories to those suitable for this storage type
 * 2. Filter further to categories with available stock
 * 3. Reserve flex slots: max(1, floor(capacity * 0.1))
 * 4. Allocate 1 floor-guarantee slot per stocked category
 * 5. Distribute remaining slots proportionally by inventory count
 * 6. Apply priority tiebreaker for fractional remainders
 * 7. Global stock cap: clamp to min(slots, stockCount - priorAllocations); excess → flex
 *
 * @param {Object} totalInventoryCounts - Wine counts by category (TOTAL collection)
 * @param {string} storageType - 'wine_fridge' or 'kitchen_fridge'
 * @param {number} capacity - Total slots in this fridge area
 * @param {Object} [priorAllocations={}] - Slots already targeted by prior areas per category.
 *   e.g. { sparkling: 2, crispWhite: 4 } means prior areas already targeted 2 sparkling
 *   and 4 crispWhite slots. Stock cap uses stockCount - priorAllocations to prevent
 *   collective over-targeting across areas.
 * @returns {Object} Computed par-levels: { [category]: { min, max, priority, ... } }
 */
export function computeParLevels(totalInventoryCounts, storageType, capacity, priorAllocations = {})

/**
 * Get eligible categories for a storage type.
 * @param {string} storageType - Storage type
 * @returns {Object} Filtered CATEGORY_REGISTRY entries
 */
export function getEligibleCategories(storageType)

/**
 * Get wines currently occupying a specific fridge area.
 * Pure in-memory filter on allWines — no DB call.
 *
 * PREREQUISITE: allWines must include `storage_area_id` from the slots join.
 * The existing getAllWinesWithSlots() query already joins the slots table;
 * it must SELECT s.storage_area_id so this filter works. See section 4.4
 * for the query change.
 *
 * @param {Array} allWines - All wines with slot data (must include storage_area_id)
 * @param {string} storageAreaId - UUID of the storage area
 * @returns {Array} Wines currently in this fridge area
 */
export function getWinesByArea(allWines, storageAreaId)

/**
 * Get candidate bottle-slots not in any fridge area and not already reserved.
 * Used during sequential multi-area planning to prevent double-booking.
 *
 * Keyed by SLOT ID (not wine ID) because a user can own multiple bottles of the
 * same wine. Reserving by wine ID would block all bottles after recommending one,
 * suppressing valid candidates for later areas.
 *
 * @param {Array} allWines - All wines with slot data (each entry is a bottle-slot)
 * @param {Set<string>} allFridgeAreaIds - All fridge storage area IDs
 * @param {Set<number>} reservedSlotIds - Slot IDs already recommended to prior areas
 * @returns {Array} Bottle-slots available as candidates
 */
export function getAvailableCandidates(allWines, allFridgeAreaIds, reservedSlotIds)

/**
 * Sort fridge areas by planning priority.
 * Wine fridges planned first (purpose-built, better temperature control).
 * Within same type, sort by capacity descending (larger fridge gets first pick).
 *
 * @param {Array} fridgeAreas - All fridge-type storage areas
 * @returns {Array} Sorted areas
 */
export function sortFridgeAreasByPriority(fridgeAreas)

/**
 * Detect misplaced fridge wines that should be transferred between areas.
 * Run AFTER all per-area analyses complete.
 *
 * A wine is "misplaced" if its category is ineligible for its current area's
 * storage type (e.g., chillableRed in kitchen_fridge). Transfer is suggested
 * only if another area exists where the category IS eligible and has capacity.
 *
 * @param {Array} fridgeAnalysisResults - Per-area analysis results
 * @param {Array} allFridgeAreas - All fridge-type storage areas with their wines
 * @returns {Array} Transfer suggestions: [{ wine, fromArea, toArea, category, reason }]
 */
export function detectFridgeTransfers(fridgeAnalysisResults, allFridgeAreas)
```

**Algorithm detail for `computeParLevels()`**:
```
Input: { sparkling: 3, crispWhite: 8, aromaticWhite: 0, textureWhite: 5,
         rose: 2, chillableRed: 12, dessertFortified: 1 }
Storage type: wine_fridge
Capacity: 18

Step 1 — Eligible categories: all 7 (wine_fridge allows all)
Step 2 — Stocked categories: 6 (aromaticWhite has 0, excluded)
Step 3 — Flex reserve: max(1, floor(18 * 0.1)) = 2 slots
Step 4 — Available for allocation: 18 - 2 = 16 slots
         Floor guarantees: 6 stocked categories * 1 = 6 slots
         Remaining: 16 - 6 = 10 slots
Step 5 — Proportional distribution of 10 remaining:
         Total stocked count: 3+8+5+2+12+1 = 31
         sparkling:       1 + round(3/31 * 10)  = 1 + 1 = 2
         crispWhite:      1 + round(8/31 * 10)  = 1 + 3 = 4
         textureWhite:    1 + round(5/31 * 10)  = 1 + 2 = 3
         rose:            1 + round(2/31 * 10)  = 1 + 1 = 2
         chillableRed:    1 + round(12/31 * 10) = 1 + 4 = 5
         dessertFortified:1 + round(1/31 * 10)  = 1 + 0 = 1
         Subtotal: 17 (1 over due to rounding)
Step 6 — Trim: remove 1 from lowest-priority category with >1 slot
         dessertFortified already at 1, chillableRed 5->4
         After trim: sparkling:2, crispWhite:4, textureWhite:3, rose:2,
                     chillableRed:4, dessertFortified:1, flex:2 = 18
Step 7 — Global stock cap: clamp to min(slots, stockCount - priorAllocations)
         priorAllocations = {} (first area, nothing prior)
         dessertFortified: min(1, 1-0) = 1 (ok)
         sparkling: min(2, 3-0) = 2 (ok)
         rose: min(2, 2-0) = 2 (ok)
         All within stock → no excess, flex stays at 2
         Final: sparkling:2, crispWhite:4, textureWhite:3, rose:2,
                chillableRed:4, dessertFortified:1, flex:2 = 18
```

**Global stock cap example** — Wine fridge (12 slots) then Kitchen fridge (6 slots), user has 3 sparkling:
```
AREA 1 (wine fridge, first):
  priorAllocations = {}
  sparkling: min(2, 3-0) = 2 → targets 2 sparkling slots

AREA 2 (kitchen fridge, second):
  priorAllocations = { sparkling: 2, ... }  ← accumulated from Area 1
  sparkling: min(1, 3-2) = 1 → targets 1 sparkling slot
  Combined: 2 + 1 = 3 = total stock ← never over-targets

Without global cap, Area 2 would also get min(1, 3) = 1, but the combined
target of 3 only works because stock happens to be exactly 3. With 2 sparkling:
  Area 1: min(2, 2-0) = 2
  Area 2: min(1, 2-2) = 0 → no sparkling target (stock exhausted), slot → flex
```

The same algorithm with `kitchen_fridge` and capacity 6:
```
Eligible: 4 categories (no textureWhite, chillableRed, dessertFortified)
Stocked: 3 (sparkling:3, crispWhite:8, rose:2; aromaticWhite:0)
Flex: max(1, floor(6*0.1)) = 1
Available: 5 slots, floor: 3, remaining: 2
  sparkling: 1 + round(3/13 * 2) = 1 + 0 = 1
  crispWhite: 1 + round(8/13 * 2) = 1 + 1 = 2
  rose: 1 + round(2/13 * 2) = 1 + 0 = 1
  flex: 1
  Total: 5 + 1 = 6
```

**Cross-area coordination example** — Wine fridge (12 slots) + Kitchen fridge (6 slots):
```
Total collection: sparkling:3, crispWhite:8, rose:2, chillableRed:4

AREA 1: Wine fridge (12 slots) — planned first
  priorAllocations = {}
  Par-levels: sparkling:2, crispWhite:4, rose:1, chillableRed:3, flex:2
  Global stock cap: sparkling min(2, 3-0)=2, rose min(1, 2-0)=1 (all ok)
  Candidates selected from non-fridge pool
  2 sparkling recommended → reservedSlotIds = {slot_F1, slot_F2}
  priorAllocations = { sparkling:2, crispWhite:4, rose:1, chillableRed:3 }

AREA 2: Kitchen fridge (6 slots) — planned second
  priorAllocations = { sparkling:2, crispWhite:4, rose:1, chillableRed:3 }
  Par-levels before cap: sparkling:1, crispWhite:2, rose:1, flex:1
  Global stock cap: sparkling min(1, 3-2)=1 ✓, crispWhite min(2, 8-4)=2 ✓,
                    rose min(1, 2-1)=1 ✓
  Candidates from non-fridge pool MINUS reservedSlotIds
  NOTE: If user has 3 sparkling bottles (slot_R2C1, slot_R2C2, slot_R2C3),
  only slot_F1 and slot_F2 are reserved — slot_R2C3 is still available.
  1 sparkling slot recommended → kitchen fridge gets slot_R2C3
  (No double-booking at target level OR candidate level)
```

### 4.3 MODIFY: `src/services/cellar/fridgeStocking.js`

**Changes**:
1. Import from `fridgeCategories.js` instead of `fridgeParLevels.js`
2. `categoriseWine()` — use `CATEGORY_REGISTRY` instead of `FRIDGE_PAR_LEVELS` (same logic, different source)
3. `calculateParLevelGaps()` — accept computed par-levels as parameter instead of reading global
4. `getFridgeStatus()` — accept computed par-levels
5. `analyseFridge()` — accept pre-computed par-levels and per-area wine lists as parameters (allocator is called externally by the orchestrator in cellarAnalysis route)
6. Remove `RED_FRIDGE_CATEGORIES` constant — replaced by `suitableFor` check
7. Remove `FRIDGE_CAPACITY` import — comes from storage area
8. `formatCategoryName()` — use `CATEGORY_DISPLAY_NAMES`
9. `findSuitableWines()` — accept candidate wine list (pre-filtered to exclude reserved wines) instead of full cellar wines

**Backward compatibility**: `analyseFridge()` requires `computedParLevels` in its options. There is no legacy fallback to static par-levels — `fridgeParLevels.js` is deleted entirely. The cellarAnalysis orchestrator is the only caller, and it always computes par-levels before calling `analyseFridge()`.

**No fridge configured**: If the user has no fridge-type storage areas at all (no `wine_fridge`, no `kitchen_fridge`), the orchestrator skips fridge analysis entirely. `fridgeAnalysis` is an empty array and `fridgeStatus` is `null`. The frontend already handles a missing/null `fridgeStatus` gracefully (hides the fridge section). This is the correct behavior — not every user has a fridge, and we should not fabricate a phantom 9-slot fridge for them.

**Legacy migration**: Existing users who had the old hardcoded 9-slot fridge before migration 038 will have a `wine_fridge` storage area created by that migration. New users go through onboarding which prompts them to define their storage areas (including whether they have a fridge). If they don't add a fridge, they simply don't get fridge analysis.

### 4.4 MODIFY: `src/routes/cellarAnalysis.js`

**Changes**:
1. Query ALL fridge areas via `getStorageAreasByType(cellarId)` (not just first via `LIMIT 1`)
2. Add `s.storage_area_id` to the `getAllWinesWithSlots()` SELECT list — this is the single data enrichment that enables all per-area filtering downstream (no separate per-area DB queries)
3. If no fridge areas exist → skip fridge analysis, set `fridgeAnalysis: []`, `fridgeStatus: null`
4. Compute `totalInventoryCounts` once from ALL wines (fridge + non-fridge)
5. Sort fridge areas by priority (`sortFridgeAreasByPriority()`)
6. Initialize `reservedSlotIds = new Set()` and `priorAllocations = {}`
7. Loop **sequentially** over each fridge area:
   a. Compute par-levels from total counts with `priorAllocations` for global stock cap
   b. Get per-area occupied wines via `getWinesByArea(allWines, area.id)` — pure in-memory filter on `storage_area_id`
   c. Get available candidates via `getAvailableCandidates(allWines, allFridgeAreaIds, reservedSlotIds)`
   d. Call `analyseFridge()` with area-scoped inputs
   e. Add recommended slot IDs to `reservedSlotIds`; accumulate category targets into `priorAllocations`
8. Run `detectFridgeTransfers()` across all area results — transfers consume destination gap/flex capacity; demoted candidates move to `alternatives`
9. Return `fridgeAnalysis: [{ areaId, areaName, storageType, ...status }]` + `transferSuggestions`
10. Keep `fridgeStatus` as alias for first entry (backward compat shim, not cellar-wide summary; `null` if no fridges)

### 4.5 MODIFY: `src/routes/cellar.js`

**Changes**:
1. `getFridgeStorageType()` → `getFridgeAreas()` — return all fridge areas with their type, capacity, and ID
2. `getEmptyFridgeSlots()` — accept required `storageAreaId` to scope per-area

**Data path for per-area wines**: There is ONE approach — enrich `allWines` with `storage_area_id`. The existing `getAllWinesWithSlots()` query in `cellarAnalysis.js` already joins the `slots` table. Add `s.storage_area_id` to its SELECT list. Then `getWinesByArea(allWines, areaId)` and `getAvailableCandidates(allWines, ...)` are pure in-memory filters — no separate DB queries needed per area. This avoids N+1 query patterns and keeps the data path simple.

No separate `getFridgeWinesByArea()` DB helper is needed. If a future caller outside the analysis pipeline needs per-area fridge wines independently, it can be added then.

### 4.6 DELETE: `src/config/fridgeParLevels.js`

Replaced entirely by `src/config/fridgeCategories.js`. Update all imports.

### 4.7 MODIFY: `src/config/cellarZones.js`

**Problem**: `CELLAR_ZONES.fridge` has hardcoded `slots: ['F1','F2',...,'F9']` and `capacity: 9`. This is served to the frontend via `GET /api/cellar/zones` and represents the last static fridge layout assumption in the codebase.

**Changes**:
1. Remove `slots` and `capacity` from the static `CELLAR_ZONES.fridge` definition — keep only `purpose` and `description`
2. In `src/routes/cellar.js` `GET /api/cellar/zones` endpoint, populate `fridge.slots` and `fridge.capacity` dynamically from `getStorageAreasByType(cellarId)` — query all fridge-type areas and build the slot list from their storage area rows

**Why**: The fridge zone's slot list and capacity must reflect the user's actual storage configuration, not a hardcoded 9-slot assumption. This completes the hardcoding audit from `docs/dp-plan.md`.

**Note**: The `/api/cellar/zones` endpoint currently takes no `cellarId` (it's a static config dump). This change makes it cellar-aware via `req.cellarId` from middleware, which is already available on the route.

---

## 5. Risk & Trade-off Register

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Proportional allocation gives weird results for very small fridges (3 slots) | Medium | Floor guarantee of 1 per stocked category, but cap at capacity. If capacity < stocked categories, allocate by priority only |
| Breaking change for `fridgeStatus` shape in frontend | High | Keep `fridgeStatus` as backward-compat alias; frontend consumes same shape |
| Performance: computing par-levels on every analysis call | Low | Computation is O(categories * wines) — trivial. No DB calls needed |
| Edge case: user has 0 cellar wines of any fridge category | Low | Return all zeros, no gaps flagged — fridge shows current contents only |
| Category registry grows large | Low | Registry is data, not logic — 10-15 entries is fine |
| Cross-area candidate reservation is order-dependent | Low | Wine fridges always get first pick (purpose-built). Within same type, larger fridge goes first. This is a reasonable default; user preference override is deferred |
| Per-area queries add DB load for multi-fridge users | Low | At most 2-3 fridge areas per cellar. `storage_area_id` is already indexed |

### Deliberately Deferred

1. **User preference weighting** — Future: let users say "I want more sparkling in my fridge". For now, inventory proportions are objective and fair.
2. **Seasonal adjustment** — Future enhancement, not needed for correctness.
3. **Multi-zone wine fridge** — Some wine fridges have dual zones (upper cold, lower cool). Could be modeled as two logical areas with different `temp_zone`. Deferred until a user requests it.
4. **Frontend multi-fridge UI** — The backend will return `fridgeAnalysis[]` array. Frontend can initially just render the first entry, with multi-fridge UI as a follow-up.
5. **Cross-area global optimization** — The sequential priority approach is simple and good enough. A full optimization (e.g., "minimize total temperature mismatch across all areas") is over-engineered for 2-3 areas.

---

## 6. Testing Strategy

### Unit Tests

**`tests/unit/config/fridgeCategories.test.js`**:
- Every category has `suitableFor`, `matchRules`, `priority`
- `suitableFor` only contains valid storage types
- `CATEGORY_DISPLAY_NAMES` covers all registry entries + flex
- `FRIDGE_CATEGORY_ORDER` covers all registry entries + flex

**`tests/unit/services/cellar/fridgeAllocator.test.js`** (most critical):
- `getEligibleCategories('wine_fridge')` includes all categories
- `getEligibleCategories('kitchen_fridge')` excludes textureWhite, chillableRed, dessertFortified
- `computeParLevels()` with 9-slot wine fridge — totals match capacity
- `computeParLevels()` with 6-slot kitchen fridge — no red categories
- `computeParLevels()` with 48-slot wine fridge — proportional scaling
- `computeParLevels()` with 3-slot fridge — graceful degradation (priority-only allocation)
- `computeParLevels()` with 0 inventory — empty par-levels, flex gets all
- `computeParLevels()` with 1 category stocked — that category + flex
- Invariant: sum of all min values + flex = capacity (always)
- Stock cap (single area): no category gets more slots than its stock count; excess goes to flex
- Stock cap (single area): user with 1 sparkling, 48-slot fridge → sparkling gets 1 slot
- Global stock cap: second area gets `min(slots, stock - priorAllocations)` per category
- Global stock cap: two fridges collectively never target more than total stock per category
- `countInventoryByCategory()` counts ALL wines (including fridge wines)
- `countInventoryByCategory()` — fridge wines are NOT excluded from counts
- `getWinesByArea()` — returns only wines matching the given storage_area_id
- `getAvailableCandidates()` — excludes wines in any fridge area AND reserved slot IDs
- `getAvailableCandidates()` — multi-bottle wine: reserving one slot does NOT block other slots of same wine
- `sortFridgeAreasByPriority()` — wine_fridge before kitchen_fridge, larger capacity first

**`tests/unit/services/cellar/fridgeAllocator.crossArea.test.js`** (new):
- Two-area scenario: same wine is NOT recommended to both areas
- Wine fridge gets priority access to candidate pool
- Total recommendations across areas ≤ total available candidates
- Reserved slot IDs accumulate correctly across sequential area planning
- Multi-bottle wine: both fridges can each get one bottle of the same wine
- `detectFridgeTransfers()` — chillable red in kitchen_fridge → suggested transfer to wine_fridge
- `detectFridgeTransfers()` — sparkling in wine_fridge with kitchen_fridge gap → NO transfer (not misplaced)
- `detectFridgeTransfers()` — no transfer suggested when destination has no remaining capacity
- `detectFridgeTransfers()` — transfer consumes destination gap; candidate for same gap demoted to alternative
- `detectFridgeTransfers()` — no conflicting advice: never both "add wine X" and "transfer wine Y" for same slot

**`tests/unit/services/cellar/fridgeStocking.test.js`** (update existing):
- `categoriseWine()` — add dessertFortified test cases
- `calculateParLevelGaps()` — pass computed par-levels instead of relying on global
- `analyseFridge()` with pre-computed par-levels and area-scoped wine lists
- `analyseFridge()` with kitchen_fridge — no red candidates in output
- `analyseFridge()` without par-levels → throws (no silent fallback)

### Integration Tests

- Full analysis endpoint with wine_fridge storage area → `fridgeAnalysis[0]` has computed par-levels
- Full analysis with both wine_fridge + kitchen_fridge → `fridgeAnalysis` has 2 entries
- Multi-area: no wine appears in candidates for both areas
- Backward compat: `fridgeStatus` still present as alias (= first area, not cellar-wide)

### Edge Cases

- Cellar with no fridge area configured → skip fridge analysis, `fridgeAnalysis: []`, `fridgeStatus: null`
- Fridge area with 0 rows / 0 capacity → skip, don't crash
- All fridge slots occupied → gaps computed but no candidates (swap suggestions only)
- Wine matches multiple categories → first match by priority wins (existing behavior)
- All wines of a category are already chilled → par-level still allocates slots, gap shows 0 (target met)
- More fridge capacity than total wines → stock cap clamps categories, excess goes to flex
- Two fridges with combined capacity exceeding cellar size → global stock cap prevents collective over-targeting; later areas get reduced targets (not impossible gaps) and fewer candidates
- Chillable red in kitchen fridge with wine fridge available → transfer suggestion surfaced
- User has no fridge at all → `fridgeAnalysis: []`, `fridgeStatus: null`, no errors

---

## Appendix: Review Feedback Resolution

### Resolved Issues (from rev 1 review)

| # | Finding | Severity | Resolution |
|---|---------|----------|-----------|
| 1 | Cross-area double-counting: same wine recommended to multiple fridges | High | Sequential planning with `reservedWineIds` set. Each area consumes candidates from a shrinking pool. See Decision 4, Data Flow steps. |
| 2 | `countInventoryByCategory()` excluded fridge wines, causing target collapse when all of a category is chilled | High | Renamed to count ALL wines (fridge + non-fridge). Allocator uses total collection for targets; candidate selector (separate function) filters to available-to-move wines. See Decision 2. |
| 3 | No per-area occupied bottle attribution | High | `getWinesByArea()` uses `storage_area_id` join (already in schema since migration 038). Each area's gap analysis compares par-levels against its own bottles only. See Decision 5, section 4.5. |
| 4 | Internal inconsistency: data flow vs file plan on where allocator is called; drink-soon urgency mentioned but not parameterized | Medium | Clarified: allocator is called externally by orchestrator in cellarAnalysis route (not inside `analyseFridge()`). Urgency mention removed from `computeParLevels` — it's a pure quota allocator. Urgency is handled by `findSuitableWines()` when ranking candidates. See section 4.2 `computeParLevels` JSDoc, section 4.4. |

### Resolved Issues (from rev 2 review)

| # | Finding | Severity | Resolution |
|---|---------|----------|-----------|
| 5 | No stock cap: category can get more slots than wines owned | High | Added step 7 to algorithm: `min(allocatedSlots, stockCount)`, excess → flex. See Decision 2 algorithm, detailed example in section 4.2. |
| 6 | No fridge-to-fridge transfer suggestions for misplaced wines | High | Added `detectFridgeTransfers()` post-analysis pass. Identifies category-ineligible wines (e.g., chillable red in kitchen fridge) and suggests transfers. See Decision 8. |
| 7 | Two competing reservation models (`remainingInventory` vs `reservedWineIds`) | Medium | Unified on `reservedWineIds` (Set of wine IDs). Data flow, API exports, and orchestrator all use the same model. See updated Data Flow section. |
| 8 | Backward compat claims fallback to deleted `fridgeParLevels.js` | Medium | Removed fallback. `analyseFridge()` requires computed par-levels (no silent fallback). No-fridge users get `fridgeAnalysis: []`, `fridgeStatus: null`. See section 4.3 backward compatibility notes. |

### Resolved Issues (from rev 3 review)

| # | Finding | Severity | Resolution |
|---|---------|----------|-----------|
| 9 | Stock cap is per-area only — two fridges can collectively over-target a category | High | Made stock cap global via `priorAllocations` parameter. `computeParLevels()` now accepts prior area targets and clamps to `min(slots, stock - priorAllocations[cat])`. Orchestrator accumulates `priorAllocations` as each area is planned. See updated algorithm step 7, data flow, and global stock cap example in section 4.2. |
| 10 | `detectFridgeTransfers()` doesn't consume destination capacity — conflicting advice possible | High | Transfers now consume destination gap/flex capacity. When a transfer fills a gap, the candidate for that gap is demoted to `alternatives`. No slot can have both a candidate and a transfer. See updated Decision 8. |
| 11 | Two data paths for per-area wines: `allWines` filter vs `getFridgeWinesByArea()` DB helper | Medium | Unified on single path: enrich `allWines` with `storage_area_id` (add to SELECT in `getAllWinesWithSlots()`). `getWinesByArea()` and `getAvailableCandidates()` are pure in-memory filters. Removed `getFridgeWinesByArea()` DB helper. See updated sections 4.2, 4.4, 4.5. |

### Resolved Issues (from rev 4 review)

| # | Finding | Severity | Resolution |
|---|---------|----------|-----------|
| 12 | Reservation keyed by `wineId` blocks all bottles of multi-bottle wines after reserving one | High | Changed reservation key from `wineId` to `slotId`. Each recommendation reserves a specific bottle-slot, not the wine. A user with 3 bottles of the same wine can have different bottles recommended to different areas. Updated `reservedWineIds` → `reservedSlotIds` throughout data flow, orchestrator, `getAvailableCandidates()`, and test cases. |

### Resolved Open Questions

| Question | Answer | Rationale |
|----------|--------|-----------|
| Total collection vs non-fridge inventory for targets? | **Total collection** for allocation targets. Non-fridge only for candidate selection. | If all sparkling is already chilled, we still want sparkling slots. The allocator answers "what should the fridge look like?" — the candidate selector answers "what can we move?" Two separate concerns. |
| Independent per-fridge plans or one coordinated plan? | **Coordinated sequential**: par-levels from total counts (stable), candidates from shrinking pool (exclusive). | Avoids double-counting. Simple — no global optimization needed. Wine fridges get priority (purpose-built). |
| Is `fridgeStatus` a cellar-wide summary or first-area shim? | **First-area shim only.** Not a cellar-wide aggregation. | Aggregating gaps across areas with different temperature profiles produces misleading results. The frontend currently consumes a single-area shape; `fridgeAnalysis[]` provides the full picture for a future multi-fridge UI. |
