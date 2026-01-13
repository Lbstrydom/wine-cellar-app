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
│   ├── pairing.js         # /api/pairing/* endpoints
│   ├── reduceNow.js       # /api/reduce-now/* endpoints
│   └── stats.js           # /api/stats endpoint
├── services/
│   ├── claude.js          # Claude API integration
│   └── pairing.js         # Pairing logic and scoring
└── db/
    ├── index.js           # Database abstraction (auto-selects SQLite or PostgreSQL)
    ├── sqlite.js          # SQLite implementation (better-sqlite3)
    └── postgres.js        # PostgreSQL implementation (pg)
```

### Frontend Structure

```
public/
├── index.html             # HTML structure only (no inline JS/CSS)
├── css/
│   └── styles.css         # All styles
└── js/
    ├── app.js             # Main app initialisation, state management
    ├── api.js             # API calls wrapper
    ├── grid.js            # Cellar/fridge grid rendering
    ├── modals.js          # Modal management
    ├── dragdrop.js        # Drag and drop functionality
    ├── sommelier.js       # Claude pairing UI
    ├── bottles.js         # Bottle add/edit functionality
    └── utils.js           # Shared utility functions
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
```

### Database Queries

```javascript
// Use prepared statements with async/await (PostgreSQL returns Promises)
const wine = await db.prepare('SELECT * FROM wines WHERE id = ?').get(wineId);

// Use STRING_AGG for PostgreSQL (not GROUP_CONCAT like SQLite)
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

// PostgreSQL syntax differences from SQLite:
// - Use ILIKE for case-insensitive search (not LIKE)
// - Use STRING_AGG() instead of GROUP_CONCAT()
// - Use CURRENT_TIMESTAMP instead of datetime('now')
// - Use INTERVAL '30 days' instead of '-30 days'
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
- Works locally with SQLite but fails with PostgreSQL

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

---

## Testing

The project uses **Vitest** for testing with self-contained integration tests that automatically manage server lifecycle.

### Test Commands

| Command | What it does | Server needed? |
|---------|--------------|----------------|
| `npm run test:unit` | Runs 312 unit tests (~0.5s) | ❌ No |
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
    ├── services/            # Service tests
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
| `DATABASE_URL` | PostgreSQL connection string (if set, uses PostgreSQL instead of SQLite) | For cloud deployment |
| `SUPABASE_URL` | Supabase project URL (e.g., `https://xxx.supabase.co`) | For multi-user auth |
| `SUPABASE_ANON_KEY` | Supabase anonymous/public key (frontend) | For multi-user auth |
| `ANTHROPIC_API_KEY` | Claude API key for sommelier feature | For AI features |
| `GOOGLE_SEARCH_API_KEY` | Google Programmable Search API key | For ratings search |
| `GOOGLE_SEARCH_ENGINE_ID` | Google Custom Search Engine ID | For ratings search |
| `BRIGHTDATA_API_KEY` | BrightData API key | For web scraping |
| `BRIGHTDATA_SERP_ZONE` | BrightData SERP zone name | For search results |
| `BRIGHTDATA_WEB_ZONE` | BrightData Web Unlocker zone | For blocked sites |
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
| `GOOGLE_SEARCH_API_KEY` | Google Search API key |
| `GOOGLE_SEARCH_ENGINE_ID` | Google CSE ID |
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

# Run locally (uses SQLite by default)
npm run dev

# Run locally with PostgreSQL (set DATABASE_URL in .env)
DATABASE_URL="your-supabase-url" npm run dev
```

### Cache Busting

When updating frontend files, bump the cache version in two places:
1. `public/index.html` - Update `?v=YYYYMMDDX` in CSS and JS imports
2. `public/sw.js` - Update `CACHE_VERSION` constant

This forces browsers to reload fresh assets instead of using cached versions

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

## Do NOT

- Put API keys in code
- Use `var` (use `const` or `let`)
- Leave `console.log` in production code (use proper error logging)
- Mix tabs and spaces (use 2 spaces)
- Create files over 300 lines (split them)
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
- Test with PostgreSQL before deploying (not just SQLite locally)
- Bump cache version after frontend changes
- Always use `req.cellarId` in all database queries for user-data tables
- Include `cellar_id` in UPDATE/DELETE WHERE clauses to prevent cross-tenant modification
- Apply `requireAuth` + `requireCellarContext` middleware to all data routes
