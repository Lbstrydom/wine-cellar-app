# AGENTS.md - AI Assistant Guidelines

This document defines coding standards and conventions for AI assistants working on the Wine Cellar App.

---

## Project Overview

**Stack**: Node.js, Express, PostgreSQL (Supabase), Vanilla JS frontend
**Deployment**: Railway (auto-deploys from GitHub)
**Database**: Supabase PostgreSQL
**Purpose**: Personal wine cellar management with visual grid and AI-powered pairing

---

## Code Organisation

### Backend Structure

```
src/
├── server.js              # Express app setup, middleware, server start
├── routes/
│   ├── index.js           # Route aggregator
│   ├── wines.js           # /api/wines/* endpoints
│   ├── slots.js           # /api/slots/* endpoints
│   ├── bottles.js         # /api/bottles/* endpoints
│   ├── buyingGuideItems.js # /api/buying-guide-items/* endpoints (shopping cart)
│   ├── pairing.js         # /api/pairing/* endpoints (incl. manual pairing sessions)
│   ├── pendingRatings.js  # /api/pending-ratings/* endpoints (drink-now-rate-later)
│   ├── reduceNow.js       # /api/reduce-now/* endpoints + evaluateSingleWine() export
│   └── stats.js           # /api/stats endpoint
├── config/
│   ├── aiModels.js        # AI model registry, task→model mapping, thinking config
│   ├── styleIds.js        # Centralized style bucket IDs & labels (11 styles)
│   └── wineRegions.js     # Country→region mapping (50+ countries, 500+ regions)
├── services/
│   ├── ai/                # Claude/OpenAI/Gemini integration
│   ├── awards/            # Wine award extraction & matching
│   ├── cellar/            # Cellar analysis, placement, suggestions
│   ├── pairing/           # Food pairing engine & restaurant pairing
│   ├── ratings/           # Rating extraction & normalization
│   ├── recipe/            # Buying guide, shopping cart, style inference
│   ├── scraping/          # Web scraping & document fetching
│   ├── search/            # Google/SERP search pipeline, waterfall orchestration
│   ├── shared/            # Cross-domain utilities (cache, circuit breaker, JSON utils, etc.)
│   ├── wine/              # Wine identity, parsing, drinking windows
│   ├── zone/              # Zone management & reconfiguration
│   └── *.js               # 5 root orchestrators (acquisitionWorkflow, palateProfile, etc.)
└── db/
    ├── index.js           # Database abstraction (PostgreSQL via Supabase)
    ├── helpers.js         # PostgreSQL-specific query helpers
    └── postgres.js        # PostgreSQL implementation (pg) with SQLite-compatible API surface
```

### Frontend Structure

```
public/
├── index.html             # HTML structure only (no inline JS/CSS)
├── css/
│   ├── styles.css         # Global styles
│   └── components.css     # Component-specific styles (table, digest, diff grid, etc.)
└── js/
    ├── app.js             # Main app initialisation, state management
    ├── api/               # API calls (authenticated via apiFetch)
    │   ├── index.js       # Re-export barrel (all API functions)
    │   ├── base.js        # apiFetch wrapper (adds auth + cellar headers)
    │   ├── wines.js       # Wine CRUD + fetchWines
    │   ├── ratings.js     # Rating fetch + batch ratings
    │   ├── cellar.js      # Cellar analysis, grape backfill, layout
    │   ├── recipes.js     # Recipe/buying guide API
    │   ├── buyingGuideItems.js # Shopping cart API
    │   ├── settings.js    # User settings API
    │   ├── awards.js      # Award extraction API
    │   ├── pairing.js     # Food pairing API (incl. manual pairing)
    │   ├── pendingRatings.js # Pending ratings API (drink-now-rate-later)
    │   ├── restaurantPairing.js # Restaurant pairing API
    │   ├── acquisition.js # Wine acquisition workflow API
    │   ├── palate.js      # Palate profile API
    │   ├── health.js      # Cellar health API
    │   ├── profile.js     # User profile API
    │   └── errors.js      # Error logging API
    ├── config/            # Frontend configuration data
    │   └── wineRegions.js # Country→region mapping for dropdowns
    ├── pwa.js             # PWA install prompt, SW registration, update notification
    ├── grid.js            # Cellar/fridge grid rendering
    ├── modals.js          # Modal management
    ├── dragdrop.js        # Drag and drop functionality
    ├── sommelier.js       # Claude pairing UI
    ├── manualPairing.js   # Manual wine-dish pairing coordinator
    ├── ratingReminder.js  # Drink-now-rate-later reminder bar
    ├── bottles.js         # Bottle add/edit functionality
    │   └── bottles/
    │       ├── form.js    # Bottle form with cascading country/region dropdowns
    │       ├── modal.js   # Bottle modal management
    │       └── dropdownHelpers.js # Country/region dropdown population
    ├── utils.js           # Shared utility functions
    ├── cellarAnalysis/    # Cellar analysis & AI recommendations UI
    │   ├── state.js       # Shared analysis state, workspace switching, localStorage persistence
    │   ├── analysis.js    # Main analysis rendering & CTA logic
    │   ├── labels.js      # Shared CTA label constants (single source of truth)
    │   ├── aiAdvice.js    # AI Cellar Review view (HTML rendering, move badges, fridge annotations)
    │   ├── aiAdviceActions.js # AI Cellar Review controller (event wiring, execution)
    │   ├── issueDigest.js # Consolidated issue digest (replaces fragmented alerts)
    │   ├── moves.js       # Suggested moves rendering & execution
    │   ├── zones.js       # Zone grouping display
    │   ├── fridge.js      # Fridge analysis section
    │   ├── moveGuide.js   # Visual move guide wizard
    │   ├── zoneChat.js    # Zone-specific AI chat
    │   ├── zoneCapacityAlert.js    # Zone capacity issue alerts
    │   ├── zoneReconfigurationBanner.js  # Grouped zone reconfig banner
    │   └── zoneReconfigurationModal.js   # Zone reconfiguration dialog
    ├── recipes/           # Buying guide & shopping cart UI
    │   ├── buyingGuide.js # Buying guide with Add-to-Plan, dual coverage bars
    │   ├── cartState.js   # Cart state management
    │   └── cartPanel.js   # Cart panel (status grouping, batch actions, totals)
    └── restaurantPairing/ # Restaurant pairing assistant UI
        ├── state.js       # Session state management
        ├── imageCapture.js # Multi-image capture widget
        ├── wineReview.js  # Wine review & filter cards
        ├── dishReview.js  # Dish review cards
        ├── results.js     # Pairing results & recommendations
        ├── quickPair.js   # Quick pair shortcut
        └── currencyUtils.js # Currency detection, formatting & conversion
```

---

## Naming Conventions

### Files

| Type | Convention | Example |
|------|------------|---------|
| Route files | camelCase, noun | `wines.js`, `reduceNow.js` |
| Service files | camelCase, noun | `claude.js`, `pairing.js` |
| Frontend JS | camelCase, noun | `dragdrop.js`, `modals.js` |
| CSS files | kebab-case | `styles.css` |

### Variables and Functions

| Type | Convention | Example |
|------|------------|---------|
| Variables | camelCase | `wineId`, `bottleCount` |
| Functions | camelCase, verb-first | `getWines()`, `handleDrop()` |
| Constants | UPPER_SNAKE_CASE | `MAX_BOTTLES`, `API_BASE_URL` |
| Database columns | snake_case | `wine_name`, `bottle_count` |
| API endpoints | kebab-case | `/api/reduce-now`, `/api/wines` |

### CSS

