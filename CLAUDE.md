# CLAUDE.md - AI Assistant Guidelines

This document defines coding standards and conventions for AI assistants working on the Wine Cellar App.

---

## Project Overview

**Stack**: Node.js, Express, SQLite (better-sqlite3), Vanilla JS frontend
**Deployment**: Docker on Synology NAS
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
    └── index.js           # Database connection, helpers, queries
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
// Use prepared statements (already enforced by better-sqlite3)
const wine = db.prepare('SELECT * FROM wines WHERE id = ?').get(wineId);

// Name complex queries
const getWineWithLocations = db.prepare(`
  SELECT 
    w.id,
    w.wine_name,
    COUNT(s.id) as bottle_count,
    GROUP_CONCAT(s.location_code) as locations
  FROM wines w
  LEFT JOIN slots s ON s.wine_id = w.id
  WHERE w.id = ?
  GROUP BY w.id
`);
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
| `ANTHROPIC_API_KEY` | Claude API key for sommelier feature | For AI features |
| `GOOGLE_SEARCH_API_KEY` | Google Programmable Search API key | For ratings search |
| `GOOGLE_SEARCH_ENGINE_ID` | Google Custom Search Engine ID | For ratings search |
| `BRIGHTDATA_API_KEY` | BrightData API key | For web scraping |
| `BRIGHTDATA_SERP_ZONE` | BrightData SERP zone name | For search results |
| `BRIGHTDATA_WEB_ZONE` | BrightData Web Unlocker zone | For blocked sites |

---

## Deployment

The app is deployed to a Synology NAS using Git and local Docker builds. This approach is faster and more reliable than pulling pre-built images from GitHub Container Registry.

### Git-Based Deployment (Preferred)

Deploy changes by pushing to GitHub, then pulling and rebuilding on Synology:

```bash
# 1. Commit and push changes
git add -A && git commit -m "your message" && git push

# 2. SSH to Synology and deploy (single command)
ssh lstrydom@192.168.86.31 "cd ~/Apps/wine-cellar-app && git fetch origin && git reset --hard origin/main && /usr/local/bin/docker-compose down && /usr/local/bin/docker-compose build --no-cache && /usr/local/bin/docker-compose up -d"
```

Or as separate steps:
```bash
# SSH to Synology
ssh lstrydom@192.168.86.31

# On Synology:
cd ~/Apps/wine-cellar-app
git fetch origin
git reset --hard origin/main
/usr/local/bin/docker-compose down
/usr/local/bin/docker-compose build --no-cache
/usr/local/bin/docker-compose up -d
```

### Quick Reference

| Action | Command |
|--------|---------|
| Deploy to Synology | See git-based deployment above |
| Download production DB | `.\scripts\sync-db.ps1 -Download` |
| Upload local DB | `.\scripts\sync-db.ps1 -Upload` |
| Setup SSH key auth | `.\scripts\setup-ssh-key.ps1` |
| SSH to Synology | `ssh lstrydom@192.168.86.31` |
| View container logs | `ssh lstrydom@192.168.86.31 "/usr/local/bin/docker logs wine-cellar"` |
| Check container status | `ssh lstrydom@192.168.86.31 "/usr/local/bin/docker ps \| grep wine"` |
| Test API | `curl -s https://ds223j.tailf6bfbc.ts.net/api/stats` |

### Key Paths on Synology

| Item | Path |
|------|------|
| App directory | `~/Apps/wine-cellar-app/` |
| Database | `~/Apps/wine-cellar-app/data/cellar.db` |
| Docker binary | `/usr/local/bin/docker` |
| Docker Compose | `/usr/local/bin/docker-compose` |
| Production URL (local) | http://192.168.86.31:3000 |
| Production URL (Tailscale) | https://ds223j.tailf6bfbc.ts.net |

### First-Time Synology Setup

1. **Setup SSH key auth**: `.\scripts\setup-ssh-key.ps1`
2. **Clone the repo on Synology**:
   ```bash
   ssh lstrydom@192.168.86.31
   mkdir -p ~/Apps && cd ~/Apps
   git clone https://github.com/Lbstrydom/wine-cellar-app.git
   cd wine-cellar-app
   cp .env.example .env
   # Edit .env with your API keys
   ```
3. **Configure docker access** (on Synology via SSH):
   ```bash
   sudo chgrp administrators /var/run/docker.sock
   sudo chmod 660 /var/run/docker.sock
   ```
4. **Make docker permissions persistent**: Create triggered task in DSM Task Scheduler (Boot-up, root user) with command: `chgrp administrators /var/run/docker.sock && chmod 660 /var/run/docker.sock`
5. **Initial build and start**:
   ```bash
   /usr/local/bin/docker-compose build --no-cache
   /usr/local/bin/docker-compose up -d
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
