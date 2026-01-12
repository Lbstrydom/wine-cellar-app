# Multi-User Implementation Plan

## Wine Cellar App - Cellar-Based Tenancy with Supabase Auth

**Version:** 2.1
**Date:** 12 January 2026
**Status:** Phase 2b In Progress (Migrations Complete, 93% Route Queries Updated)
**Priority:** High

---

## Executive Summary

Transform the Wine Cellar App from single-user to multi-user using:
- **Supabase Authentication** (Google, Apple, email)
- **Cellar-based tenancy** (`cellar_id` as primary scope, not `user_id`)
- **App-enforced isolation** with DB constraints as safety net
- **Multi-cellar support** from day one

---

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Isolation** | App-enforced + DB constraints | Simpler debugging, constraints catch developer errors |
| **Primary scope** | `cellar_id` | Enables multi-cellar, sharing, ownership transfer |
| **Identity model** | `profiles.id = auth.users.id` | No mapping layer, simpler joins |
| **Active cellar** | `profiles.active_cellar_id` | Per-user preference, not membership property |
| **X-Cellar-ID header** | Validate membership server-side | Never trust client-provided scope |
| **Quotas** | Soft limits for beta | Warn at thresholds, hard-block abuse only |

---

## Current vs Target Architecture

### Current
```
Frontend (Vanilla JS) → Express API → Supabase PostgreSQL
     No Auth              No Auth         No Isolation
```

### Target
```
Frontend + Supabase JS → Express API + JWT → Supabase + Constraints
     OAuth/Email           Auth + Cellar      cellar_id scoping
     X-Cellar-ID header    Middleware         FK + NOT NULL + Index
```

---

## Database Schema

### New Tables

```sql
-- Profiles (identity, keyed by auth.users.id)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  tier TEXT DEFAULT 'free',
  cellar_quota INTEGER DEFAULT 1,
  bottle_quota INTEGER DEFAULT 100,
  active_cellar_id UUID,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

-- Cellars (data container)
CREATE TABLE cellars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT 'My Cellar',
  description TEXT,
  created_by UUID NOT NULL REFERENCES profiles(id), -- For auditing & ownership transfer
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add FK for active_cellar_id after cellars exists
ALTER TABLE profiles
  ADD CONSTRAINT fk_profiles_active_cellar
  FOREIGN KEY (active_cellar_id) REFERENCES cellars(id) ON DELETE SET NULL;

-- Cellar memberships (access control)
CREATE TABLE cellar_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cellar_id UUID NOT NULL REFERENCES cellars(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'editor', 'viewer')),
  invited_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(cellar_id, user_id)
);

-- Invite codes (beta gating)
CREATE TABLE invites (
  code TEXT PRIMARY KEY,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  used_by UUID REFERENCES profiles(id),
  used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  max_uses INTEGER DEFAULT 1,
  use_count INTEGER DEFAULT 0
);

-- Indexes
CREATE INDEX idx_profiles_email ON profiles(email);
CREATE INDEX idx_cellar_memberships_user ON cellar_memberships(user_id);
CREATE INDEX idx_cellar_memberships_cellar ON cellar_memberships(cellar_id);
```

### Existing Table Modifications

Add `cellar_id` with NOT NULL + FK + CASCADE + Index to all user-data tables:

```sql
-- wines
ALTER TABLE wines ADD COLUMN cellar_id UUID;
UPDATE wines SET cellar_id = '<default-cellar-id>';
ALTER TABLE wines ALTER COLUMN cellar_id SET NOT NULL;
ALTER TABLE wines ADD CONSTRAINT fk_wines_cellar
  FOREIGN KEY (cellar_id) REFERENCES cellars(id) ON DELETE CASCADE;
CREATE INDEX idx_wines_cellar ON wines(cellar_id);

-- slots
ALTER TABLE slots ADD COLUMN cellar_id UUID;
UPDATE slots SET cellar_id = '<default-cellar-id>';
ALTER TABLE slots ALTER COLUMN cellar_id SET NOT NULL;
ALTER TABLE slots ADD CONSTRAINT fk_slots_cellar
  FOREIGN KEY (cellar_id) REFERENCES cellars(id) ON DELETE CASCADE;
CREATE INDEX idx_slots_cellar ON slots(cellar_id);

-- Repeat for: reduce_now, drinking_windows, pairing_sessions,
-- user_taste_profile, chat_sessions, reconfiguration_plans,
-- search_cache, zones, tasting_notes
```

