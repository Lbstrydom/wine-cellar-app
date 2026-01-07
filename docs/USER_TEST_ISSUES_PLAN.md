# Move Integrity & Placement Guidance - Implementation Plan

**Date**: 7 January 2026
**Priority**: P1-Critical (data loss bug)
**Root Cause**: Suggested moves can target the same slot, causing bottle overwrites

---

## Problem Statement

When executing suggested moves from Cellar Analysis:
1. Two moves can target the same slot → one bottle gets overwritten/lost
2. Target slots may become occupied between suggestion and execution
3. No validation prevents these collisions
4. No atomic transaction wrapping means partial failures corrupt state

---

## Implementation Tasks

### Task 1: Add Move Plan Validation Function

**File**: `src/services/movePlanner.js`

Add a comprehensive validation function that checks:

```javascript
/**
 * Validate a move plan against current occupancy.
 * @param {Array} moves - Array of {wineId, from, to} objects
 * @returns {Promise<Object>} {valid: boolean, errors: Array<{type, message, move}>}
 */
export async function validateMovePlan(moves) {
  const errors = [];
  const targetSlots = new Set();
  const movedWineIds = new Set();

  // Fetch current occupancy from DB
  const slots = await db.prepare(
    'SELECT location_code, wine_id FROM slots WHERE wine_id IS NOT NULL'
  ).all();
  const occupiedSlots = new Map(slots.map(s => [s.location_code, s.wine_id]));

  // Build set of slots that will be vacated by this plan
  const vacatedSlots = new Set(moves.map(m => m.from));

  for (const move of moves) {
    // Rule 1: Each wine can only be moved once
    if (movedWineIds.has(move.wineId)) {
      errors.push({
        type: 'duplicate_wine',
        message: `Wine ID ${move.wineId} appears in multiple moves`,
        move
      });
    }
    movedWineIds.add(move.wineId);

    // Rule 2: Each target slot can only be used once
    if (targetSlots.has(move.to)) {
      errors.push({
        type: 'duplicate_target',
        message: `Slot ${move.to} is target of multiple moves`,
        move
      });
    }
    targetSlots.add(move.to);

    // Rule 3: Target must be empty OR will be vacated by another move in this plan
    const occupant = occupiedSlots.get(move.to);
    if (occupant && !vacatedSlots.has(move.to)) {
      errors.push({
        type: 'target_occupied',
        message: `Slot ${move.to} is occupied by wine ${occupant}`,
        move
      });
    }

    // Rule 4: Source must contain the expected wine
    const sourceOccupant = occupiedSlots.get(move.from);
    if (sourceOccupant !== move.wineId) {
      errors.push({
        type: 'source_mismatch',
        message: `Wine ${move.wineId} not found at ${move.from} (found ${sourceOccupant || 'empty'})`,
        move
      });
    }

    // Rule 5: No-op moves are wasteful
    if (move.from === move.to) {
      errors.push({
        type: 'noop_move',
        message: `Move from ${move.from} to ${move.to} is a no-op`,
        move
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    summary: {
      totalMoves: moves.length,
      errorCount: errors.length,
      duplicateTargets: errors.filter(e => e.type === 'duplicate_target').length,
      occupiedTargets: errors.filter(e => e.type === 'target_occupied').length
    }
  };
}
```

---

### Task 2: Update Move Suggestion Generation

**File**: `src/services/cellarAnalysis.js`

Modify `generateMoveSuggestions()` to track allocated targets:

```javascript
async function generateMoveSuggestions(misplacedWines, allWines, _slotToWine) {
  // Build canonical occupancy from DB, not from passed-in data
  const slotsFromDb = await db.prepare(
    'SELECT location_code, wine_id FROM slots WHERE wine_id IS NOT NULL'
  ).all();
  const occupiedSlots = new Set(slotsFromDb.map(s => s.location_code));

  // Track slots we've allocated in THIS suggestion batch
  const allocatedTargets = new Set();

  const suggestions = [];

  for (const wine of sortedMisplaced) {
    // Calculate effective occupancy = DB occupied + newly allocated - sources being vacated
    const effectiveOccupied = new Set([...occupiedSlots, ...allocatedTargets]);

    // Remove slots that will be vacated by earlier moves in this batch
    suggestions.forEach(s => {
      if (s.type === 'move') effectiveOccupied.delete(s.from);
    });

    const slot = await findAvailableSlot(wine.suggestedZoneId, effectiveOccupied, wine);

    if (slot && !allocatedTargets.has(slot.slotId)) {
      suggestions.push({
        type: 'move',
        wineId: wine.wineId,
        wineName: wine.name,
        from: wine.currentSlot,
        to: slot.slotId,
        // ... rest of properties
      });

      // Mark this slot as allocated so no other move can target it
      allocatedTargets.add(slot.slotId);
    } else {
      suggestions.push({
        type: 'manual',
        // ... manual intervention required
      });
    }
  }

  return suggestions;
}
```