| Type | Convention | Example |
|------|------------|---------|
| Classes | kebab-case | `.wine-card`, `.modal-overlay` |
| IDs | kebab-case | `#bottle-modal`, `#cellar-grid` |
| CSS variables | kebab-case with -- prefix | `--bg-dark`, `--text-muted` |

---

## Code Style

### JavaScript

```javascript
// Use ES6+ features
const wines = await fetchWines();
const { id, name } = wine;
const locations = slots.map(s => s.location_code);

// Use async/await over .then() chains
async function getWineDetails(id) {
  const response = await fetch(`/api/wines/${id}`);
  return response.json();
}

// Destructure parameters when helpful
function createSlot({ location_code, wine_id, wine_name }) {
  // ...
}

// Use template literals for string building
const html = `<div class="slot" data-location="${location}">${name}</div>`;
```

### Error Handling

```javascript
// Backend: Always return consistent error format
app.post('/api/example', async (req, res) => {
  try {
    // ... logic
    res.json({ message: 'Success', data: result });
  } catch (error) {
    console.error('Example error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Frontend: Handle errors gracefully
try {
  const data = await api.moveBottle(from, to);
  showToast(data.message);
} catch (err) {
  showToast(`Error: ${err.message}`);
}

// Async callbacks: ALWAYS wrap in try/catch to prevent unhandled rejections
supabase.auth.onAuthStateChange(async (event, session) => {
  try {
    // ... async operations
  } catch (err) {
    console.error('[Auth] callback error:', err);
    // Show user-friendly error + recover gracefully
  }
});
```

### Database Queries

```javascript
// Use prepared statements with async/await (PostgreSQL returns Promises)
const wine = await db.prepare('SELECT * FROM wines WHERE id = ?').get(wineId);

// Use STRING_AGG for aggregation
const getWineWithLocations = await db.prepare(`
  SELECT
    w.id,
    w.wine_name,
    COUNT(s.id) as bottle_count,
    STRING_AGG(s.location_code, ',') as locations
  FROM wines w
  LEFT JOIN slots s ON s.wine_id = w.id
  WHERE w.id = ?
  GROUP BY w.id
`).get(wineId);

// PostgreSQL syntax reminders:
// - Use ILIKE for case-insensitive search
// - Use STRING_AGG() for aggregation
// - Use CURRENT_TIMESTAMP for current time
// - Use INTERVAL '30 days' for date arithmetic
// - ? placeholders are auto-converted to $1, $2 by postgres.js
```

### PostgreSQL Async Patterns (CRITICAL)

The database abstraction layer (`src/db/postgres.js`) returns Promises. **All route handlers and services must use async/await.**

```javascript
// ✅ CORRECT: async route handler with await
router.get('/wines', async (req, res) => {
  const wines = await db.prepare('SELECT * FROM wines').all();
  res.json({ data: wines });
});

// ❌ WRONG: Missing async/await - returns Promise, not data
router.get('/wines', (req, res) => {
  const wines = db.prepare('SELECT * FROM wines').all(); // Returns Promise!
  res.json({ data: wines }); // Sends Promise object, not results
});

// ✅ CORRECT: Service function with async
export async function getWineById(id) {
  return await db.prepare('SELECT * FROM wines WHERE id = ?').get(id);
}

// ❌ WRONG: Sync-style function call
export function getWineById(id) {
  return db.prepare('SELECT * FROM wines WHERE id = ?').get(id); // Returns Promise!
}
```

**Common Symptoms of Missing Async:**
- API returns `{}` or `[object Promise]`
- Railway logs show no errors but data is empty
- Route works in tests with mocks but fails with real PostgreSQL

**Checklist When Adding New Routes/Services:**
1. Is the route handler `async`?
2. Are all `db.prepare().get/all/run()` calls `await`ed?
3. Are service functions that call DB marked `async`?
4. Are service function calls `await`ed in route handlers?

---

## Data Integrity Patterns

### Move/Batch Operations Must Validate First

When implementing operations that modify multiple records (moves, swaps, batch updates):

```javascript
// ✅ CORRECT: Validate before execution
const validation = await validateMovePlan(moves);
if (!validation.valid) {
  return res.status(409).json({ error: 'Validation failed', conflicts: validation.errors });
}

// Execute only after validation passes
await db.prepare('BEGIN TRANSACTION').run();
try {
  for (const move of moves) {
    await executeMove(move);
  }
  await db.prepare('COMMIT').run();
} catch (err) {
  await db.prepare('ROLLBACK').run();
  throw err;
}
```

### Track Allocated Resources in Batch Operations

When generating suggestions that allocate resources (slots, IDs, etc.), track what's been allocated within the batch:

```javascript
// ✅ CORRECT: Track allocated targets to prevent collisions
const allocatedTargets = new Set();

for (const item of items) {
  const target = findAvailableTarget(occupiedSet);
  if (target && !allocatedTargets.has(target)) {
    suggestions.push({ from: item.current, to: target });
    allocatedTargets.add(target); // Mark as allocated
  }
}

// ❌ WRONG: Each iteration doesn't know about previous allocations
for (const item of items) {
  const target = findAvailableTarget(occupiedSet); // May return same target twice!
  suggestions.push({ from: item.current, to: target });
}
```

### Invariant Checks for Critical Operations

For operations that must not lose data:

```javascript
// Count before
const beforeCount = await db.prepare('SELECT COUNT(*) as count FROM slots WHERE wine_id IS NOT NULL').get();

// ... perform operations ...

// Count after
const afterCount = await db.prepare('SELECT COUNT(*) as count FROM slots WHERE wine_id IS NOT NULL').get();

if (afterCount.count !== beforeCount.count) {
  await db.prepare('ROLLBACK').run();
  throw new Error(`Data integrity violation: count changed from ${beforeCount.count} to ${afterCount.count}`);
}
```

### Zone Reconfiguration Defence-in-Depth

The zone reconfiguration pipeline (`cellarReconfiguration.js` + `zoneReconfigurationPlanner.js`) uses multiple layers of validation to prevent duplicate row assignments and colour-region violations:

**Pipeline layers** (solver → LLM refinement → heuristic gap-fill → OpenAI reviewer):

```
Solver (rowAllocationSolver.js)     ← Handles colour + dedup correctly
  ↓
LLM refinement                      ← filterLLMActions() REJECTS violations
  ↓
Heuristic gap-fill                  ← Uses live post-pipeline zone row map
  ↓
OpenAI reviewer patches             ← Post-patch revalidation re-runs filterLLMActions
  ↓
DB apply (reallocateRowTransactional) ← Colour guard + dedup at write time
  ↓
In-transaction integrity gate       ← validateAllocationIntegrity() fails TX on dupes
```

**Key invariants**:
- No row may appear in more than one zone after reconfiguration
- White-family zones (white, rosé, orange, sparkling, dessert, fortified) must stay in white-region rows
- Red zones must stay in red-region rows
- `buildMutatedZoneRowMap()` replays all action types to maintain accurate post-pipeline state
- `heuristicGapFill` receives live (not stale) zone row map and checks colour compatibility before donating rows

**When modifying the reconfiguration pipeline**:
1. Always dedup rows before appending: `[...rows.filter(r => r !== newRow), newRow]`
2. Always check colour compatibility using `getEffectiveZoneColor()` + dynamic row ranges
3. Run `filterLLMActions` after any external modifications (e.g., reviewer patches)
4. Keep `validateAllocationIntegrity` as the last-resort gate inside the transaction

---

## Multi-User / Cellar-Scoped Patterns (CRITICAL)