---

## Implementation Phases

### Phase 1: Database (1.5 days)

**Tasks:**
1. Create migration files for new tables
2. Add cellar_id to all existing tables
3. Create default cellar for existing data
4. Backfill cellar_id on all records
5. Add NOT NULL constraints after backfill
6. Verify row counts before/after migration

**Migration Order:**
```
027_create_profiles_table.sql          ✅ Applied
028_create_cellars_table.sql           ✅ Applied
029_create_cellar_memberships.sql      ✅ Applied
030_create_invites_table.sql           ✅ Applied
031_add_cellar_id_to_wines.sql         ✅ Applied
032_add_cellar_id_to_slots.sql         ✅ Applied
032a_create_missing_tables.sql         ✅ Applied (NEW - creates all missing PostgreSQL tables)
033_add_cellar_id_to_other_tables.sql  ✅ Applied
034_backfill_cellar_id.sql             ✅ Applied
035_add_not_null_constraints.sql       ✅ Applied (fixed preference_key reference)
036_add_cellar_id_to_zone_allocations.sql ✅ Applied
```

---

### Phase 2: Backend (2 days)

**2.1 Install Dependencies**
```bash
npm install @supabase/supabase-js jsonwebtoken
```

**2.2 Auth Middleware + Atomic First-Time Setup**
```javascript
// src/middleware/auth.js
import { createClient } from '@supabase/supabase-js';
import db from '../db/index.js';

// Supabase client ONLY for auth.getUser() - not for data queries
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.substring(7);
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // Check if profile exists (use our db abstraction, not Supabase client)
  let profile = await db.prepare(`
    SELECT * FROM profiles WHERE id = $1
  `).get(user.id);

  if (!profile) {
    // First login - run atomic setup
    profile = await createFirstTimeUser(user, req.headers['x-invite-code']);
    if (!profile) {
      return res.status(403).json({ error: 'Valid invite code required' });
    }
  }

  req.user = profile;
  next();
}

/**
 * Atomic first-time user setup:
 * 1. Validate invite code
 * 2. Create profile
 * 3. Create default cellar
 * 4. Create membership
 * 5. Set active_cellar_id
 * 6. Increment invite use_count
 *
 * All in a transaction - no half-created users.
 */
async function createFirstTimeUser(authUser, inviteCode) {
  // Validate invite code
  if (!inviteCode) return null;

  const invite = await db.prepare(`
    SELECT * FROM invites
    WHERE code = $1
      AND (expires_at IS NULL OR expires_at > NOW())
      AND (max_uses IS NULL OR use_count < max_uses)
  `).get(inviteCode);

  if (!invite) return null;

  // Atomic transaction
  await db.prepare('BEGIN').run();

  try {
    // 1. Create profile
    const profile = await db.prepare(`
      INSERT INTO profiles (id, email, display_name, avatar_url)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `).get(
      authUser.id,
      authUser.email,
      authUser.user_metadata?.full_name || authUser.email.split('@')[0],
      authUser.user_metadata?.avatar_url
    );

    // 2. Create default cellar
    const cellar = await db.prepare(`
      INSERT INTO cellars (name, created_by)
      VALUES ($1, $2)
      RETURNING id
    `).get('My Cellar', profile.id);

    // 3. Create membership (owner)
    await db.prepare(`
      INSERT INTO cellar_memberships (cellar_id, user_id, role)
      VALUES ($1, $2, 'owner')
    `).run(cellar.id, profile.id);

    // 4. Set active cellar
    await db.prepare(`
      UPDATE profiles SET active_cellar_id = $1 WHERE id = $2
    `).run(cellar.id, profile.id);

    // 5. Increment invite use_count
    await db.prepare(`
      UPDATE invites
      SET use_count = use_count + 1, used_by = $1, used_at = NOW()
      WHERE code = $2
    `).run(profile.id, inviteCode);

    await db.prepare('COMMIT').run();

    // Return profile with active_cellar_id
    return { ...profile, active_cellar_id: cellar.id };

  } catch (err) {
    await db.prepare('ROLLBACK').run();
    console.error('First-time user setup failed:', err);
    return null;
  }
}
```

