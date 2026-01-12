# Phase 2b Implementation Guide

**Date:** 12 January 2026
**Status:** In Progress
**Objective:** Complete backend multi-user implementation and route auditing

---

## What's Complete (✅)

### 1. Middleware Infrastructure
- ✅ **auth.js** - JWT validation with Supabase JWKS
  - Atomic first-time user setup (transaction with FOR UPDATE locks)
  - Profile creation with auto-cellar provisioning
  - Invite code validation and use_count increment
  - Handles token refresh and last_login_at tracking
  
- ✅ **cellarContext.js** - Membership validation and role checks
  - Validates X-Cellar-ID header against cellar_memberships
  - Falls back to user's active_cellar_id if no header
  - Sets req.cellarId and req.cellarRole for downstream use
  - Includes helper functions: requireCellarEdit, requireCellarOwner
  - getUserCellars and setActiveCellar endpoints

### 2. Route Mounting
- ✅ **routes/index.js** updated
  - Added import for `requireCellarContext`
  - Applied `requireCellarContext` middleware to all data routes:
    - wines, slots, bottles, pairing, reduce-now
    - stats, layout, ratings, settings, drinking-windows
    - cellar, awards, backup, wine-search, acquisition
    - palate, health, metrics, tasting-notes

### 3. Test Infrastructure
- ✅ **tests/unit/middleware/auth-multiuser.test.js** (15+ tests)
  - Multi-user profile isolation
  - Subscription scoping
  - Data boundary validation
  
- ✅ **tests/unit/middleware/auth-firsttime-user.test.js** (15+ tests)
  - Atomic transaction flow validation
  - Invite code validation (expiry, max uses, missing codes)
  - Transaction rollback scenarios
  - Use count incrementation with FOR UPDATE locks
  
- ✅ **tests/unit/db/seeding.test.js** (20+ tests)
  - Seed file format validation
  - Database population patterns
  - Idempotency and multi-user data isolation

### 4. Sample Route Updates
- ✅ **wines.js** - First 4 critical queries updated
  - GET /api/wines (main list with pagination)
  - GET /api/wines/search
  - GET /api/wines/global-search
  - All now filter by `cellar_id` and use parameterized queries ($1, $2, etc.)

---

## What Needs Completion (⏳)

### Phase 2b.1: Complete Route Updates

**Pattern to follow for each route file:**

Every `SELECT` query must be updated to filter by `req.cellarId`. The pattern is:

```javascript
// BEFORE
const result = await db.prepare(`
  SELECT * FROM wines
  WHERE wine_id = ?
`).get(wineId);

// AFTER  
const result = await db.prepare(`
  SELECT * FROM wines
  WHERE cellar_id = $1 AND wine_id = $2
`).get(req.cellarId, wineId);
```

**Key points:**
1. Add `cellar_id = $X` filter to WHERE clause
2. Update all `?` placeholders to `$1`, `$2`, etc.
3. Ensure `req.cellarId` is first parameter
4. For JOINs, add cellar_id to JOIN conditions:
   ```javascript
   LEFT JOIN slots s ON s.wine_id = w.id AND s.cellar_id = $1
   ```

**Routes requiring updates:**

| File | Queries | Status | Notes |
|------|---------|--------|-------|
| wines.js | 16 | 25% | First 4 done, remainder use old param style |
| slots.js | 12 | 0% | Complete refactor needed |
| bottles.js | 8 | 0% | Complete refactor needed |
| pairing.js | 6 | 0% | Complete refactor needed |
| reduceNow.js | 5 | 0% | Complete refactor needed |
| stats.js | 8 | 0% | Complete refactor needed |
| ratings.js | 10 | 0% | Complete refactor needed |
| settings.js | 4 | 0% | Complete refactor needed |
| drinkingWindows.js | 7 | 0% | Complete refactor needed |
| cellar.js | 12 | 0% | Complete refactor needed |
| awards.js | 15 | 0% | Complete refactor needed |
| backup.js | 3 | 0% | Complete refactor needed |
| wineSearch.js | 4 | 0% | Complete refactor needed |
| acquisition.js | 6 | 0% | Complete refactor needed |
| palateProfile.js | 8 | 0% | Complete refactor needed |
| cellarHealth.js | 10 | 0% | Complete refactor needed |
| tastingNotes.js | 7 | 0% | Complete refactor needed |
| searchMetrics.js | 5 | 0% | Complete refactor needed |