The app uses **cellar-based tenancy** with Supabase Auth. All user data is scoped to a `cellar_id`. NEVER trust client-provided scope without server-side validation.

### Authentication Flow

```
Frontend (Supabase JS) → Supabase Auth (OAuth/Email) → JWT Token
                                                           ↓
Express API ← Authorization: Bearer <token> ← Frontend
     ↓
requireAuth middleware → verifies JWT via JWKS
     ↓
requireCellarContext middleware → validates X-Cellar-ID header
     ↓
Route handler receives: req.user, req.cellarId, req.cellarRole
```

### Middleware Chain

All data routes MUST use this middleware chain:

```javascript
// src/routes/index.js
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import { requireCellarContext } from '../middleware/cellarContext.js';

// Protected routes (require auth + cellar)
router.use('/api/wines', requireAuth, requireCellarContext, winesRouter);
router.use('/api/slots', requireAuth, requireCellarContext, slotsRouter);

// Public routes (no auth needed)
router.use('/api/health', healthRouter);
```

### Route Query Patterns (CRITICAL)

**All queries MUST include `cellar_id` filter using `req.cellarId`:**

```javascript
// ✅ CORRECT: Use req.cellarId from middleware
router.get('/', async (req, res) => {
  const wines = await db.prepare(`
    SELECT * FROM wines WHERE cellar_id = $1
  `).all(req.cellarId);
  res.json({ data: wines });
});

// ❌ WRONG: No cellar scope - returns ALL users' data!
router.get('/', async (req, res) => {
  const wines = await db.prepare(`SELECT * FROM wines`).all();
  res.json({ data: wines });
});

// ❌ WRONG: Trusting client-provided cellar_id
router.get('/', async (req, res) => {
  const wines = await db.prepare(`
    SELECT * FROM wines WHERE cellar_id = $1
  `).all(req.body.cellar_id);  // NEVER trust request body for scope!
});
```

### INSERT/UPDATE/DELETE Patterns

```javascript
// INSERT: Set cellar_id server-side, NEVER from request body
router.post('/', async (req, res) => {
  const { wine_name, vintage } = req.body;  // NO cellar_id from body!
  await db.prepare(`
    INSERT INTO wines (cellar_id, wine_name, vintage)
    VALUES ($1, $2, $3)
  `).run(req.cellarId, wine_name, vintage);  // Use req.cellarId
});

// UPDATE: WHERE clause MUST include cellar_id
router.put('/:id', async (req, res) => {
  const result = await db.prepare(`
    UPDATE wines SET wine_name = $1
    WHERE id = $2 AND cellar_id = $3
  `).run(wine_name, req.params.id, req.cellarId);

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Wine not found' });
  }
});

// DELETE: WHERE clause MUST include cellar_id
router.delete('/:id', async (req, res) => {
  const result = await db.prepare(`
    DELETE FROM wines WHERE id = $1 AND cellar_id = $2
  `).run(req.params.id, req.cellarId);

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Wine not found' });
  }
});
```

### Related Table Joins

When joining tables, ensure cellar isolation is maintained:

```javascript
// ✅ CORRECT: Filter wines by cellar, slots inherit from wines FK
const layout = await db.prepare(`
  SELECT s.*, w.wine_name
  FROM slots s
  LEFT JOIN wines w ON w.id = s.wine_id AND w.cellar_id = $1
  WHERE s.cellar_id = $1
`).all(req.cellarId);

// ❌ WRONG: Missing cellar filter allows cross-tenant data leaks
const layout = await db.prepare(`
  SELECT s.*, w.wine_name
  FROM slots s
  LEFT JOIN wines w ON w.id = s.wine_id
`).all();  // Returns ALL cellars!
```

### X-Cellar-ID Header Validation

The `requireCellarContext` middleware validates the `X-Cellar-ID` header:

1. If header provided → verify user is a member of that cellar
2. If no header → use user's `active_cellar_id` from profile
3. Sets `req.cellarId` and `req.cellarRole` for use in routes

**Never bypass this validation!**

### Role-Based Access

```javascript
import { requireCellarEdit, requireCellarOwner } from '../middleware/cellarContext.js';

// Viewer can read, editor can write, owner can delete
router.get('/', requireAuth, requireCellarContext, getWines);  // Any role
router.post('/', requireAuth, requireCellarContext, requireCellarEdit, createWine);  // Editor+
router.delete('/:id', requireAuth, requireCellarContext, requireCellarOwner, deleteWine);  // Owner only
```

---

## Content Security Policy (CSP) Compliance

### No Inline Event Handlers

CSP blocks inline JavaScript. Never use `onclick`, `onchange`, etc. in HTML:

```html
<!-- ❌ WRONG: Blocked by CSP -->
<button onclick="handleClick()">Click</button>

<!-- ✅ CORRECT: Wire up in JavaScript -->
<button id="my-button">Click</button>
```

```javascript
// In your JS file
document.getElementById('my-button').addEventListener('click', handleClick);
```

### Dynamic Element Event Binding

For dynamically created elements, wire events after creation:

```javascript
// ✅ CORRECT: Add listeners after creating HTML
container.innerHTML = items.map(item => `
  <button class="item-btn" data-id="${item.id}">Action</button>
`).join('');

container.querySelectorAll('.item-btn').forEach(btn => {
  btn.addEventListener('click', (e) => handleItemClick(e.target.dataset.id));
});
```

---

## Documentation

### JSDoc for Functions

```javascript
/**
 * Move a bottle from one slot to another.
 * @param {string} fromLocation - Source slot code (e.g., "R3C1", "F2")
 * @param {string} toLocation - Target slot code (must be empty)
 * @returns {Promise<{message: string}>}
 * @throws {Error} If source is empty or target is occupied
 */
async function moveBottle(fromLocation, toLocation) {
  // ...
}
```

### File Headers

```javascript
/**
 * @fileoverview Handles wine CRUD operations.
 * @module routes/wines
 */
```

### Inline Comments

```javascript
// Use sparingly - only for non-obvious logic
const maxCol = row === 1 ? 7 : 9; // Row 1 has 7 slots, others have 9

// Good: explains WHY
// Check for consecutive slots because bottles are stored in runs
const consecutiveSlots = findConsecutiveEmpty(start, quantity);

// Bad: explains WHAT (code already shows this)
// Loop through wines
wines.forEach(wine => { ... });
```

---

## SOLID Principles

### Single Responsibility

Each file/module should do ONE thing:

```javascript
// Good: routes/wines.js only handles wine endpoints
// Good: services/claude.js only handles Claude API calls

// Bad: server.js with 500 lines handling everything
```

### Open/Closed

Design for extension without modification:

```javascript
// Good: pairing signals are data-driven
const SIGNALS = ['chicken', 'beef', 'fish', ...];

// Bad: hardcoded if/else chains for each signal
```

### Dependency Injection

Pass dependencies rather than importing directly where practical:

```javascript
// Good: pass db connection
function createWineRoutes(db) {
  const router = express.Router();
  // ...
  return router;
}

// Usage in server.js
app.use('/api/wines', createWineRoutes(db));
```

---

## API Design

### RESTful Conventions

| Action | Method | Endpoint | Body |
|--------|--------|----------|------|
| List wines | GET | `/api/wines` | - |
| Get wine | GET | `/api/wines/:id` | - |
| Create wine | POST | `/api/wines` | Wine object |
| Update wine | PUT | `/api/wines/:id` | Wine object |
| Delete wine | DELETE | `/api/wines/:id` | - |

### Response Format

```javascript
// Success
{
  "message": "Wine added",
  "data": { "id": 85 }
}

// Success with list
{
  "data": [{ ... }, { ... }],
  "count": 42
}

// Error
{
  "error": "Wine not found"
}
```