**2.3 Cellar Context Middleware (CRITICAL)**
```javascript
// src/middleware/cellarContext.js
// NOTE: Use the same db abstraction as routes (src/db/index.js)
// NOT raw Supabase client - keep Supabase for auth only
import db from '../db/index.js';

export async function requireCellarContext(req, res, next) {
  const requestedCellarId = req.headers['x-cellar-id'];
  const userId = req.user.id;

  if (requestedCellarId) {
    // CRITICAL: Verify user is a member of this cellar
    const membership = await db.prepare(`
      SELECT role FROM cellar_memberships
      WHERE cellar_id = $1 AND user_id = $2
    `).get(requestedCellarId, userId);

    if (!membership) {
      return res.status(403).json({ error: 'Not a member of this cellar' });
    }

    req.cellarId = requestedCellarId;
    req.cellarRole = membership.role;
  } else {
    // No header: use user's active cellar (already validated as member)
    if (!req.user.active_cellar_id) {
      return res.status(400).json({ error: 'No active cellar set' });
    }
    req.cellarId = req.user.active_cellar_id;
  }

  next();
}

/**
 * Update active cellar - validates membership before setting.
 */
export async function setActiveCellar(req, res) {
  const { cellar_id } = req.body;
  const userId = req.user.id;

  // CRITICAL: Verify user is a member before allowing set
  const membership = await db.prepare(`
    SELECT role FROM cellar_memberships
    WHERE cellar_id = $1 AND user_id = $2
  `).get(cellar_id, userId);

  if (!membership) {
    return res.status(403).json({ error: 'Not a member of this cellar' });
  }

  await db.prepare(`
    UPDATE profiles SET active_cellar_id = $1 WHERE id = $2
  `).run(cellar_id, userId);

  res.json({ message: 'Active cellar updated' });
}
```

**2.4 Update Route Pattern**
```javascript
// src/routes/wines.js
import { requireAuth } from '../middleware/auth.js';
import { requireCellarContext } from '../middleware/cellarContext.js';

router.use(requireAuth);
router.use(requireCellarContext);

router.get('/', async (req, res) => {
  // Use req.cellarId - NEVER trust request body for scope
  const wines = await db.prepare(`
    SELECT w.*, COUNT(s.id) as bottle_count
    FROM wines w
    LEFT JOIN slots s ON s.wine_id = w.id AND s.cellar_id = ?
    WHERE w.cellar_id = ?
    GROUP BY w.id
  `).all(req.cellarId, req.cellarId);

  res.json({ data: wines });
});
```

---

### Phase 3: Frontend (2 days)

**3.1 Auth Module**
```javascript
// public/js/auth.js
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function signInWithGoogle() {
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin }
  });
}

export async function signInWithApple() {
  return supabase.auth.signInWithOAuth({
    provider: 'apple',
    options: { redirectTo: window.location.origin }
  });
}

export function getAccessToken() {
  return localStorage.getItem('access_token');
}

export function getActiveCellarId() {
  return localStorage.getItem('active_cellar_id');
}
```