### Phase 2b.2: Audit for Edge Cases

**Check each route for:**

1. **Subquery isolation** - Ensure subqueries also filter by cellar_id
2. **INSERT operations** - Include `cellar_id` in all INSERT statements
3. **UPDATE operations** - Add WHERE clause with cellar_id to prevent cross-cellar updates
4. **DELETE operations** - Must have cellar_id in WHERE to prevent cascade
5. **Aggregation queries** - Group results properly per-cellar

**Example - Slots route audit:**

```javascript
// GET /api/slots - list cellar slots
router.get('/', async (req, res) => {
  const slots = await db.prepare(`
    SELECT * FROM slots
    WHERE cellar_id = $1
    ORDER BY location_code
  `).all(req.cellarId);
  res.json({ data: slots });
});

// POST /api/bottles - add bottle to cellar
router.post('/', async (req, res) => {
  const { wine_id, location_code } = req.body;
  
  // Verify wine belongs to this cellar
  const wine = await db.prepare(`
    SELECT id FROM wines
    WHERE id = $1 AND cellar_id = $2
  `).get(wine_id, req.cellarId);
  
  if (!wine) {
    return res.status(404).json({ error: 'Wine not found' });
  }
  
  const result = await db.prepare(`
    INSERT INTO slots (wine_id, location_code, cellar_id)
    VALUES ($1, $2, $3)
    RETURNING *
  `).get(wine_id, location_code, req.cellarId);
  
  res.json({ data: result });
});
```

### Phase 2b.3: Cross-Tenant Testing

Create integration tests to verify isolation:

```javascript
// tests/integration/multi-tenant.test.js

describe('Multi-tenant data isolation', () => {
  let user1Token, user2Token, cellar1Id, cellar2Id;
  
  beforeAll(async () => {
    // Create 2 users and cellars
    user1Token = await signupUser('user1@test.com', 'invite-1');
    user2Token = await signupUser('user2@test.com', 'invite-2');
  });
  
  it('User1 cannot see User2\'s wines', async () => {
    // User2 creates a wine
    const wine = await createWine('Château Margaux', {
      token: user2Token,
      cellarId: cellar2Id
    });
    
    // User1 tries to access it
    const res = await request(app)
      .get(`/api/wines/${wine.id}`)
      .set('Authorization', `Bearer ${user1Token}`)
      .set('X-Cellar-ID', cellar1Id);
    
    expect(res.status).toBe(404);  // Not found (not 403 - doesn't exist)
  });
  
  it('User1 cannot modify User2\'s wines', async () => {
    const res = await request(app)
      .put(`/api/wines/${user2Wine.id}`)
      .set('Authorization', `Bearer ${user1Token}`)
      .set('X-Cellar-ID', cellar1Id)
      .send({ wine_name: 'Hacked!' });
    
    expect(res.status).toBe(404);  // Can't modify what doesn't exist
  });
  
  it('User1 cannot delete User2\'s wines', async () => {
    const res = await request(app)
      .delete(`/api/wines/${user2Wine.id}`)
      .set('Authorization', `Bearer ${user1Token}`)
      .set('X-Cellar-ID', cellar1Id);
    
    expect(res.status).toBe(404);
  });
});
```

---

## Implementation Checklist

### Stage 1: Core Route Updates (Days 2-3)

