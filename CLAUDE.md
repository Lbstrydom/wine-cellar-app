# CLAUDE.md - AI Assistant Guidelines

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

## Testing (Future)

### File Naming

```
tests/
├── routes/
│   └── wines.test.js
├── services/
│   └── pairing.test.js
└── frontend/
    └── grid.test.js
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
| `ANTHROPIC_API_KEY` | Claude API key for sommelier feature | For AI features |
| `GOOGLE_SEARCH_API_KEY` | Google Programmable Search API key | For ratings search |
| `GOOGLE_SEARCH_ENGINE_ID` | Google Custom Search Engine ID | For ratings search |
| `BRIGHTDATA_API_KEY` | BrightData API key | For web scraping |
| `BRIGHTDATA_SERP_ZONE` | BrightData SERP zone name | For search results |
| `BRIGHTDATA_WEB_ZONE` | BrightData Web Unlocker zone | For blocked sites |

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

## Do NOT

- Put API keys in code
- Use `var` (use `const` or `let`)
- Leave `console.log` in production code (use proper error logging)
- Mix tabs and spaces (use 2 spaces)
- Create files over 300 lines (split them)
- Use inline styles in HTML (use CSS classes)
- Hardcode magic numbers (use named constants)

---

## Do

- Run the app locally before committing
- Update this document when conventions change
- Ask clarifying questions if requirements are ambiguous
- Preserve existing functionality when refactoring
- Add JSDoc to all exported functions
- Keep functions under 50 lines where practical