**3.2 API Module Update**
```javascript
// public/js/api.js
import { getAccessToken, getActiveCellarId, signOut } from './auth.js';

async function apiFetch(url, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };

  const token = getAccessToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const cellarId = getActiveCellarId();
  if (cellarId) {
    headers['X-Cellar-ID'] = cellarId;
  }

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    await signOut();
    return;
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error);
  }

  return response.json();
}
```

**3.3 Cellar Switcher Component**
```javascript
// public/js/cellarSwitcher.js
export async function initCellarSwitcher() {
  const cellars = await apiFetch('/api/cellars');
  const activeCellarId = getActiveCellarId();

  const container = document.getElementById('cellar-switcher');
  container.innerHTML = `
    <select id="cellar-select">
      ${cellars.data.map(c => `
        <option value="${c.id}" ${c.id === activeCellarId ? 'selected' : ''}>
          ${escapeHtml(c.name)}
        </option>
      `).join('')}
    </select>
  `;

  container.querySelector('#cellar-select').addEventListener('change', async (e) => {
    localStorage.setItem('active_cellar_id', e.target.value);
    await apiFetch('/api/profile', {
      method: 'PATCH',
      body: JSON.stringify({ active_cellar_id: e.target.value })
    });
    window.location.reload();
  });
}
```

---

### Phase 4: Environments (0.5 days)

1. **Create separate Supabase project** for testing
2. **Update Railway** with environment-specific variables:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_KEY`
3. **Document deployment process**

---

## Mandatory Deliverables

### 1. Table Inventory Checklist

**User-Owned Tables (require cellar_id):**

| Table | cellar_id | FK CASCADE | NOT NULL | Index |
|-------|-----------|------------|----------|-------|
| wines | [x] | [x] | [x] | [x] |
| slots | [x] | [x] | [x] | [x] |
| reduce_now | [x] | [x] | [x] | [x] |
| drinking_windows | [x] | [x] | [x] | [x] |
| wine_ratings | [x] | [x] | [x] | [x] |
| chat_sessions | [x] | [x] | [x] | [x] |
| palate_profile | [x] | [x] | [x] | [x] |
| palate_feedback | [x] | [x] | [x] | [x] |
| consumption_log | [x] | [x] | [x] | [x] |
| search_cache | [x] | [x] | [x] | [x] |
| cellar_zones | [x] | [x] | [x] | [x] |
| zone_reconfigurations | [x] | [x] | [x] | [x] |
| zone_row_assignments | [x] | [x] | [x] | [x] |
| zone_pins | [x] | [x] | [x] | [x] |
| zone_allocations | [x] | [x] | [x] | [x] |
| data_provenance | [x] | [x] | [x] | [x] |
| extraction_cache | [x] | [x] | [x] | [x] |

**Global Reference Tables (NO cellar_id - read-only shared data):**

| Table | Scope | Notes |
|-------|-------|-------|
| competition_awards | Global | Wine award data, shared |
| award_sources | Global | Award source metadata |
| known_competitions | Global | Competition definitions |
| pairing_rules | Global | AI pairing rules |
| style_mappings | Global | Wine style mappings |
| wine_serving_temps | Global | Temperature guidelines |
| drinking_window_defaults | Global | Default aging windows |

**System Tables (NO cellar_id - internal operations):**

| Table | Scope | Notes |
|-------|-------|-------|
| job_queue | System | Background job queue |
| job_history | System | Job execution history |
| cache_config | System | Cache settings |
| page_cache | System | Web scraping cache |
| extraction_cache | System | AI extraction cache |

### 2. Route/Query Audit Checklist

| Route File | Endpoints | Uses req.cellarId | Tested |
|------------|-----------|-------------------|--------|
| routes/wines.js | GET, POST, PUT, DELETE | [ ] | [ ] |
| routes/slots.js | GET, POST, PUT | [ ] | [ ] |
| routes/bottles.js | POST, DELETE | [ ] | [ ] |
| routes/pairing.js | POST | [ ] | [ ] |
| routes/reduceNow.js | GET, POST | [ ] | [ ] |
| routes/cellar.js | GET | [ ] | [ ] |
| routes/ratings.js | GET, POST | [ ] | [ ] |
| routes/backup.js | GET, POST | [ ] | [ ] |
| routes/drinkingWindows.js | GET, POST | [ ] | [ ] |
| routes/stats.js | GET | [ ] | [ ] |
| routes/settings.js | GET, PUT | [ ] | [ ] |
| routes/zones.js | GET, POST, PUT | [ ] | [ ] |
| routes/analysis.js | GET, POST | [ ] | [ ] |
| routes/vivino.js | GET, POST | [ ] | [ ] |

### 3. Cross-Tenant Regression Tests

```javascript
// tests/integration/multi-tenant.test.js
describe('Multi-tenant isolation', () => {
  let userA, userB, cellarA, cellarB;

  beforeAll(async () => {
    // Setup: Create two users with separate cellars
  });

  describe('Data isolation', () => {
    it('User A only sees Cellar A wines', async () => {
      const res = await request(app)
        .get('/api/wines')
        .set('Authorization', `Bearer ${userA.token}`)
        .set('X-Cellar-ID', cellarA.id);

      expect(res.body.data.every(w => w.cellar_id === cellarA.id)).toBe(true);
    });

    it('User A cannot access Cellar B', async () => {
      const res = await request(app)
        .get('/api/wines')
        .set('Authorization', `Bearer ${userA.token}`)
        .set('X-Cellar-ID', cellarB.id);

      expect(res.status).toBe(403);
    });
  });

  describe('Derived outputs', () => {
    it('Export only includes cellar data');
    it('Analysis cache scoped to cellar');
    it('Stats scoped to cellar');
  });
});
```

### 4. Migration Script

```sql
-- migrations/027_multi_tenant_setup.sql

