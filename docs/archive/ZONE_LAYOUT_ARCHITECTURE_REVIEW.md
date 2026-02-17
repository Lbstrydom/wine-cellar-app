# Zone Layout Architecture — Problem Statement & Root Cause Analysis

## For External Code Review

**Date**: 16 February 2026
**Context**: The wine cellar app manages ~170 slots across 19 rows. Wines are classified into ~25 zones (e.g. Sauvignon Blanc, Chenin Blanc, Southern France, Cabernet). Zones are allocated physical rows. The system has a persistent problem where zone-to-row allocation becomes wildly inefficient and the "Adjust Zone Layout" feature fails to fix it.

---

## The Visible Problem

Looking at the current cellar grid:

| Row | Zone | Bottles | Capacity | Utilization |
|-----|------|---------|----------|-------------|
| R1  | Sauvignon Blanc | 4 | 7 | 57% |
| R3  | (empty — also Sauv Blanc) | 0 | 9 | 0% |
| R4  | Sauvignon Blanc | 8 | 9 | 89% |
| R5  | Sauvignon Blanc | 2 | 9 | 22% |
| R2  | White Reserve | 6 | 9 | 67% |
| R6  | White Reserve | 5 | 9 | 56% |
| R7  | White Reserve (empty) | 0 | 9 | 0% |

**Sauvignon Blanc** has 4 rows allocated (R1, R3, R4, R5) with ~14 bottles. It needs at most 2 rows (capacity 16). Rows R3 and R5 are nearly empty.

**White Reserve** is fragmented across rows 2, 6, and 7 — wines scattered wherever gaps existed, not grouped together.

When the user clicks "Adjust Zone Layout", the system proposes only a trivial swap (e.g. swap R9/R10 for colour adjacency), completely ignoring the massive over-provisioning and fragmentation. Running it again reverses the swap. The real problems are never addressed.

---

## Architecture Overview

The system has four independent subsystems that should work together but don't:

```
┌─────────────────────────────────────────────────────────────┐
│  1. INITIAL LAYOUT            2. INCREMENTAL ALLOCATION     │
│  zoneLayoutProposal.js        cellarAllocation.js           │
│  ─────────────────            ────────────────              │
│  Runs once at setup.          Runs when placing bottles.    │
│  Allocates rows based on      Only ADDS rows to zones.      │
│  actual bottle counts.        Never REMOVES surplus rows.   │
│  Result: correct layout.      Result: row bloat over time.  │
│                                                             │
│  3. ANALYSIS / DETECTION      4. RECONFIGURATION PLANNER   │
│  cellarAnalysis.js            rowAllocationSolver.js +      │
│  cellarMetrics.js             zoneReconfigPlanner.js        │
│  ─────────────────            ─────────────────────         │
│  Detects misplaced wines,     Only fixes OVERFLOWS.          │
│  scattered wines, colour      Never right-sizes surplus.     │
│  violations.                  consolidateScattered() is a   │
│  Does NOT detect/report       stub (returns []).             │
│  zone over-provisioning.      Result: trivial/no changes.   │
└─────────────────────────────────────────────────────────────┘
```

---

## Root Cause #1: Rows Are Only Added, Never Reclaimed

**Files**: `src/services/cellar/cellarAllocation.js`

The system has an asymmetric growth model:

- **Adding rows** (`allocateRowToZone`, line 64): When a wine needs a slot and its zone's rows are full, a new row is allocated to the zone. This triggers automatically during bottle placement.

- **Removing rows** (`updateZoneWineCount`, line 167): Rows are only freed when a zone's `wine_count` drops to **zero**. The function decrements the count and only deletes the allocation at zero:

```javascript
// Line 182-189 — the ONLY shrink path
if (delta < 0) {
  const allocation = await db.prepare(
    'SELECT wine_count FROM zone_allocations WHERE cellar_id = ? AND zone_id = ?'
  ).get(cellarId, zoneId);
  if (allocation && allocation.wine_count <= 0) {
    await db.prepare('DELETE FROM zone_allocations ...').run(cellarId, zoneId);
  }
}
```

**Consequence**: If Sauvignon Blanc once had 30 bottles justifying 4 rows, then the user drank 16, the zone still holds 4 rows for 14 bottles. There is no mechanism that says "this zone has 14 bottles in 4 rows (capacity 36), give back 2 rows."

**What should exist**: A periodic or on-demand "right-sizing" step: `if (zone.rows.length > ceil(zone.bottles / rowCapacity)) { reclaim surplus rows }`.

---

## Root Cause #2: White Reserve Is a Buffer Zone (No Dedicated Rows)

**Files**: `src/config/cellarZones.js`, `src/services/cellar/cellarAllocation.js`