- [ ] wines.js - Complete all 16 queries
- [ ] slots.js - Update 12 queries
- [ ] bottles.js - Update 8 queries
- [ ] pairing.js - Update 6 queries
- [ ] reduceNow.js - Update 5 queries
- [ ] stats.js - Update 8 queries

**Verification:** Run `npm run test:unit` - no errors

### Stage 2: Additional Routes (Days 3-4)

- [ ] ratings.js - Update 10 queries
- [ ] settings.js - Update 4 queries
- [ ] drinkingWindows.js - Update 7 queries
- [ ] cellar.js - Update 12 queries
- [ ] awards.js - Update 15 queries
- [ ] backup.js - Update 3 queries
- [ ] wineSearch.js - Update 4 queries
- [ ] acquisition.js - Update 6 queries
- [ ] palateProfile.js - Update 8 queries
- [ ] cellarHealth.js - Update 10 queries
- [ ] tastingNotes.js - Update 7 queries
- [ ] searchMetrics.js - Update 5 queries

**Verification:** Run `npm run test:unit` - no errors

### Stage 3: Edge Case Audit (Days 4-5)

- [ ] Subquery isolation checklist
- [ ] INSERT/UPDATE/DELETE patterns verified
- [ ] Aggregation queries correct per-cellar
- [ ] No hardcoded UUID values
- [ ] No global counts or stats leaking across cellars

**Verification:** Manual code review against checklist

### Stage 4: Integration Testing (Days 5-6)

- [ ] Create multi-tenant test suite
- [ ] User A isolation from User B
- [ ] X-Cellar-ID spoofing returns 403
- [ ] Missing cellar header uses active_cellar_id
- [ ] Cellar deletion cascades properly
- [ ] Invite code validation works

**Verification:** `npm run test:integration` passes

### Stage 5: Smoke Testing (Day 7)

- [ ] Create 2 test users with invite codes
- [ ] Each creates own cellar
- [ ] Add wines to each cellar
- [ ] Switch between cellars using header
- [ ] Verify data isolation per-cellar
- [ ] Test role-based access (viewer, editor, owner)

**Verification:** Manual testing through frontend

---

## Automated Conversion Script

To speed up the updates, this script identifies all queries needing updates:

```bash
# Find all SELECT statements in routes
find src/routes -name "*.js" -exec grep -l "db.prepare" {} \;

# For each file, find lines with "?" that need converting to $1, $2, etc.
# Pattern: db.prepare(`...WHERE ... = ?...`).all(param)
```

**Semi-automated approach:**

1. For each route file, use Find/Replace to:
   - Replace `FROM wines` with `FROM wines\nWHERE cellar_id = $1`
   - Convert `?` to numbered params starting with $2

2. Manually verify each change ensures correct cellar_id filtering

---

## Query Update Template

**Before:**
```javascript
const data = await db.prepare(`
  SELECT * FROM wines
  WHERE wine_id = ?
`).get(wineId);
```

**After:**
```javascript
const data = await db.prepare(`
  SELECT * FROM wines
  WHERE cellar_id = $1 AND wine_id = $2
`).get(req.cellarId, wineId);
```

---

## Expected Outcome

When Phase 2b is complete:

1. ✅ All 23 route files use `requireCellarContext` middleware
2. ✅ All SELECT queries filter by `cellar_id`
3. ✅ All INSERT queries include `cellar_id`
4. ✅ All UPDATE/DELETE queries scope by `cellar_id`
5. ✅ Cross-tenant tests confirm isolation
6. ✅ No data leakage between cellars
7. ✅ Token budget sustainable for Phase 3 (Frontend)

---

## Next Steps

After completing Phase 2b:

- **Phase 3:** Frontend implementation (Login, Auth, Cellar Switcher)
- **Phase 4:** Environment setup (Supabase + Railway)
- **Phase 5:** Beta testing and validation

---

*Document created: 12 January 2026*