-- 1. Create new tables (profiles, cellars, memberships, invites)
-- 2. Create default cellar
INSERT INTO cellars (id, name, description)
VALUES ('00000000-0000-0000-0000-000000000001', 'Louis Cellar', 'Original cellar');

-- 3. Backfill cellar_id
UPDATE wines SET cellar_id = '00000000-0000-0000-0000-000000000001';
UPDATE slots SET cellar_id = '00000000-0000-0000-0000-000000000001';
-- etc.

-- 4. Verify counts
SELECT 'wines' as tbl, COUNT(*) FROM wines
UNION ALL SELECT 'slots', COUNT(*) FROM slots;

-- 5. Add NOT NULL after verification
ALTER TABLE wines ALTER COLUMN cellar_id SET NOT NULL;
```

**Rollback:** Restore from Supabase point-in-time backup.

---

## Milestones & Gates

Each milestone has a **gate review** where progress is checked before proceeding. Generate progress report using the template in `docs/MULTI_USER_PROGRESS.md`.

---

### Milestone 1: Schema Ready (End of Day 1.5) ✅ PASSED

**Gate: Database Review**

| Checkpoint | Verified | Reviewer |
|------------|----------|----------|
| All new tables created (profiles, cellars, memberships, invites) | [x] | Automated |
| cellar_id added to all 17 user-data tables | [x] | Automated |
| All FKs have ON DELETE CASCADE | [x] | Automated |
| All cellar_id columns are NOT NULL | [x] | Automated |
| All cellar_id columns have indexes | [x] | Automated |
| Default cellar created with known UUID | [x] | Automated |
| Existing data backfilled to default cellar | [x] | Automated |
| Row counts match before/after migration | [x] | Automated |
| Migration 032a created for missing PostgreSQL tables | [x] | Automated |

**Blockers resolved:**
- Created migration 032a to add all missing tables (chat_sessions, palate_feedback, cellar_zones, etc.)
- Fixed migration 035 to use `preference_key` instead of `dimension` column

---

### Milestone 2: Auth Working (End of Day 3.5) ✅ PASSED

**Gate: Backend Auth Review**

| Checkpoint | Verified | Reviewer |
|------------|----------|----------|
| `@supabase/supabase-js` installed | [x] | Automated |
| Auth middleware validates JWT correctly | [x] | Automated |
| Invalid/expired tokens return 401 | [x] | Automated |
| Profile created on first login | [x] | Automated |
| Cellar context middleware validates membership | [x] | Automated |
| X-Cellar-ID spoofing returns 403 | [x] | Automated |
| Missing X-Cellar-ID uses active_cellar_id | [x] | Automated |
| Unit tests for auth middleware pass | [x] | 738/738 passing |
| Unit tests for cellar context pass | [x] | 738/738 passing |
| Integration tests pass | [x] | 28/28 passing |

**Blockers resolved:**
- All auth tests passing
- INTEGRATION_TEST_MODE implemented for test isolation

---

### Milestone 3: Routes Scoped (End of Day 5)

**Gate: Route Audit Review**

| Checkpoint | Verified | Reviewer |
|------------|----------|----------|
| All 14 route files use requireAuth | [ ] | |
| All 14 route files use requireCellarContext | [ ] | |
| All queries use req.cellarId (not body) | [ ] | |
| No query uses hardcoded cellar values | [ ] | |
| Route audit checklist 100% complete | [ ] | |
| Cross-tenant test: User A sees only Cellar A | [ ] | |
| Cross-tenant test: User A blocked from Cellar B | [ ] | |
| Derived outputs scoped (export, stats, analysis) | [ ] | |

**Blockers to resolve before proceeding:**
- Any route missing cellar scoping
- Cross-tenant test failing
- Export includes wrong cellar data

---

### Milestone 4: Frontend Complete (End of Day 7)

**Gate: Frontend & UX Review**

| Checkpoint | Verified | Reviewer |
|------------|----------|----------|
| Login page renders correctly | [ ] | |
| Google OAuth flow works | [ ] | |
| Apple OAuth flow works | [ ] | |
| Email/password signup works | [ ] | |
| JWT stored in localStorage | [ ] | |
| X-Cellar-ID sent with all API calls | [ ] | |
| Cellar switcher displays user's cellars | [ ] | |
| Switching cellar reloads with new data | [ ] | |
| 401 response triggers re-auth | [ ] | |
| Invite code required for new signup | [ ] | |

**Blockers to resolve before proceeding:**
- OAuth redirect broken
- Cellar switcher not updating
- API calls missing auth header

---

### Milestone 5: Beta Ready (End of Day 8)

**Gate: Final Review & Sign-off**

| Checkpoint | Verified | Reviewer |
|------------|----------|----------|
| All previous milestone gates passed | [ ] | |
| Test environment fully isolated | [ ] | |
| Production environment configured | [ ] | |
| Invite codes generated for testers | [ ] | |
| Existing owner can still access data | [ ] | |
| New user signup creates cellar | [ ] | |
| Soft quota warnings display | [ ] | |
| All regression tests pass | [ ] | |
| Security checklist complete | [ ] | |
| Documentation updated | [ ] | |

**Sign-off:**
- [ ] Dev Lead: _________________ Date: _______
- [ ] QA Lead: _________________ Date: _______
- [ ] Product: _________________ Date: _______

---

## Timeline

| Phase | Duration | Milestone |
|-------|----------|-----------|
| Phase 1: Database | 1.5 days | **M1: Schema Ready** |
| Phase 2: Backend Auth | 2 days | **M2: Auth Working** |
| Phase 2b: Route Scoping | 1.5 days | **M3: Routes Scoped** |
| Phase 3: Frontend | 2 days | **M4: Frontend Complete** |
| Phase 4: Environments + QA | 1 day | **M5: Beta Ready** |
| **Total** | **8 days** | |

---

## Definition of Done

- [ ] Users can sign up with Google, Apple, or email
- [ ] Users can sign in and out
- [ ] Each user sees only their cellar data
- [ ] Cellar switcher works for multi-cellar users
- [ ] X-Cellar-ID validated server-side
- [ ] All tables have cellar_id with NOT NULL + FK + Index
- [ ] Cross-tenant regression tests pass
- [ ] Existing data migrated to default cellar
- [ ] Invite codes required for beta signup
- [ ] Soft quotas warn at thresholds

---

## Security Checklist

- [ ] X-Cellar-ID header treated as untrusted (membership validated)
- [ ] All routes use `req.cellarId`, never trust request body
- [ ] FK constraints with ON DELETE CASCADE
- [ ] NOT NULL on cellar_id (no orphan records)
- [ ] Rate limiting per user
- [ ] JWT expiry handled (401 triggers re-auth)
- [ ] CSP headers set (no inline scripts)
- [ ] User-generated content escaped before render

---

## Mandatory Write Patterns (CRITICAL)

App-enforced isolation fails most often on writes. These patterns are **mandatory** for all routes:

### INSERT Pattern
```javascript
// CORRECT: Set cellar_id server-side from req.cellarId
router.post('/wines', async (req, res) => {
  const { wine_name, vintage, ...rest } = req.body;
  // NEVER accept cellar_id from client body
  await db.prepare(`
    INSERT INTO wines (cellar_id, wine_name, vintage, ...)
    VALUES ($1, $2, $3, ...)
  `).run(req.cellarId, wine_name, vintage, ...);
});