---

### Task 3: Make Move Execution Atomic with Validation

**File**: `src/routes/cellar.js`

Replace the current `/execute-moves` endpoint:

```javascript
import { validateMovePlan } from '../services/movePlanner.js';

router.post('/execute-moves', async (req, res) => {
  try {
    const { moves } = req.body;
    if (!Array.isArray(moves) || moves.length === 0) {
      return res.status(400).json({ error: 'Moves array required' });
    }

    // Step 1: Validate the move plan
    const validation = await validateMovePlan(moves);
    if (!validation.valid) {
      return res.status(409).json({
        error: 'Move plan validation failed',
        conflicts: validation.errors,
        summary: validation.summary,
        hint: 'Cellar state may have changed. Please refresh and regenerate suggestions.'
      });
    }

    // Step 2: Count bottles before (for invariant check)
    const beforeCount = await db.prepare(
      'SELECT COUNT(*) as count FROM slots WHERE wine_id IS NOT NULL'
    ).get();

    // Step 3: Execute moves in a transaction
    await db.prepare('BEGIN TRANSACTION').run();

    try {
      const results = [];

      for (const move of moves) {
        // Clear source slot
        await db.prepare(
          'UPDATE slots SET wine_id = NULL WHERE location_code = ? AND wine_id = ?'
        ).run(move.from, move.wineId);

        // Set target slot (only if empty - extra safety)
        const targetCheck = await db.prepare(
          'SELECT wine_id FROM slots WHERE location_code = ?'
        ).get(move.to);

        if (targetCheck?.wine_id !== null) {
          throw new Error(`Target slot ${move.to} became occupied during execution`);
        }

        await db.prepare(
          'UPDATE slots SET wine_id = ? WHERE location_code = ?'
        ).run(move.wineId, move.to);

        // Update wine zone
        if (move.zoneId) {
          await db.prepare(
            'UPDATE wines SET zone_id = ?, zone_confidence = ? WHERE id = ?'
          ).run(move.zoneId, move.confidence || 'medium', move.wineId);
        }

        results.push({ wineId: move.wineId, from: move.from, to: move.to, success: true });
      }

      // Step 4: Verify bottle count invariant
      const afterCount = await db.prepare(
        'SELECT COUNT(*) as count FROM slots WHERE wine_id IS NOT NULL'
      ).get();

      if (afterCount.count !== beforeCount.count) {
        throw new Error(
          `Bottle count changed: ${beforeCount.count} → ${afterCount.count}. Rolling back.`
        );
      }

      await db.prepare('COMMIT').run();

      // Step 5: Invalidate analysis cache
      await invalidateAnalysisCache();

      res.json({
        success: true,
        moved: results.length,
        results,
        bottleCount: afterCount.count
      });

    } catch (txError) {
      await db.prepare('ROLLBACK').run();
      throw txError;
    }

  } catch (err) {
    console.error('[CellarAPI] Execute moves error:', err);
    res.status(500).json({ error: err.message });
  }
});
```

---

### Task 4: Add Database Constraint (PostgreSQL)

**File**: `data/migrations/025_slot_uniqueness.sql`

```sql
-- Ensure only one wine can occupy a slot
-- The slots table already has location_code as PK, but we need to ensure
-- wine_id appears at most once across all slots

-- Create a partial unique index: each wine_id can only appear once
-- (NULL wine_ids are allowed multiple times)
CREATE UNIQUE INDEX IF NOT EXISTS idx_slots_wine_unique
ON slots (wine_id)
WHERE wine_id IS NOT NULL;

-- Add comment explaining constraint
COMMENT ON INDEX idx_slots_wine_unique IS
  'Ensures each wine can only be in one slot at a time. Prevents move collisions.';
```

---

### Task 5: Persist Move Plans with Analysis Cache

**File**: `src/services/cacheService.js`

Add move plan persistence:

```javascript
/**
 * Cache suggested moves along with analysis.
 * @param {Array} moves - Suggested moves
 * @param {string} slotHash - Current slot hash for validation
 */
export async function cacheSuggestedMoves(moves, slotHash) {
  try {
    await db.prepare(`
      INSERT INTO cellar_analysis_cache (analysis_type, analysis_data, slot_hash, wine_count)
      VALUES ('suggested_moves', ?, ?, ?)
      ON CONFLICT(analysis_type) DO UPDATE SET
        analysis_data = excluded.analysis_data,
        slot_hash = excluded.slot_hash,
        created_at = CURRENT_TIMESTAMP
    `).run(JSON.stringify(moves), slotHash, moves.length);
  } catch (err) {
    logger.warn('Cache', `Move plan cache failed: ${err.message}`);
  }
}

/**
 * Get cached move plan if still valid.
 * @returns {Promise<Array|null>} Cached moves or null if stale
 */
export async function getCachedMoves() {
  try {
    const cached = await db.prepare(`
      SELECT analysis_data, slot_hash FROM cellar_analysis_cache
      WHERE analysis_type = 'suggested_moves'
    `).get();

    if (cached) {
      const currentHash = await generateSlotHash();
      if (cached.slot_hash === currentHash) {
        return JSON.parse(cached.analysis_data);
      }
      // Stale - invalidate
      await db.prepare(
        "DELETE FROM cellar_analysis_cache WHERE analysis_type = 'suggested_moves'"
      ).run();
    }
  } catch (err) {
    logger.warn('Cache', `Move cache lookup failed: ${err.message}`);
  }
  return null;
}
```

---

### Task 6: Add Placement Recommendations for New Bottles

**File**: `src/services/cellarPlacement.js` (update existing)

```javascript
/**
 * Recommend placement slots for a new bottle.
 * Uses cached analysis if available, otherwise runs lightweight placement logic.
 * @param {Object} wine - Wine object with colour, style, zone_id, etc.
 * @param {number} [count=3] - Number of recommendations to return
 * @returns {Promise<Array>} Recommended slots with reasons
 */
export async function recommendPlacement(wine, count = 3) {
  // Get current occupancy
  const occupied = await db.prepare(
    'SELECT location_code FROM slots WHERE wine_id IS NOT NULL'
  ).all();
  const occupiedSet = new Set(occupied.map(s => s.location_code));

  // Determine target zone
  const bestZone = findBestZone(wine);

  // Get zone layout
  const zoneRows = await db.prepare(
    'SELECT assigned_rows FROM zone_layout WHERE zone_id = ?'
  ).get(bestZone.zoneId);

  const recommendations = [];

  if (zoneRows) {
    // Find empty slots in target zone
    const rows = JSON.parse(zoneRows.assigned_rows || '[]');
    for (const row of rows) {
      for (let col = 1; col <= 9; col++) {
        const slotId = `${row}C${col}`;
        if (!occupiedSet.has(slotId)) {
          recommendations.push({
            slotId,
            zoneId: bestZone.zoneId,
            zoneName: bestZone.displayName,
            reason: bestZone.reason,
            confidence: bestZone.confidence
          });
          if (recommendations.length >= count) break;
        }
      }
      if (recommendations.length >= count) break;
    }
  }

  // Fallback: any empty slot
  if (recommendations.length < count) {
    const allSlots = await db.prepare('SELECT location_code FROM slots').all();
    for (const slot of allSlots) {
      if (!occupiedSet.has(slot.location_code) &&
          !recommendations.some(r => r.slotId === slot.location_code)) {
        recommendations.push({
          slotId: slot.location_code,
          zoneId: null,
          zoneName: 'Unzoned',
          reason: 'Fallback placement',
          confidence: 'low'
        });
        if (recommendations.length >= count) break;
      }
    }
  }

  return recommendations;
}
```

**File**: `src/routes/cellar.js`

Add endpoint:

```javascript
/**
 * GET /api/cellar/recommend-placement
 * Get placement recommendations for a wine.
 */
router.get('/recommend-placement', async (req, res) => {
  try {
    const { wineId, colour, style, country, vintage } = req.query;

    // Build wine object from query or fetch from DB
    let wine;
    if (wineId) {
      wine = await db.prepare('SELECT * FROM wines WHERE id = ?').get(wineId);
      if (!wine) return res.status(404).json({ error: 'Wine not found' });
    } else {
      wine = { colour, style, country, vintage: parseInt(vintage) };
    }

    const recommendations = await recommendPlacement(wine);

    res.json({
      recommendations,
      wineId: wine.id || null,
      count: recommendations.length
    });
  } catch (err) {
    console.error('[CellarAPI] Recommend placement error:', err);
    res.status(500).json({ error: err.message });
  }
});
```