### Status Codes

| Code | Usage |
|------|-------|
| 200 | Success |
| 201 | Created |
| 400 | Bad request (validation error) |
| 404 | Not found |
| 500 | Server error |
| 503 | Service unavailable (e.g., Claude API not configured) |

---

## Frontend Patterns

### State Management

```javascript
// Keep state in app.js
const state = {
  layout: null,
  currentModal: null,
  draggedSlot: null,
  selectedWineId: null
};

// Export functions to modify state
function setDraggedSlot(slot) {
  state.draggedSlot = slot;
}
```

### Event Handling

```javascript
// Use event delegation where appropriate
document.getElementById('cellar-grid').addEventListener('click', (e) => {
  const slot = e.target.closest('.slot');
  if (slot) handleSlotClick(slot);
});

// Name handlers consistently: handle[Event][Element]
function handleClickSlot(slot) { ... }
function handleDragStartSlot(e) { ... }
function handleSubmitBottleForm(e) { ... }
```

### DOM Updates

```javascript
// Prefer innerHTML for bulk updates
container.innerHTML = wines.map(w => createWineCard(w)).join('');

// Use DOM methods for single updates
const el = document.createElement('div');
el.className = 'slot';
parent.appendChild(el);
```

### Frontend API Calls (CRITICAL)

**All API calls to `/api/*` endpoints MUST use `api/` module functions, not raw `fetch()`.**

The `api/base.js` module provides `apiFetch` which automatically adds:
- `Authorization: Bearer <token>` header (Supabase JWT)
- `X-Cellar-ID: <cellar_id>` header (multi-tenant isolation)

All domain-specific API functions are re-exported from `api/index.js`.

```javascript
// ✅ CORRECT: Use api/ exported functions
import { fetchWines, updateWine, batchFetchRatings } from './api/index.js';

const wines = await fetchWines();
await updateWine(id, { colour: 'red' });

// ✅ CORRECT: Use the fetch from api/base.js (automatically authenticated)
import { fetch } from './api/base.js';  // This is actually apiFetch

const response = await fetch('/api/wines');  // Includes auth headers

// ❌ WRONG: Raw fetch() bypasses authentication
const response = await window.fetch('/api/wines');  // No auth headers!
const response = await fetch('/api/backup/info');  // 401 error!
```

**Why This Matters**:
- Raw `fetch()` calls return 401 Unauthorized errors
- Data may leak to wrong cellar without X-Cellar-ID header
- Authentication errors are silent and hard to debug

**Regression Test**: `tests/unit/utils/apiAuthHeaders.test.js` scans all frontend JS files for raw `fetch('/api/...)` patterns and fails if found in new files.

**Legacy Files**: Raw fetch() remains only in `public/js/app.js` (public-config/auth bootstrap) and `public/js/browserTests.js` (test-only). Keep the allowlist minimal; new API calls must go through `public/js/api/` modules (including optional-auth error logging).

---

## Testing

The project uses **Vitest** for testing with self-contained integration tests that automatically manage server lifecycle.

### Test Commands

| Command | What it does | Server needed? |
|---------|--------------|----------------|
| `npm run test:unit` | Runs 2123 unit tests (~3s) | ❌ No |
| `npm run test:integration` | Runs 21 integration tests (~3s) | ✅ Auto-managed |
| `npm run test:all` | Runs unit then integration | ✅ Auto-managed |
| `npm run test:coverage` | Runs with coverage report | ❌ No |

### Recommended Workflow

```bash
# Day-to-day development (fast, no server needed)
npm run test:unit

# Before commit (full validation)
npm run test:all

# After Railway deploy (prod smoke check)
curl -s https://cellar.creathyst.com/health/ready | jq
```

### File Structure

```
tests/
├── integration/
│   ├── api.test.js         # API endpoint tests
│   ├── setup.js             # Auto-starts/stops server
│   └── vitest.config.js     # Integration-specific config
└── unit/
    ├── config/              # Config module tests
    ├── middleware/          # Middleware tests
    ├── routes/              # Route tests (supertest)
    ├── services/            # Service tests (mirrors src/services/ subdirs)
    │   ├── cellar/          # Cellar service tests
    │   ├── pairing/         # Pairing service tests
    │   ├── ratings/         # Rating service tests
    │   ├── recipe/          # Buying guide, cart, style inference tests
    │   ├── search/          # Search service tests
    │   ├── shared/          # Shared service tests
    │   └── wine/            # Wine service tests
    ├── cellarAnalysis/      # Frontend cellar analysis tests
    └── utils/               # Utility tests
```

### How Integration Tests Work

Integration tests use Vitest's `globalSetup` to automatically:
1. Check if a server is already running on port 3000
2. If not, spawn `node src/server.js` as a child process
3. Wait for `/health/live` to respond before running tests
4. Kill the server after tests complete

This means you can run `npm run test:integration` with zero manual setup.

### Debugging Integration Tests

```bash
# See server output during tests
DEBUG_INTEGRATION=1 npm run test:integration
```

### No-Isolate Mock Hygiene (CRITICAL)

Unit tests run with `--no-isolate`, so leaked mocks can break unrelated suites.

- If a test file needs real implementations despite global mocks, import them with `vi.importActual(...)` in `beforeAll`.
- Avoid `vi.resetModules()` in shared-process test runs unless strictly necessary; it can reset module state used by later suites.
- Reset mutable mocks in `beforeEach` (`vi.clearAllMocks()` or `vi.restoreAllMocks()`) when tests override mock behavior.

### Test Structure

```javascript
describe('Wine Routes', () => {
  describe('GET /api/wines', () => {
    it('returns all wines with bottle counts', async () => {
      // ...
    });

    it('filters by colour when specified', async () => {
      // ...
    });
  });
});
```

---

## Git Conventions

### Commit Messages

```
feat: add drag-and-drop bottle movement
fix: correct slot count in fridge row 1
refactor: split server.js into route modules
docs: add API documentation
style: format CSS with consistent spacing
test: add wine route tests
```

### Branch Naming

```
feature/drag-drop
fix/fridge-layout
refactor/modular-structure
```

