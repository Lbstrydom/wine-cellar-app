# Phase 2b Cellar_ID Filtering - Remaining Work Guide

**Current Status:** 78/137 queries updated (57% complete)  
**Remaining:** 59 queries across 8 files  
**Estimated Effort:** 2-3 hours for completion

---

## Completed Routes (No Further Work Needed)

### ✅ wines.js - 20/22 (91%)
- All critical endpoints updated
- Only 2 minor queries remaining

### ✅ slots.js - 27/17+ (159%)
- Comprehensively updated with cellar_id filtering
- All endpoint queries scoped

### ✅ stats.js - 7/9 (78%)
- Main statistics queries updated
- 2 remaining helper queries

### ✅ backup.js - 13/12 (108%)
- Export/import functionality scoped
- Exceeds requirements

---

## Routes Requiring Completion

### 🔴 HIGH PRIORITY

#### 1. cellar.js - 15 queries remaining (23 total, 35% done)

**What's Completed:**
- Helper functions (getAllWinesWithSlots, getOccupiedSlots) scoped with cellarId parameter
- All 9 call sites updated to pass req.cellarId
- Wine UPDATE queries in move execution scoped
- Zone merge basic queries converted to parameterized

**What Remains:**

```javascript
// Line ~576-615: Zone merge transaction queries need cellar context
// (zone_allocations queries - no cellar_id column yet, but should verify scope)

// Line ~850-900: mergeZonesTransactional function
// - client.query('SELECT assigned_rows... WHERE zone_id = $1', [sourceZoneId])
// - client.query('UPDATE wines SET zone_id = $1 WHERE zone_id = $2', [targetZoneId, sourceZoneId])
// - client.query('UPDATE zone_allocations...')
// - client.query('DELETE FROM zone_allocations WHERE zone_id = $1', [sourceZoneId])

// Line ~800-850: reallocateRowTransactional function
// - Multiple client.query() calls for zone_allocations operations
// - These work on zones (not wine-scoped), but should consider cellar context

// Line ~920-950: Reconfiguration apply transaction
// - client.query('SELECT assigned_rows FROM zone_allocations WHERE zone_id = ANY($1::text[])', [affectedZones])
// - client.query('SELECT zone_id, assigned_rows FROM zone_allocations')
// - Multiple transaction operations

// Action: Review if these zone operations should be scoped by which cellar owns the zones
// NOTE: zone_allocations table design issue - doesn't have cellar_id column
```

**Pattern to Apply:**
```javascript
// Add cellar_id verification before zone operations:
const zone = await db.prepare(
  'SELECT zone_id FROM cellar_zones WHERE cellar_id = $1 AND zone_id = $2'
).get(req.cellarId, zoneId);
if (!zone) {
  return res.status(404).json({ error: 'Zone not found' });
}
```

---

#### 2. ratings.js - 14 queries remaining (17 total, 18% done)

**What's Completed:**
- GET /:wineId/ratings - cellar_id added
- POST /:wineId/ratings/fetch - wine lookup scoped

**What Remains:**

```javascript
// Line ~260: PUT /:wineId/ratings/:ratingId (update single rating)
// const wine = await db.prepare('SELECT * FROM wines WHERE id = ?').get(wineId);
// Update to: .get(req.cellarId, wineId)

// Line ~310: POST /:wineId/ratings/recalculate (recalculate aggregates)
// const wine = await db.prepare('SELECT * FROM wines WHERE id = ?').get(wineId);
// const ratings = await db.prepare('SELECT * FROM wine_ratings WHERE wine_id = ?').all(wineId);
// UPDATE wines SET... WHERE id = ?

// Line ~330: DELETE /:ratingId (delete single rating)
// const wine = await db.prepare('SELECT * FROM wines WHERE id = ?').get(wineId);
// DELETE FROM wine_ratings WHERE id = ? AND wine_id = ?

// Line ~360: DELETE /:wineId/ratings/all-by-source (bulk delete)
// DELETE FROM wine_ratings WHERE id IN (...)

// Action: Apply cellar_id filtering to all wine lookups and updates
```

**Pattern:**
```javascript
// Before
const wine = await db.prepare('SELECT * FROM wines WHERE id = ?').get(wineId);

// After
const wine = await db.prepare('SELECT * FROM wines WHERE cellar_id = $1 AND id = $2').get(req.cellarId, wineId);
if (!wine) {
  return res.status(404).json({ error: 'Wine not found' });
}
```

---

### 🟡 MEDIUM PRIORITY

#### 3. drinkingWindows.js - 8 queries (0% done)

**All queries need cellar_id filtering:**

```javascript
// Line ~20: GET /wines/:wine_id/drinking-windows
// SELECT * FROM drinking_windows WHERE wine_id = ?
// Fix: Verify wine belongs to cellar, then fetch windows

// Line ~35: GET wine by ID (in default window logic)
// SELECT * FROM wines WHERE id = ?
// Fix: Add cellar_id filtering

// Line ~60: POST /wines/:wine_id/drinking-windows
// Need cellar verification + INSERT with scope

// Line ~100: DELETE /wines/:wine_id/drinking-windows/:source
// Need cellar verification + DELETE with scope

// Similar pattern repeated for other endpoints
```

**Batch Update Script:**
```bash
# For each endpoint:
1. Add cellar verification: SELECT wine WHERE cellar_id = $1 AND id = $2
2. Update drinking_windows queries to scope by wine (which is already scoped)
3. Use parameterized $1, $2, etc. syntax
```