---

### Task 7: Frontend Pre-Apply Validation

**File**: `public/js/cellarAnalysis.js`

Before applying moves, show preview and validate:

```javascript
async function applyMoves(moves) {
  // Show preview modal
  const preview = document.getElementById('move-preview-modal');
  preview.querySelector('.move-count').textContent = moves.length;
  preview.querySelector('.move-list').innerHTML = moves
    .map(m => `<li>${m.wineName}: ${m.from} → ${m.to}</li>`)
    .join('');
  preview.style.display = 'flex';

  // Wait for user confirmation
  const confirmed = await waitForConfirmation(preview);
  if (!confirmed) return;

  try {
    const response = await fetch('/api/cellar/execute-moves', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ moves })
    });

    const result = await response.json();

    if (!response.ok) {
      if (response.status === 409) {
        // Validation failed - show conflicts
        showConflictModal(result.conflicts, result.hint);
        return;
      }
      throw new Error(result.error);
    }

    showToast(`Moved ${result.moved} bottles successfully`);
    await refreshAnalysis(); // Refresh to show updated state

  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

function showConflictModal(conflicts, hint) {
  const modal = document.getElementById('conflict-modal');
  modal.querySelector('.hint').textContent = hint;
  modal.querySelector('.conflict-list').innerHTML = conflicts
    .map(c => `<li class="conflict-${c.type}">${c.message}</li>`)
    .join('');
  modal.style.display = 'flex';
}
```

---

## Acceptance Criteria

### Invariants (Must Pass)
- [ ] Total bottle count never decreases after move execution
- [ ] No slot ever contains more than one wine
- [ ] Every wine is in exactly one slot (or none if consumed)
- [ ] Suggested moves never target the same slot twice
- [ ] Executing moves that conflict returns 409, not 500
- [ ] Partial move failures roll back completely

### Functional Tests
- [ ] `validateMovePlan()` catches duplicate targets
- [ ] `validateMovePlan()` catches occupied targets
- [ ] `validateMovePlan()` catches source mismatches
- [ ] Transaction rollback works on constraint violation
- [ ] Cache invalidates after successful moves
- [ ] Cached moves return null when cellar changes

### UX Tests
- [ ] Pre-apply preview shows move count and list
- [ ] Conflict modal explains what went wrong
- [ ] "Refresh suggestions" regenerates after conflict

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/services/movePlanner.js` | Modify | Add `validateMovePlan()` function |
| `src/services/cellarAnalysis.js` | Modify | Track allocated targets in suggestion generation |
| `src/routes/cellar.js` | Modify | Add validation + transaction to `/execute-moves` |
| `src/services/cacheService.js` | Modify | Add move plan persistence |
| `src/services/cellarPlacement.js` | Modify | Add `recommendPlacement()` function |
| `data/migrations/025_slot_uniqueness.sql` | Create | Unique index on wine_id |
| `public/js/cellarAnalysis.js` | Modify | Add pre-apply preview and conflict handling |
| `public/index.html` | Modify | Add preview and conflict modal HTML |
| `tests/unit/services/movePlanner.test.js` | Create | Unit tests for validation |

---

## SQL to Run in Supabase

```sql
-- Migration 025: Slot uniqueness constraint
CREATE UNIQUE INDEX IF NOT EXISTS idx_slots_wine_unique
ON slots (wine_id)
WHERE wine_id IS NOT NULL;

COMMENT ON INDEX idx_slots_wine_unique IS
  'Ensures each wine can only be in one slot at a time. Prevents move collisions.';
```

---

## Critical Note on the Original Bug

The original bug occurred because:
1. User said "move bottle 1" (same wine name as bottle 2)
2. System suggested moving bottle 1 to slot X
3. System suggested moving bottle 2 to slot X (same target!)
4. When executed, bottle 1 was placed at X, then bottle 2 overwrote it

**Root fix**: The `allocatedTargets` set in Task 2 prevents this by tracking which slots have already been assigned to earlier moves in the same batch.

---

*Created: 7 January 2026*
*Status: READY FOR IMPLEMENTATION*
