# Copilot Instructions — Wine Cellar App

> Full project documentation is in AGENTS.md at the project root.
> This file provides the critical subset Copilot needs for effective assistance.

## Stack

- **Backend**: Node.js, Express, PostgreSQL (Supabase), async/await throughout
- **Frontend**: Vanilla JS (ES6+ modules), no framework, CSP-compliant
- **Database**: Supabase PostgreSQL via `src/db/postgres.js` abstraction
- **Deployment**: Railway (auto-deploys from GitHub `main` branch)
- **AI**: Claude API (Anthropic) + OpenAI GPT for reviewers

## Critical Patterns

### All DB calls require async/await

```javascript
// ✅ CORRECT
router.get('/', async (req, res) => {
  const wines = await db.prepare('SELECT * FROM wines WHERE cellar_id = $1').all(req.cellarId);
  res.json({ data: wines });
});

// ❌ WRONG — returns Promise object, not data
router.get('/', (req, res) => {
  const wines = db.prepare('SELECT * FROM wines').all();
  res.json({ data: wines });
});
```

### Multi-tenant cellar scoping (SECURITY)

- Every query MUST include `WHERE cellar_id = $N` using `req.cellarId`
- Never trust `req.body.cellar_id` — always use `req.cellarId` from middleware
- All data routes need `requireAuth` + `requireCellarContext` middleware

### Frontend API calls must use api/ module

```javascript
// ✅ CORRECT — includes auth + cellar headers automatically
import { fetchWines } from './api/index.js';
const wines = await fetchWines();

// ❌ WRONG — no auth headers, returns 401
const response = await fetch('/api/wines');
```

### No inline event handlers (CSP)

```javascript
// ❌ WRONG — blocked by CSP
'<button onclick="handleClick()">Click</button>'

// ✅ CORRECT — wire in JS
container.querySelector('.btn').addEventListener('click', handleClick);
```

## Naming Conventions

| Type | Convention | Example |
|------|-----------|---------|
| Files | camelCase | `dragdrop.js`, `buyingGuideItems.js` |
| Functions | camelCase, verb-first | `getWines()`, `handleDrop()` |
| Constants | UPPER_SNAKE_CASE | `MAX_BOTTLES`, `API_BASE_URL` |
| DB columns | snake_case | `wine_name`, `bottle_count` |
| API endpoints | kebab-case | `/api/reduce-now`, `/api/wines` |
| CSS classes | kebab-case | `.wine-card`, `.modal-overlay` |

## Response Format

```javascript
// Success
{ "message": "Wine added", "data": { "id": 85 } }

// Error
{ "error": "Wine not found" }
```

## Error Handling

- Backend: Always try/catch in async route handlers, return `{ error: message }`
- Frontend: try/catch around API calls, show toast on error
- Async callbacks (auth, etc.): Always wrap in try/catch

## Key Rules

- Use `??` not `||` when 0 is a valid value (nullish coalescing)
- Use `STRING_AGG()` for PostgreSQL aggregation
- Use `ILIKE` for case-insensitive search
- Wrap multi-step mutations in transactions (BEGIN/COMMIT/ROLLBACK)
- Add new frontend JS files to `STATIC_ASSETS` in `public/sw.js`
- Bump `CACHE_VERSION` in `sw.js` after frontend changes
- Use shared Claude client from `src/services/ai/claudeClient.js` — never create `new Anthropic()`
- Use `getModelForTask()` from `src/config/aiModels.js` for model selection
- Use `extractText()` / `extractStreamText()` from `claudeResponseUtils.js` for thinking-enabled responses

## Testing

```bash
npm run test:unit        # ~2970 tests, ~3s, no server needed
npm run test:integration # 21 tests, auto-manages server
npm run test:all         # Both — run before committing
```

## File Structure (Key Paths)

- Routes: `src/routes/*.js`
- Services: `src/services/**/*.js`
- DB: `src/db/postgres.js` (async abstraction)
- Frontend JS: `public/js/**/*.js`
- Frontend API: `public/js/api/*.js` (authenticated fetch wrappers)
- Config: `src/config/aiModels.js`, `src/config/styleIds.js`
- Tests: `tests/unit/**/*.test.js`, `tests/integration/*.test.js`