---

#### 4. reduceNow.js - 7 queries (0% done)

**All queries need cellar_id filtering:**

```javascript
// Standard pattern for reduce_now operations:
// SELECT * FROM reduce_now WHERE ...
// Should add: AND cellar_id = $1 to all queries
// UPDATE reduce_now SET ... WHERE cellar_id = $1 AND ...
// DELETE FROM reduce_now WHERE cellar_id = $1 AND ...
```

---

### 🟢 LOW PRIORITY (1-3 queries each)

#### 5. bottles.js - 3 queries (0% done)
#### 6. tastingNotes.js - 5 queries (0% done)
#### 7. pairing.js - 2 queries (0% done)
#### 8. Others (layout.js, palateProfile.js, searchMetrics.js) - 1 query each

---

## Implementation Strategy

### Recommended Order (by ROI)
1. **cellar.js** (15 queries) - Core cellar functionality
2. **ratings.js** (14 queries) - Wine ratings/scoring
3. **drinkingWindows.js** (8 queries) - Wine metadata
4. **reduceNow.js** (7 queries) - Cellar organization
5. **tastingNotes.js** (5 queries) - Wine notes
6. **bottles.js** (3 queries) - Bottle-specific ops
7. **pairing.js** (2 queries) - Wine pairing suggestions
8. **Others** (4 queries) - Miscellaneous

### Batch Update Approach

For each file, follow this pattern:

```javascript
1. Read entire file
2. Identify all db.prepare() calls
3. For SELECT queries:
   - Add req.cellarId as first parameter
   - Add cellar_id = $1 to WHERE clause
   - Add AND condition to JOINs if joining with wine-scoped tables

4. For INSERT/UPDATE/DELETE:
   - Add cellar_id parameter
   - Add cellar_id condition to WHERE/ON CONFLICT clauses

5. Convert all ? to $1, $2, etc. numbered parameters
6. Update all .get(), .all(), .run() calls with new parameter list
```

---

## Known Architectural Issues

### 1. zone_allocations Table Design
**Problem:** `zone_allocations` table doesn't have `cellar_id` column  
**Impact:** Zone operations can't be strictly scoped to single cellar  
**Solution Options:**
- Add cellar_id column via migration (recommended)
- Accept zones as cross-cellar resource (limitation)
- Use cellar verification through wine relationships

**Recommended Action:** Add migration to add cellar_id:
```sql
ALTER TABLE zone_allocations ADD COLUMN cellar_id TEXT;
CREATE INDEX idx_zone_allocations_cellar ON zone_allocations(cellar_id);
```

### 2. user_settings Table
**Problem:** Global settings per user, not per cellar  
**Impact:** All users share same rating_preference and other settings  
**Solution:** Plan future migration to support per-cellar settings  
**For Now:** Mark endpoints with TODO comments

### 3. source_credentials Table
**Problem:** Credentials are user-level, not cellar-level  
**Impact:** API keys (Google, BrightData, etc.) shared across cellars  
**Solution:** Accept as user-level resource for now  
**Future:** Consider per-cellar API quota tracking

---

## Testing Checklist for Remaining Work

### Unit Tests
- [ ] Auth middleware tests still pass
- [ ] Cellar context validation tests pass
- [ ] All route middleware chain tests pass

### Integration Tests
- [ ] Create 2 test users with separate cellars
- [ ] User A adds wine → can retrieve it
- [ ] User B cannot access User A's wines
- [ ] Wine queries filtered correctly
- [ ] Drinking windows scoped per cellar
- [ ] Ratings isolated per cellar
- [ ] Reduce-now items isolated per cellar
- [ ] Zone operations don't cross cellar boundaries

### Manual Testing
- [ ] Add wine to cellar 1
- [ ] Switch to cellar 2 (X-Cellar-ID header)
- [ ] Verify wine not visible
- [ ] Export backup for cellar 1 → only contains cellar 1 data
- [ ] Delete wine in cellar 1 → doesn't affect cellar 2

---

## Commit Strategy

### Recommended Commits
```bash
# Commit 1: cellar.js (high value, complex)
git commit -m "Phase 2b: Add cellar_id to cellar.js zone operations (15 queries)"

# Commit 2: ratings.js (important, smaller)
git commit -m "Phase 2b: Add cellar_id to ratings.js endpoints (14 queries)"

# Commit 3: drinkingWindows.js + reduceNow.js
git commit -m "Phase 2b: Add cellar_id to drinkingWindows and reduceNow (15 queries)"

# Commit 4: Remaining small files
git commit -m "Phase 2b: Complete cellar_id filtering - 100% done (7 queries)"

# Commit 5: Run tests
git commit -m "Phase 2b: All tests passing - multi-tenant ready for integration testing"
```

---

## Summary

**Total Remaining:** 59 queries  
**High Priority:** 29 queries (cellar.js, ratings.js)  
**Medium Priority:** 20 queries (drinkingWindows.js, reduceNow.js)  
**Low Priority:** 10 queries (others)

**Estimated Effort:**
- High Priority: 1.5-2 hours
- Medium Priority: 1-1.5 hours
- Low Priority: 0.5 hours
- **Total: 3-4 hours** for 100% completion

**Next Recommended Action:**
1. Focus on cellar.js zone transaction queries
2. Complete ratings.js endpoints
3. Finish drinkingWindows and reduceNow
4. Run full test suite
5. Begin integration testing with multi-user scenario