---

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | Server port (default: 3000) | No |
| `NODE_ENV` | Environment (production/development) | No |
| `DATABASE_URL` | PostgreSQL connection string (Supabase) — **required** for all environments | Yes |
| `SUPABASE_URL` | Supabase project URL (e.g., `https://xxx.supabase.co`) | For multi-user auth |
| `SUPABASE_ANON_KEY` | Supabase anonymous/public key (frontend) | For multi-user auth |
| `ANTHROPIC_API_KEY` | Claude API key for sommelier feature | For AI features |
| `CLAUDE_MODEL` | Override Claude model for ALL tasks | No (default: per-task mapping) |
| `CLAUDE_MODEL_<TASK>` | Override model for specific task (e.g., `CLAUDE_MODEL_CELLARANALYSIS`) | No |
| `CLAUDE_AUDIT_CELLAR_MOVES` | Enable Opus move auditor in cellar analysis (`true`/`1`) | No (default: false) |
| `CLAUDE_AUDIT_RESTAURANT_PAIRINGS` | Enable Opus pairing auditor (`true`/`1`) | No (default: false) |
| `CLAUDE_AUDIT_TIMEOUT_MS` | Move auditor timeout in ms (clamped 5000-120000) | No (default: 45000) |
| `CLAUDE_AUDIT_RESTAURANT_PAIRINGS_TIMEOUT_MS` | Pairing auditor timeout in ms (clamped 5000-90000) | No (default: 30000) |
| `BRIGHTDATA_API_KEY` | BrightData API key | For web scraping |
| `BRIGHTDATA_SERP_ZONE` | BrightData SERP zone name | For search results |
| `BRIGHTDATA_WEB_ZONE` | BrightData Web Unlocker zone | For blocked sites |
| `GEMINI_API_KEY` | Google Gemini API key for Tier 2b fallback (Claude Web Search is primary) | No (fallback only) |
| `OPENAI_API_KEY` | OpenAI API key for GPT reviewer | For AI reviewer |
| `OPENAI_REVIEW_ZONE_RECONFIG` | Enable GPT zone reconfig reviewer (`true`/`false`) | No (default: false) |
| `OPENAI_REVIEW_CELLAR_ANALYSIS` | Enable GPT cellar analysis reviewer (`true`/`false`) | No (default: false) |
| `OPENAI_REVIEW_ZONE_CAPACITY` | Enable GPT zone capacity reviewer (`true`/`false`) | No (default: false) |
| `OPENAI_REVIEW_MODEL` | Override default reviewer model | No (default: gpt-5.2) |
| `OPENAI_REVIEW_MAX_OUTPUT_TOKENS` | Max tokens for reviewer output | No (default: 1500) |
| `OPENAI_REVIEW_REASONING_EFFORT` | Reasoning effort (`low`/`medium`/`high`) | No (default: medium) |
| `OPENAI_REVIEW_TIMEOUT_MS` | Reviewer timeout in milliseconds | No (default: 20000) |

---

## MCP Servers (Model Context Protocol)

This project uses MCP servers to extend Claude Code's capabilities. MCP servers are configured in `.mcp.json` (gitignored as it contains API keys).

### Available MCP Servers

| Server | Purpose | Key Tools |
|--------|---------|-----------|
| **pdf-reader** | Extract text, metadata, and images from PDFs | `read_pdf` |
| **filesystem** | Secure file operations within project directory | `read_text_file`, `write_file`, `edit_file`, `search_files`, `directory_tree` |
| **memory** | Persistent knowledge graph across sessions | `create_entities`, `create_relations`, `search_nodes`, `read_graph` |
| **brightdata** | Web scraping, SERP, browser automation | `search_engine`, `scrape_as_markdown`, `web_data_*` APIs |

### Configuration (`.mcp.json`)

```json
{
  "mcpServers": {
    "pdf-reader": {
      "command": "npx",
      "args": ["-y", "@sylphx/pdf-reader-mcp"]
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "c:/GIT/wine-cellar-app"]
    },
    "memory": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"]
    },
    "brightdata": {
      "command": "npx",
      "args": ["-y", "@brightdata/mcp"],
      "env": {
        "API_TOKEN": "<your-brightdata-api-key>",
        "PRO_MODE": "true"
      }
    }
  }
}
```

### When to Use Each MCP Server

#### PDF Reader (`mcp__pdf-reader__read_pdf`)
Use for wine award extraction from PDF booklets:
```javascript
// Extract awards from a competition PDF
mcp__pdf-reader__read_pdf({
  sources: [{ path: "awards/michelangelo-2024.pdf" }],
  include_full_text: true
})
```

#### Filesystem (`mcp__filesystem__*`)
Use for file operations when you need more control than built-in tools:
- `directory_tree` - Get recursive JSON structure of directories
- `search_files` - Find files matching patterns
- `edit_file` - Pattern-based edits with dry-run preview

#### Memory (`mcp__memory__*`)
Use for persistent context across sessions:
```javascript
// Remember user preferences
mcp__memory__create_entities({
  entities: [{
    name: "user_preferences",
    entityType: "config",
    observations: ["Prefers South African wines", "Serves reds at 16-18°C"]
  }]
})

// Create relationships
mcp__memory__create_relations({
  relations: [{
    from: "Kanonkop_Pinotage",
    to: "user_preferences",
    relationType: "FAVORITE_OF"
  }]
})

// Query the knowledge graph
mcp__memory__search_nodes({ query: "wine preferences" })
```

#### Bright Data (`mcp__brightdata__*`)
Use for web scraping when built-in fetch isn't sufficient:
- `search_engine` - AI-optimized web search
- `scrape_as_markdown` - Convert any webpage to clean markdown
- `web_data_*` - Structured data from Amazon, LinkedIn, etc.

### MCP vs Built-in Tools

| Task | Use MCP | Use Built-in |
|------|---------|--------------|
| Read project files | ❌ | ✅ `Read` tool |
| Edit specific lines | ❌ | ✅ `Edit` tool |
| Search code | ❌ | ✅ `Grep`/`Glob` tools |
| Extract PDF text | ✅ `pdf-reader` | ❌ |
| Persistent memory | ✅ `memory` | ❌ |
| Scrape blocked sites | ✅ `brightdata` | ❌ `WebFetch` may fail |
| Directory tree JSON | ✅ `filesystem` | ❌ |

### Adding New MCP Servers

1. Add server config to `.mcp.json`
2. Add server name to `.claude/settings.local.json` → `enabledMcpjsonServers`
3. Restart Claude Code

---

## Deployment

The app is deployed to **Railway** with auto-deploy from GitHub. Database is hosted on **Supabase** (PostgreSQL).

### How Deployment Works

1. Push to `main` branch on GitHub
2. Railway automatically detects the push and deploys
3. The app connects to Supabase PostgreSQL via `DATABASE_URL`

### Quick Reference

| Action | Command |
|--------|---------|
| Deploy | `git push origin main` (auto-deploys) |
| View logs | `railway logs` |
| Check status | `railway status` |
| Open dashboard | `railway open` |
| Test API | `curl -s https://cellar.creathyst.com/api/stats` |

### Railway CLI

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Link to project (if needed)
railway link

# View logs
railway logs --tail 100

# Open Railway dashboard
railway open
```

### Key URLs

| Item | URL |
|------|-----|
| Production | https://cellar.creathyst.com |
| Railway Dashboard | https://railway.app/project/wine-cellar-app |
| Supabase Dashboard | https://supabase.com/dashboard |
| GitHub Repo | https://github.com/Lbstrydom/wine-cellar-app |

### Environment Variables (Railway)

Set these in Railway dashboard → Variables:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Supabase PostgreSQL connection string |
| `ANTHROPIC_API_KEY` | Claude API key |
| `BRIGHTDATA_API_KEY` | BrightData API key |
| `BRIGHTDATA_SERP_ZONE` | BrightData SERP zone |
| `BRIGHTDATA_WEB_ZONE` | BrightData Web zone |

### Custom Domain Setup

The app uses Cloudflare for DNS with a CNAME record pointing to Railway:
- Domain: `cellar.creathyst.com`
- CNAME target: `qxi4wlbz.up.railway.app`

### Local Development

```bash
# Install dependencies
npm install