The `white_buffer` (White Reserve) zone has `isBufferZone: true`. Buffer zones are explicitly excluded from dedicated row allocation:

```javascript
// cellarAllocation.js lines 42-49
export async function getZoneRows(zoneId, cellarId) {
  const zone = getZoneById(zoneId);
  if (zone.isBufferZone || zone.isFallbackZone || zone.isCuratedZone) {
    return [];  // Buffer zones NEVER get dedicated rows
  }
  // ...
}
```

When `findAvailableSlot()` places a White Reserve wine, it searches for ANY empty slot across the entire white row range (rows 1-7). With no dedicated rows, wines land wherever gaps exist — hence fragmentation across rows 2, 6, and 7.

**Design intent**: Buffer zones were meant as overflow areas — "put it wherever there's space." But when a buffer zone holds 11+ bottles, it needs its own rows like any regular zone.

**What should exist**: Either (a) promote White Reserve to a regular zone when it exceeds a threshold (e.g. 5 bottles), or (b) make `findAvailableSlot()` prefer adjacency — place buffer wines next to other wines of the same buffer zone.

---

## Root Cause #3: Reconfiguration Planner Only Reacts to Overflows

**Files**: `src/services/zone/rowAllocationSolver.js`, `src/services/zone/zoneReconfigurationPlanner.js`

The reconfiguration pipeline has three layers, and ALL of them share the same blind spot — they only act when a zone is overflowing (needs MORE rows), never when a zone has surplus rows:

### Layer 1: Deterministic Solver (`rowAllocationSolver.js`)

The demand calculation IS correct:
```javascript
// Line 158-168 — computeDemand()
demand = Math.ceil(bottles / SLOTS_PER_ROW)
// Sauvignon Blanc: ceil(14/9) = 2 rows needed
```

But the deficit detection only looks at POSITIVE shortfall:
```javascript
// Line 569-576 — resolveCapacityDeficits()
const shortfall = required - currentRows.length;
if (shortfall > 0) {           // ← ONLY positive!
  deficits.push({ zoneId, shortfall });
}
// Sauvignon Blanc: 2 - 4 = -2 (negative, IGNORED)
```

The solver knows Sauvignon Blanc needs only 2 rows. It knows Sauvignon Blanc has 4 rows. But it never generates an action to reclaim the 2 surplus rows because it only processes positive deficits.

### Layer 2: LLM Refinement

The LLM does receive underutilized zone data as context. But the LLM can only propose actions that pass `filterLLMActions()` validation, and the LLM is told to be conservative. In practice, it rarely proposes aggressive right-sizing.

### Layer 3: Heuristic Gap-Fill

Only triggers for overflowing zones:
```javascript
// Line 541-543 — heuristicGapFill()
for (const issue of capacityIssues) {
  const toZoneId = issue.overflowingZoneId;  // ← Only overflows!
  // ...
}
```

If no zone is overflowing, this layer does nothing.

### Stub Function

The function that should consolidate scattered wines is an empty stub:
```javascript
// Line 789-798 — consolidateScatteredWines()
function consolidateScatteredWines(zoneRowMap, scatteredWines, ...) {
  if (stabilityBias === 'high') return [];
  if (!scatteredWines || scatteredWines.length === 0) return [];
  // "Scattered wine consolidation is handled by capacity rebalancing"
  return [];  // ← Does NOTHING
}
```

### Net Result

When no zone is actively overflowing:
- Solver produces 0 deficit-fixing actions
- Only colour boundary swaps (the trivial R9/R10 swap) are generated
- Heuristic gap-fill produces 0 actions
- The user sees a plan with 1-2 trivial swaps that accomplish nothing

---

## Root Cause #4: Analysis Doesn't Report Over-Provisioning

**Files**: `src/services/cellar/cellarAnalysis.js`, `src/services/cellar/cellarMetrics.js`

The analysis detects:
- ✅ Misplaced wines (wrong zone)
- ✅ Colour violations (red in white row)
- ✅ Scattered wines (same wine type across non-adjacent rows)
- ✅ Colour adjacency issues

The analysis does NOT detect or report:
- ❌ Zone over-provisioning (4 rows for 14 bottles)
- ❌ Zone utilization percentage
- ❌ Wasted capacity

Since the analysis doesn't surface this as a problem, the reconfiguration planner doesn't receive it as an input, and the user is never told "Sauvignon Blanc has 4 rows but only needs 2."

---

## What the Recent 5-Phase Fix Actually Addressed

The 5-phase fix (commits `9c8e049` and `9f775b8`) addressed **wine classification accuracy** — ensuring wines are assigned to the correct zone:

| Phase | What it fixed | Relevant to layout problem? |
|-------|--------------|---------------------------|
| 1. Eligibility gates | Reds no longer classified into white zones, country contradictions blocked | ❌ No — classification, not allocation |
| 2. Classifier unification | Two classifiers that could disagree merged into one | ❌ No — classification, not allocation |
| 3. Row allocation safety | Cross-colour row allocation blocked, buffer zone colour checks added | ⚠️ Partially — prevents new bad allocations but doesn't fix existing ones |
| 4. zone_id trust hardening | Stale zone_id values detected, AI colour options expanded | ❌ No — detection accuracy |
| 5. Identity enforcement | Duplicate placements detected, rejection reasons added | ❌ No — diagnostics |

**The 5-phase fix ensures wines go to the RIGHT zone. It does NOT address how many rows each zone gets.** The layout over-provisioning is an entirely separate problem in the allocation subsystem.

---

## The Feedback Loop (Why It Never Self-Corrects)

```
User drinks wine → wine_count decreases → updateZoneWineCount()
                                                  |
                                        wine_count > 0?
                                         /            \
                                       YES             NO
                                        |               |
                                  Do nothing.      Delete allocation.
                                  Keep all rows.   (This almost never happens
                                                    because zones rarely
                                                    reach zero bottles.)
                                        |
                                        v
                              User runs "Adjust Layout"
                                        |
                              computeDemand() says "needs 2 rows"
                              currentRows = 4
                              shortfall = 2 - 4 = -2 (NEGATIVE)
                                        |
                              if (shortfall > 0) ← FALSE
                                        |
                              Do nothing. Keep 4 rows.
                                        |
                              User sees trivial swap plan.
                              User is frustrated.
                              Repeat.
```

---

## What Needs to Be Built

### Critical (fixes the core problem)

1. **Proactive right-sizing in the solver**: Add a phase in `resolveCapacityDeficits()` that handles NEGATIVE shortfall:
   ```
   if (shortfall < 0) → generate reallocate_row actions to free surplus rows
   ```

2. **Buffer zone promotion**: When a buffer zone (White Reserve) has more than N bottles (e.g. 5), allocate it dedicated rows like a regular zone instead of scattering across gaps.

3. **Report over-provisioning in analysis**: Add a "zone efficiency" metric to the analysis report so the reconfiguration planner and user can see the problem.

### Important (improves quality)

4. **Implement `consolidateScatteredWines()`**: The stub exists but does nothing. This should generate move suggestions to group scattered wines into adjacent rows.

5. **Analysis-driven reconfiguration**: Feed the analysis report's zone utilization data into the reconfiguration planner as a primary input, not just as LLM context.

6. **Incremental shrink on bottle removal**: When `updateZoneWineCount()` reduces the count, check if the zone now has surplus rows and free them immediately, rather than waiting for a manual reconfiguration.

### Nice to have

7. **Configurable thresholds**: The 40% underutilization threshold, 5-bottle merge threshold, and 25% merge utilization threshold are all hardcoded. Make them configurable.

8. **Row 1 capacity**: The solver uses `SLOTS_PER_ROW = 9` globally, but Row 1 only has 7 slots. This causes minor capacity miscalculations.

---

## Files to Examine

| File | Lines of Interest | What to Look For |
|------|-------------------|-----------------|
| `src/services/cellar/cellarAllocation.js` | 64-125, 167-190 | Row add (only grows), wine count update (only deletes at zero) |
| `src/services/zone/rowAllocationSolver.js` | 158-168, 564-576, 789-798 | Demand calc, positive-only deficit check, stub consolidation |
| `src/services/zone/zoneReconfigurationPlanner.js` | 111-114, 512-543, 635+ | Underutilized detection, overflow-only gap-fill, plan generation |
| `src/services/cellar/cellarAnalysis.js` | 41-224, 287-303 | Analysis report (no over-provisioning metric), buffer zone handling |
| `src/services/cellar/cellarMetrics.js` | 222-260 | Zone analysis and placement checks |
| `src/config/cellarZones.js` | Zone definitions | `isBufferZone: true` on white_buffer and red_buffer |
| `src/services/zone/zoneLayoutProposal.js` | 98-175 | Initial layout (correct, uses bottle counts) |

---

## Summary

The system was designed with a "grow-only" allocation model. Zones acquire rows as bottles are added but never release them as bottles are consumed. The reconfiguration planner was built to handle acute problems (overflows) but not chronic inefficiency (over-provisioning). The one function meant to consolidate scattered wines is an empty stub. The analysis system doesn't detect or report zone over-provisioning, so neither the planner nor the user knows it's happening. The result is a layout that degrades over time and a "fix layout" button that proposes nothing useful.
