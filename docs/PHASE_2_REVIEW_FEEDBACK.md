# Phase 2 Backend Auth - Final Review Feedback

**Review Date:** January 12, 2026
**Reviewer:** Architecture Review
**Status:** APPROVED WITH REQUIRED FIXES

---

## Summary

Phase 2 implementation is **structurally sound** and follows the multi-user plan correctly. The middleware split, X-Cellar-ID validation, and atomic first-time setup are all implemented properly. However, **5 issues must be resolved before Phase 2b route scoping begins**.

---

## What's Working Well

| Area | Assessment |
|------|------------|
| Middleware split | ✅ `requireAuth` handles identity, `requireCellarContext` handles tenancy |
| X-Cellar-ID validation | ✅ Treated as untrusted, validated via `cellar_memberships` |
| Atomic first-time setup | ✅ Transaction-based profile + cellar + membership creation |
| Role gates | ✅ owner/editor/viewer enforced via middleware |
| Test coverage | ✅ 28 tests for middleware, 705 total passing |

---

## Required Fixes (MUST DO before Phase 2b)

### 1. Fix Invite Code Race Condition (CRITICAL)

**Current Code** ([auth.js:93-103](src/middleware/auth.js#L93-L103)):
```javascript
const invite = await db.prepare(`
  SELECT code, max_uses, use_count, expires_at
  FROM invites
  WHERE code = $1
    AND (expires_at IS NULL OR expires_at > NOW())
    AND (max_uses IS NULL OR use_count < max_uses)
`).get(inviteCode);

if (!invite) {
  return null;
}
// ... later in transaction ...
await db.prepare(`
  UPDATE invites SET use_count = use_count + 1 ...
`).run(profile.id, inviteCode);
```

**Problem:** Classic TOCTOU (time-of-check-to-time-of-use). Two concurrent signups can both pass the SELECT check and both increment `use_count`, bypassing `max_uses` limit.

**Fix Options:**
1. **Lock the row** (preferred):
   ```javascript
   await db.prepare('BEGIN').run();
   const invite = await db.prepare(`
     SELECT code, max_uses, use_count, expires_at
     FROM invites
     WHERE code = $1 FOR UPDATE
   `).get(inviteCode);
   // ... rest of transaction
   ```

2. **Conditional update with affected rows check:**
   ```javascript
   const result = await db.prepare(`
     UPDATE invites
     SET use_count = use_count + 1, used_by = $1, used_at = NOW()
     WHERE code = $2
       AND (max_uses IS NULL OR use_count < max_uses)
       AND (expires_at IS NULL OR expires_at > NOW())
   `).run(profile.id, inviteCode);

   if (result.changes === 0) {
     await db.prepare('ROLLBACK').run();
     return null; // Invite already maxed out
   }
   ```

**Priority:** HIGH - Beta gating can be bypassed under concurrent load.

---

### 2. Replace Service Key with Local JWT Verification

**Current Code** ([auth.js:11-14](src/middleware/auth.js#L11-L14)):
```javascript
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
```

**Problem:** `SUPABASE_SERVICE_KEY` is a high-privilege credential that bypasses RLS. Even though you only use it for `auth.getUser()`, it's still exposed in the API runtime. If the server is compromised, the attacker has admin access to Supabase.

**Fix:** Use local JWT verification with Supabase's JWKS:

```javascript
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

const client = jwksClient({
  jwksUri: `${process.env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`,
  cache: true,
  rateLimit: true
});

function getKey(header, callback) {
  client.getSigningKey(header.kid, (err, key) => {
    callback(err, key?.getPublicKey());
  });
}

export async function verifyToken(token) {
  return new Promise((resolve, reject) => {
    jwt.verify(token, getKey, {
      algorithms: ['RS256'],
      audience: 'authenticated',
      issuer: `${process.env.SUPABASE_URL}/auth/v1`
    }, (err, decoded) => {
      if (err) reject(err);
      else resolve(decoded);
    });
  });
}
```

**Alternative:** Use Supabase anon key (public) instead of service key. The `auth.getUser()` endpoint accepts anon key and still validates tokens securely.

**Priority:** HIGH - Reduces blast radius if server is compromised.

---

### 3. Clarify Global Auth vs Optional Auth Routing

**Current State:**
- [server.js:52](src/server.js#L52): `app.use('/api', requireAuth)` - ALL `/api` routes require auth
- [auth.js:171](src/middleware/auth.js#L171): `optionalAuth` middleware exists but is unreachable

**Problem:** These conflict. If `requireAuth` runs on ALL `/api` routes, `optionalAuth` can never be used for public API endpoints.

**Fix Options:**

1. **Split namespaces:**
   ```javascript
   // server.js
   app.use('/api/public', publicRoutes);     // No auth
   app.use('/api', requireAuth, routes);     // Auth required
   ```

2. **Per-router auth mounting:**
   ```javascript
   // routes/index.js
   router.use('/wines', requireAuth, winesRoutes);
   router.use('/stats', optionalAuth, statsRoutes); // Public stats
   ```

**Recommendation:** Option 2 is more flexible. Remove global `requireAuth` from server.js and add it per-router in routes/index.js.

**Priority:** MEDIUM - Must decide before Phase 2b adds more routes.

---

### 4. Add First-Time User Transaction Tests

**Current Test Coverage** ([auth.test.js](tests/unit/middleware/auth.test.js)):
- ✅ Missing authorization header → 401
- ✅ Invalid token format → 401
- ✅ Bearer token parsing
- ✅ Authorization scheme validation
- ❌ First-time user happy path
- ❌ Invite code validation (valid/expired/maxed)
- ❌ Transaction rollback on DB failure
- ❌ Repeat login after partial failure

**Required Tests:**
```javascript
describe('createFirstTimeUser', () => {
  it('should create profile, cellar, membership atomically');
  it('should reject expired invite codes');
  it('should reject maxed-out invite codes');
  it('should rollback on profile creation failure');
  it('should rollback on cellar creation failure');
  it('should allow login after partial failure (user can retry)');
  it('should prevent double-signup with same auth user');
});
```

**Priority:** HIGH - Atomic setup is critical; needs test coverage.

---

### 5. Add dbScoped Helper for Route Scoping

**Rationale:** Phase 2b will update 14+ route files. Every INSERT/UPDATE/DELETE must include `cellar_id`. A single missed WHERE clause = tenant data leak.

**Proposed Helper:**
```javascript
// src/db/scoped.js

/**
 * Create scoped query helpers that always include cellar_id.
 * Prevents accidental cross-tenant data access.
 */
export function createScopedQueries(cellarId) {
  return {
    /**
     * SELECT with automatic cellar_id filter
     */
    async selectWhere(table, conditions = {}) {
      const allConditions = { ...conditions, cellar_id: cellarId };
      // Build and execute query...
    },

    /**
     * INSERT with automatic cellar_id
     */
    async insert(table, data) {
      return db.prepare(`
        INSERT INTO ${table} (${Object.keys(data).join(', ')}, cellar_id)
        VALUES (${Object.keys(data).map((_, i) => `$${i+1}`).join(', ')}, $${Object.keys(data).length + 1})
        RETURNING *
      `).get(...Object.values(data), cellarId);
    },

    /**
     * UPDATE with automatic cellar_id in WHERE
     */
    async update(table, id, data) {
      // Always includes AND cellar_id = ?
    },

    /**
     * DELETE with automatic cellar_id in WHERE
     */
    async delete(table, id) {
      // Always includes AND cellar_id = ?
    }
  };
}

// Usage in routes:
router.get('/wines', requireCellarContext, async (req, res) => {
  const scoped = createScopedQueries(req.cellarId);
  const wines = await scoped.selectWhere('wines', { colour: req.query.colour });
  res.json({ data: wines });
});
```

**Alternative:** ESLint rule that flags raw queries missing `cellar_id` in WHERE.

**Priority:** MEDIUM - Mechanical safeguard for Phase 2b.

---

## Optional Improvements (Nice to Have)

### Per-User Rate Limiting

**Current:** Rate limiting is per-IP ([server.js:41](src/server.js#L41)), applied before auth.

**Improvement:** Add per-user rate limiting after `requireAuth`:
```javascript
import { rateLimit } from 'express-rate-limit';

const userRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { error: 'Too many requests' }
});

app.use('/api', requireAuth, userRateLimiter, routes);
```

**Priority:** LOW - Good for abuse control but not blocking.

---

## Action Items Summary

| # | Item | Priority | Owner | Status |
|---|------|----------|-------|--------|
| 1 | Fix invite code race condition with FOR UPDATE | HIGH | Backend | TODO |
| 2 | Replace service key with JWKS verification | HIGH | Backend | TODO |
| 3 | Clarify global vs per-router auth mounting | MEDIUM | Backend | TODO |
| 4 | Add first-time user transaction tests | HIGH | Backend | TODO |
| 5 | Create dbScoped helper for Phase 2b | MEDIUM | Backend | TODO |
| 6 | Add per-user rate limiting | LOW | Backend | OPTIONAL |

---

## Gate Decision

**Phase 2 Status:** ✅ APPROVED with fixes

**Proceed to Phase 2b when:**
- [ ] Items 1-4 are complete
- [ ] Item 5 helper exists (even if minimal)
- [ ] Tests pass: `npm run test:all`

---

## References

- [PHASE_2_BACKEND_AUTH.md](./PHASE_2_BACKEND_AUTH.md) - Implementation details
- [MULTI_USER_IMPLEMENTATION_PLAN.md](./MULTI_USER_IMPLEMENTATION_PLAN.md) - Full plan
- [src/middleware/auth.js](../src/middleware/auth.js) - Auth middleware
- [src/middleware/cellarContext.js](../src/middleware/cellarContext.js) - Cellar context middleware