# Run locally (requires DATABASE_URL in .env pointing to Supabase/PostgreSQL)
npm run dev
```

### Cache Busting

When updating frontend files, bump the cache version in two places:
1. `public/index.html` - Update `?v=YYYYMMDDX` in CSS import
2. `public/sw.js` - Update `CACHE_VERSION` constant and match CSS `?v=` strings

This forces browsers to reload fresh assets instead of using cached versions.

### Service Worker Pre-Cache (CRITICAL)

When adding a **new frontend JS module**, you MUST add it to the `STATIC_ASSETS` array in `public/sw.js`. If a module is reachable from `app.js` via static imports but missing from `STATIC_ASSETS`, the SW will serve a stale cached copy on the next deploy — causing `SyntaxError` on missing exports and crashing the entire app.

**Regression test**: `tests/unit/utils/swStaticAssets.test.js` walks the import tree from `app.js` and `pairing.js`, and fails if any reachable module is missing from `STATIC_ASSETS`. Run `npm run test:unit` to catch this before deploy.

**Checklist when adding new frontend files:**
1. Add the file path to `STATIC_ASSETS` in `public/sw.js`
2. Bump `CACHE_VERSION` in `public/sw.js`
3. Match CSS `?v=` strings between `index.html` and `sw.js`
4. Run `npm run test:unit` — the `swStaticAssets` test will catch misses

---

## Claude API Integration

### Shared Client (`claudeClient.js`)

All Claude API calls use a shared Anthropic client singleton (`src/services/ai/claudeClient.js`) with 180s timeout. **Do NOT create `new Anthropic()` instances in service files.**

```javascript
// ✅ CORRECT: Import shared client
import anthropic from '../ai/claudeClient.js';

// ❌ WRONG: Creating a new client per file
import Anthropic from '@anthropic-ai/sdk';
const anthropic = new Anthropic({ timeout: 120000 });
```

### Model Registry (`aiModels.js`)

All model selection is centralized in `src/config/aiModels.js`. Tasks map to models via `TASK_MODELS`:

| Task | Model | Thinking Effort |
|------|-------|-----------------|
| `zoneCapacityAdvice` | Opus 4.6 | medium |
| `awardExtraction` | Opus 4.6 | medium |
| `cellarAnalysis` | Sonnet 4.6 | low |
| `restaurantPairing` | Sonnet 4.6 | low |
| `drinkRecommendations` | Sonnet 4.6 | low |
| `zoneReconfigurationPlan` | Sonnet 4.6 | low |
| `moveAudit` | Opus 4.6 | medium |
| `pairingAudit` | Opus 4.6 | medium |
| `webSearch` | Sonnet 4.6 | none |
| `sommelier`, `parsing`, `ratings` | Sonnet 4.6 | none |
| `menuParsing`, `tastingExtraction` | Sonnet 4.6 | none |
| `ratingExtraction` | Haiku 4.5 | none |
| `signalAudit` | Haiku 4.5 | none |
| `wineClassification`, `simpleValidation` | Haiku 4.5 | none |

```javascript
import { getModelForTask, getThinkingConfig } from '../../config/aiModels.js';

const modelId = getModelForTask('cellarAnalysis');  // 'claude-sonnet-4-6'
const thinking = getThinkingConfig('cellarAnalysis');
// { thinking: { type: 'adaptive' }, output_config: { effort: 'low' } }

const thinking2 = getThinkingConfig('sommelier');
// null (no thinking for this task)
```

**Environment overrides** (checked in order):
1. `CLAUDE_MODEL` — overrides ALL tasks
2. `CLAUDE_MODEL_<TASK>` — overrides specific task (e.g., `CLAUDE_MODEL_CELLARANALYSIS`)
3. `TASK_MODELS[task]` — default mapping

### Adaptive Thinking API Pattern

Claude Opus 4.6 supports adaptive thinking via `thinking: { type: 'adaptive' }` + `output_config: { effort }`. The `getThinkingConfig()` helper returns a flat object to spread into API calls:

```javascript
// ✅ CORRECT: Spread thinking config into API call
const response = await anthropic.messages.create({
  model: modelId,
  max_tokens: 32000,
  system: systemPrompt,
  messages: [{ role: 'user', content: userPrompt }],
  ...(getThinkingConfig('cellarAnalysis') || {})
});

// ❌ WRONG: Using temperature with thinking (API rejects this)
const response = await anthropic.messages.create({
  model: modelId,
  temperature: 0.2,  // INCOMPATIBLE with thinking!
  ...(getThinkingConfig('cellarAnalysis') || {})
});
```

**Key constraints:**
- `temperature` is **incompatible** with adaptive thinking — the API will reject the request
- Thinking tokens count against `max_tokens` — use 32000 for complex tasks, 16000 for simpler tasks
- Non-thinking tasks (speed-sensitive Sonnet tasks, Haiku) return `null` from `getThinkingConfig()`, so the spread is a no-op

### Response Handling (`claudeResponseUtils.js`)

When thinking is enabled, `response.content` contains `thinking`, `redacted_thinking`, and `text` blocks interleaved. **Never use `response.content[0].text`** — use the utility functions:

```javascript
import { extractText } from '../ai/claudeResponseUtils.js';
import { extractStreamText } from '../ai/claudeResponseUtils.js';

// Non-streaming: extracts last non-empty text block (skips thinking blocks)
const text = extractText(response);

// Streaming: collects only text_delta events (ignores thinking_delta)
const stream = await anthropic.messages.create({ ...params, stream: true });
const text = await extractStreamText(stream);
```

**Streaming event filtering** — `extractStreamText()` uses the exact condition:
```javascript
event.type === 'content_block_delta' && event.delta.type === 'text_delta'
```
This ignores `thinking_delta`, `content_block_start`, `content_block_stop`, and other event types.

### Token Limits by Task

Thinking tokens count against `max_tokens`. Set limits high enough for thinking + output:

| Task | `max_tokens` | Reason |
|------|-------------|--------|
| Cellar analysis (Sonnet 4.6) | 16000 | ~2K JSON output + low-effort thinking |
| Restaurant pairing (Sonnet 4.6) | 16000 | Pairing reasoning + low-effort thinking |
| Zone reconfiguration (Sonnet 4.6) | 8000 | Algorithmic solver does primary planning; LLM refines |
| Move audit (Opus 4.6) | 16000 | Audits move plans with medium thinking before advice rendering |
| Pairing audit (Opus 4.6) | 12000 | Validates and normalizes pairing outputs before response |
| Zone capacity advice (Opus 4.6) | 16000 | ~1.2K JSON output + up to 5K thinking |
| Award extraction (Opus 4.6) | 32000 | Large JSON output + thinking |
| Sommelier (Sonnet 4.6, no thinking) | 8192 | Speed-sensitive, no thinking needed |

### Auditor Module Pattern (CRITICAL)

All LLM auditors should follow the shared pattern used by move and pairing auditors.

- Reuse `src/services/shared/auditUtils.js` for `parseEnvBool`, `parseTimeoutMs`, `extractJsonFromText`, `toAuditMetadata`, and shared enum sets.
- Keep optimization integrity checks strict: if normalized optimized output fails validation, downgrade verdict to `flag` and return original domain output.
- Keep graceful degradation: timeout/API/schema errors must return `{ skipped: true, reason, latencyMs }` instead of throwing into the main flow.
- Prefer `toAuditMetadata()` at integration points (`cellarAnalysis`, `restaurantPairing`) instead of duplicating audited/skipped metadata blocks.

---

## OpenAI API Integration

### Structured Outputs with responses.parse()

**PREFERRED**: Use `responses.parse()` with `zodTextFormat()` for type-safe structured outputs:

```javascript
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';

const ResultSchema = z.object({
  verdict: z.enum(['approve', 'reject']),
  reasoning: z.string().max(500),
  items: z.array(z.object({ id: z.number() })).max(20)
});

const response = await openai.responses.parse({
  model: 'gpt-5.2',  // Use full model for complex tasks like zone reconfiguration
  input: [
    { role: 'system', content: 'Be concise.' },
    { role: 'user', content: prompt }
  ],
  text: {
    format: zodTextFormat(ResultSchema, 'result_name'),
    verbosity: 'low'  // Reduces output tokens
  },
  max_output_tokens: 1500,  // Keep small for speed
  reasoning: { effort: 'low' }  // Enable reasoning for quality
});