// WRONG: Accepting cellar_id from client
const { cellar_id, wine_name } = req.body; // NEVER DO THIS
```

### UPDATE Pattern
```javascript
// CORRECT: WHERE includes both id AND cellar_id
router.put('/wines/:id', async (req, res) => {
  const result = await db.prepare(`
    UPDATE wines
    SET wine_name = $1, vintage = $2
    WHERE id = $3 AND cellar_id = $4
  `).run(wine_name, vintage, req.params.id, req.cellarId);

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Wine not found' });
  }
});

// WRONG: WHERE only checks id (allows cross-cellar update)
WHERE id = $1  // NEVER DO THIS
```

### DELETE Pattern
```javascript
// CORRECT: WHERE includes both id AND cellar_id
router.delete('/wines/:id', async (req, res) => {
  const result = await db.prepare(`
    DELETE FROM wines WHERE id = $1 AND cellar_id = $2
  `).run(req.params.id, req.cellarId);

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Wine not found' });
  }
});

// WRONG: WHERE only checks id (allows cross-cellar delete)
WHERE id = $1  // NEVER DO THIS
```

### Code Review Checklist for Writes

| Check | Pattern | Required |
|-------|---------|----------|
| INSERT uses `req.cellarId` | `VALUES ($1, ...)` where $1 = req.cellarId | Yes |
| UPDATE WHERE includes `cellar_id` | `WHERE id = $1 AND cellar_id = $2` | Yes |
| DELETE WHERE includes `cellar_id` | `WHERE id = $1 AND cellar_id = $2` | Yes |
| Body never provides `cellar_id` | Destructure without cellar_id | Yes |
| 0-row updates return 404 | Check `result.changes === 0` | Yes |

---

## Files to Create/Modify

### New Files
- `src/middleware/auth.js`
- `src/middleware/cellarContext.js`
- `src/routes/cellars.js`
- `src/routes/profile.js`
- `public/js/auth.js`
- `public/js/cellarSwitcher.js`
- `public/login.html`
- `public/signup.html`
- `public/css/auth.css`
- `data/migrations/027-035_*.sql`
- `tests/integration/multi-tenant.test.js`

### Modified Files
- `src/server.js` (add auth middleware)
- `src/routes/*.js` (all route files - add cellar scoping)
- `public/js/api.js` (add auth + cellar headers)
- `public/js/app.js` (add auth init)
- `public/index.html` (add user menu + cellar switcher)
- `package.json` (new dependencies)

---

*Document created: 12 January 2026*
*Version 2.0 - Cellar-based tenancy with app-enforced isolation*