const result = response.output_parsed;  // Already validated by SDK
```

**Benefits over manual parsing:**
- Eliminates JSON parse failures (whitespace, partial JSON, model warnings)
- `output_parsed` is the SDK's reliable aggregation point
- Schema validation happens automatically

### Latency Optimization Checklist

For reviewer/validator tasks, balance speed and quality:

1. **Model**: Use `gpt-5.2` for complex tasks (zone reconfiguration), `gpt-5-mini` for simple checks
2. **Reasoning**: Use `{ effort: 'low' }` for balance - enables model thinking without excessive latency
3. **Verbosity**: Set `text.verbosity: 'low'` to reduce output tokens
4. **Token cap**: Keep `max_output_tokens` at 1500-2000, treat incomplete as failure
5. **Timeout**: Default 20s for gpt-5.2 with reasoning, configurable via env var
6. **Schema bounds**: Add `.max()` to arrays and strings to prevent runaway outputs

### Endpoint/Model Mismatch (Common Pitfall)

**CRITICAL**: OpenAI model IDs are endpoint-specific. Using the wrong model ID for an endpoint causes "model not found" errors:

| Model | Endpoint | Correct Model ID |
|-------|----------|------------------|
| GPT-5-mini | Responses API (`/v1/responses`) | `gpt-5-mini` |
| GPT-5.2 | Responses API (`/v1/responses`) | `gpt-5.2` |
| GPT-5.2 | Chat Completions (`/v1/chat/completions`) | `gpt-5.2-chat-latest` |
| GPT-4.1 | Either | `gpt-4.1` |
| GPT-4o | Either | `gpt-4o` |

```javascript
// ✅ CORRECT: gpt-5.2 via Responses API with parse()
const response = await openai.responses.parse({
  model: 'gpt-5.2',
  input: [...],
  text: { format: zodTextFormat(Schema, 'name') }
});
const result = response.output_parsed;

// ❌ WRONG: gpt-5.2 via Chat Completions - returns "model not found"
await openai.chat.completions.create({
  model: 'gpt-5.2',  // Wrong! Use gpt-5.2-chat-latest here
  messages: [...]
});
```

### GPT-5.x Reasoning Configuration

GPT-5.x models support extended thinking via the `reasoning` parameter (Responses API only):

```javascript
// ✅ CORRECT structure - use 'low' for balance of speed and quality
await openai.responses.parse({
  model: 'gpt-5.2',
  reasoning: { effort: 'low' },  // 'none' | 'low' | 'medium' | 'high'
  // ...
});

// ❌ WRONG: reasoning_effort is not a valid API parameter
await openai.responses.parse({
  model: 'gpt-5.2',
  reasoning_effort: 'medium',  // Ignored!
  // ...
});
```

### Handle Incomplete Responses

Treat incomplete responses as failures rather than retrying with more tokens:

```javascript
const response = await openai.responses.parse({ ... });

if (response.status === 'incomplete') {
  const reason = response.incomplete_details?.reason || 'unknown';
  throw new Error(`Response incomplete: ${reason}`);
}
```

### Model Fallback Pattern

Implement graceful degradation for model availability:

```javascript
const FALLBACK_MODELS = ['gpt-5.2', 'gpt-5-mini', 'gpt-4.1', 'gpt-4o'];

for (const modelId of FALLBACK_MODELS) {
  try {
    response = await openai.responses.parse({ model: modelId, ... });
    break; // Success
  } catch (err) {
    // Only fall back on "model not found" errors, not validation errors
    const isModelNotFound = err.status === 404 ||
      err.message?.toLowerCase().includes('model');
    if (!isModelNotFound) throw err;
    console.warn(`Model ${modelId} unavailable, trying next...`);
  }
}
```

### Verify Model Access

To check which models your API key can access:

```bash
curl -s https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY" | jq '.data[].id' | grep gpt-5
```

---

## JavaScript Gotchas

### The `||` vs `??` Falsy Bug

**CRITICAL**: When using `||` for default values, remember that `0` is falsy in JavaScript!

```javascript
// BUG: 0 is falsy, so this returns 2 instead of 0
const confOrder = { high: 0, medium: 1, low: 2 };
const priority = confOrder['high'] || 2;  // Returns 2, not 0!

// This broke confidence sorting - HIGH confidence items (0) were treated as LOW (2)
items.sort((a, b) => {
  return (confOrder[a.confidence] || 2) - (confOrder[b.confidence] || 2);
  // All 'high' items got priority 2 instead of 0!
});
```

**FIX**: Use nullish coalescing (`??`) which only falls back for `null`/`undefined`:

```javascript
// CORRECT: ?? only triggers for null/undefined, not 0
const priority = confOrder['high'] ?? 2;  // Returns 0 correctly

items.sort((a, b) => {
  const aConf = confOrder[a.confidence] ?? 2;  // 0 stays 0
  const bConf = confOrder[b.confidence] ?? 2;
  return aConf - bConf;
});
```

**When to use which:**
- `??` - When 0, '', or false are valid values you want to keep
- `||` - When you want ANY falsy value to trigger the default

---

## Search Pipeline Patterns

### Waterfall Strategy

Rating fetches use a cascading waterfall via shared `src/services/search/threeTierWaterfall.js`:

| Tier | Method | Latency | API Keys Needed |
|------|--------|---------|-----------------|
| 0 | Deterministic Structured Parsers | <10ms | None |
| 1 | Quick SERP AI (BrightData) | 3-8s | `BRIGHTDATA_API_KEY` |
| 2a | **Claude Web Search** (primary) | 10-30s | `ANTHROPIC_API_KEY` only |
| 2b | Gemini Hybrid (fallback) | 15-45s | `GEMINI_API_KEY` |
| 3 | Legacy Deep Scraping | 30-60s | `BRIGHTDATA_API_KEY` |

**Tier 0: Structured Parsers** (`src/services/ratings/structuredParsers.js`):
Deterministic extraction from Vivino `__NEXT_DATA__`, JSON-LD `aggregateRating`, microdata, and Wine-Searcher pages. Wired into `ratingExtraction.js` — pages that parse structurally skip the Claude extraction call entirely (~20-30% of fetches).

**Tier 2a: Claude Web Search** (`src/services/search/claudeWebSearch.js`):
Uses Anthropic's `web_search_20260209` and `web_fetch_20260209` tools with a `save_wine_ratings` tool definition for deterministic JSON output via `tool_use` block. Falls back to text extraction with `extractJsonWithRepair()` if no tool_use block. Requires beta header:
`anthropic-beta: code-execution-web-tools-2026-02-09`

**Tier 2b: Gemini Hybrid** (`src/services/search/geminiSearch.js`):
Fallback when Claude Web Search fails or circuit is open. Uses Gemini grounded search + Haiku extraction (2 API calls). Gemini model: `gemini-3.0-flash` (base ID routes to latest stable).

**Shared Utilities**:
- `src/services/search/threeTierWaterfall.js` — Core waterfall logic, tier timeout constants, logging. Does NO database operations — callers handle persistence.
- `src/services/shared/jsonUtils.js` — `extractJsonWithRepair()` used across all tiers for robust JSON extraction from LLM responses.

### Query Builder Service Pattern

When building search queries, use locale-aware query construction:

```javascript
import { getLocaleParams, buildQueryVariants, shouldRetryWithoutOperators } from './queryBuilder.js';

// Get locale for SERP calls based on wine country
const { hl, gl } = getLocaleParams(wine);

// Build query variants by intent
const queries = buildQueryVariants(wine, 'reviews');
// Returns: string[] (e.g., ["producer wine vintage review", "wine vintage rating"])

// Check if retry needed
if (shouldRetryWithoutOperators(results, query)) {
  // Retry with simplified query
  const simplified = buildQueryVariants(wine, 'reviews', { useOperators: false });
}
```

**Country→Locale Mappings**:
- South Africa → `hl=en&gl=za`
- Australia → `hl=en&gl=au`
- France → `hl=fr&gl=fr`
- Default → `hl=en&gl=us`

### Region-Specific Sources

Include regional critics/competitions in queries:

| Country | Critics/Competitions |
|---------|---------------------|
| South Africa | Platter Guide, Tim Atkin, Michelangelo Awards, SAGWA |
| Australia | Halliday, Campbell Mattinson, Winestate |
| France | Revue du Vin de France, Bettane Desseauve, Guide Hachette |
| USA | Wine Spectator, Wine Advocate, Wine Enthusiast |

### Identity Validation Pattern

**Status**: PRODUCTION ACTIVE (implemented in `src/services/wineIdentity.js`)

Wine identity validation ensures ratings belong to the correct wine before persistence:

```javascript
import { generateIdentityTokens, calculateIdentityScore } from './wineIdentity.js';

// Generate identity tokens (producer + vintage required)
const tokens = generateIdentityTokens(wine);
// { producer: ['kanonkop'], vintage: 2019, range: ['paul', 'sauer'], ... }

// Calculate identity score for URL/content
const score = calculateIdentityScore(urlTitle, tokens);
// { score: 5, valid: true, reason: 'valid', matches: { producerMatch: true, vintageMatch: true, ... } }

// Apply confidence gate before persistence
if (!score.valid || score.score < 4) {
  // Reject: missing producer or vintage
}
```

**Identity Score Weights**:
- Producer match: +2 (required)
- Vintage match: +2 (required)
- Range/cuvee match: +1
- Grape match: +1
- Region match: +1
- Negative token: -10 (instant reject)

**Minimum threshold**: 4 (producer + vintage required)

### Algorithmic Producer Aliases

Producer alias generation uses patterns, not hardcoded mappings:

```javascript
// Generated automatically from producer name:
// "Bodegas Vega Sicilia" → ["vega sicilia"]  (prefix removed)
// "Ridge Vineyards" → ["ridge"]  (suffix removed)
// "Louis Roederer" → ["roederer"]  (last name only for 2-word names)
// "Smith and Hook" → ["smith", "hook"]  (split on "and")
```

**Company Prefixes** (stripped): bodegas, maison, domaine, chateau, castello, tenuta, cantina, cave, weingut, schloss, casa

**Company Suffixes** (stripped): vineyards, vineyard, estate, estates, winery, wines, cellars, cellar

### Accuracy Metrics Tracking

New metrics for data quality monitoring:

```javascript
// After rating aggregation
const metrics = {
  vintage_mismatch_count: 0,     // Ratings with wrong vintage
  wrong_wine_count: 0,           // User-flagged incorrect ratings
  identity_rejection_count: 0    // URLs rejected by identity score
};

// Record in search_metrics table
await recordSearchMetrics(searchId, wineId, cellarId, metrics);

// Query accuracy stats
const accuracy = await getAccuracyMetrics(cellarId, dateRange);
// { avg_vintage_mismatch_rate: 0.02, wrong_wine_corrections: 3 }
```

### Wine Search Benchmark System

The benchmark system evaluates search identity matching quality using deterministic CI testing.

**Test Files**:
- `tests/benchmark/searchBenchmark.test.js` - Main benchmark test suite
- `tests/benchmark/identityScorer.js` - Identity scoring wrapper with metrics
- `tests/benchmark/goldenWines.test.js` - Golden wine extraction tests
- `tests/fixtures/Search_Benchmark_v2_1.json` - 50 wine test cases

**Key Metrics** (as of January 2026):
- **hit@1**: 82% - Correct wine in top result
- **hit@3**: 96% - Correct wine in top 3 results
- **MRR**: 0.89 - Mean Reciprocal Rank

**Running Benchmarks**:
```bash
# Run benchmark suite (REPLAY mode - uses fixtures)
npm run test:benchmark

# Run specific benchmark file
npx vitest run tests/benchmark/searchBenchmark.test.js --reporter=verbose
```

**Fuzzy Matching Algorithm** (Jaccard Similarity):

The benchmark uses balanced precision/recall matching:

```javascript
// tests/benchmark/identityScorer.js
export function fuzzyMatch(a, b, threshold = 0.65) {
  const tokensA = getMatchTokens(a);  // Tokenize and filter stop words
  const tokensB = getMatchTokens(b);

  // Jaccard similarity: |A ∩ B| / |A ∪ B|
  const intersection = [...tokensA].filter(t => tokensB.has(t));
  const union = new Set([...tokensA, ...tokensB]);

  return intersection.length / union.size >= threshold;
}
```

**Design Principles**:
- **No overfitting** - Avoid benchmark-specific tuning
- **Algorithmic patterns** - Use generalizable rules, not hardcoded mappings
- **Balanced metrics** - Jaccard treats precision and recall equally
- **Honest baselines** - 82% hit@1 is realistic for flexible search

---

## Do NOT

- Put API keys in code
- Use `var` (use `const` or `let`)
- Leave `console.log` in production code (use proper error logging)
- Mix tabs and spaces (use 2 spaces)
- Let files grow beyond ~500 lines without splitting by responsibility
- Use inline styles in HTML (use CSS classes)
- Hardcode magic numbers (use named constants)
- Use inline event handlers (`onclick`, `onchange`) in HTML - CSP blocks them
- Forget `async/await` when calling `db.prepare()` methods
- Assume batch operations won't have collisions - always validate
- Use wine name for identity in move/swap logic - use wine ID
- Execute multi-step operations without transaction wrapping
- Use `||` for default values when 0 is valid (use `??` instead - see below)
- Trust client-provided `cellar_id` from request body - always use `req.cellarId` from middleware
- Write queries without `WHERE cellar_id = $1` filter - causes cross-tenant data leaks
- Bypass `requireCellarContext` middleware for data routes
- Use raw `fetch()` for `/api/*` calls in frontend - use `api/` module functions instead (they add auth headers)
- Parse LLM JSON with ad-hoc greedy regex when `extractJsonFromText()` already exists in `src/services/shared/auditUtils.js`
- Use `vi.resetModules()` in `--no-isolate` unit tests unless there is no safer alternative

---

## Do

- Run `npm run test:all` before committing (runs unit + integration tests)
- Run `npm run test:unit` for fast iteration during development
- Update this document when conventions change
- Ask clarifying questions if requirements are ambiguous
- Preserve existing functionality when refactoring
- Add JSDoc to all exported functions
- Keep functions under 50 lines where practical
- Mark all route handlers as `async` when using PostgreSQL
- Validate move/batch plans before execution
- Track allocated resources in batch suggestion generation
- Use invariant checks (before/after counts) for data-critical operations
- Test against PostgreSQL (Supabase) before deploying
- Bump cache version after frontend changes
- Add new frontend JS modules to `STATIC_ASSETS` in `public/sw.js` (regression test enforces this)
- Always use `req.cellarId` in all database queries for user-data tables
- Include `cellar_id` in UPDATE/DELETE WHERE clauses to prevent cross-tenant modification
- Apply `requireAuth` + `requireCellarContext` middleware to all data routes
- Use `api/` module functions for all frontend API calls (automatic auth headers)
- Reuse `src/services/shared/auditUtils.js` when implementing any new LLM auditor module
- Use `vi.importActual()` for real-module imports in `--no-isolate` test files to avoid cross-suite mock leakage
