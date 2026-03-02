# Feature: Pairing-Aware Pending Ratings & Feedback Loop

## Context

When a user drinks a wine, the app creates a "pending rating" reminder if they didn't rate on the spot. Currently:

1. **Only wine rating is collected** — the reminder bar asks "Rate 1-5 stars" for the wine. If the wine was consumed as part of a pairing (e.g. sommelier recommended it with a dish), there is no prompt for pairing feedback.
2. **No previous rating shown** — if the user has already rated this wine from a prior bottle, the reminder doesn't mention it. The user has no context.
3. **Pairing consumption is not linked** — `linkConsumption()` exists in `pairingSession.js:101-108` but is **never called** from production code. The `pending_ratings` table has no `pairing_session_id` column.
4. **Pairing feedback is unused** — `pairing_sessions` stores `pairing_fit_rating`, `would_pair_again`, `failure_reasons`, but no recommendation engine reads this data.

**Goal**: Close the feedback loop — link consumption to pairings, collect both wine + pairing ratings in the reminder bar, show previous ratings, and feed pairing feedback into the sommelier.

---

## Files to Modify

| File | Change |
|------|--------|
| `data/migrations/061_pending_ratings_pairing_link.sql` | **NEW** — add `pairing_session_id` column |
| `src/schemas/slot.js` | Add optional `pairing_session_id` to `drinkBottleSchema` |
| `src/schemas/pendingRating.js` | **NEW** — Zod schemas for resolve endpoint + `pairingFeedbackSchema` |
| `src/routes/slots.js` | Explicit session ID from request body (preferred) + heuristic fallback; pass to `createPendingRating()` |
| `src/routes/pendingRatings.js` | Enhance GET with JOINs; enhance PUT with validation + idempotency + pairing feedback; static imports |
| `public/js/api/wines.js` | Pass `pairing_session_id` in `drinkBottle()` details |
| `public/js/api/pendingRatings.js` | Update `resolvePendingRating()` to pass pairing feedback |
| `public/js/pairing.js` | Pass `currentSessionId` to `drinkBottle()` from pairing drink panel |
| `public/js/ratingReminder.js` | Show previous rating hint, collapsible pairing section, updated save handler |
| `public/css/components.css` | CSS for previous-rating hint, inline pairing controls |
| `src/services/pairing/pairingSession.js` | Add `getRelevantPairingHistory()` for sommelier context |
| `src/services/pairing/sommelier.js` | Inject past pairing feedback into Claude prompt |
| `public/sw.js` | Bump `CACHE_VERSION`, update CSS `?v=` |
| `public/index.html` | Update CSS `?v=` |
| Tests (multiple) | New + updated test cases |

---

## Data Integrity Policy

### Atomicity

The drink flow has three post-transaction side effects: (a) pairing link, (b) pending rating creation, (c) cache invalidation. These are **best-effort with isolation** — each is wrapped in its own try/catch and failures are logged but do not block the response or roll back the core transaction (consumption log + slot clear).

**Rationale**: The core transaction (consumption_log INSERT + slot UPDATE) is already atomic via PostgreSQL transaction. The side effects are non-critical: a missed pairing link or pending rating is a UX gap, not a data integrity violation. Compensating logic is unnecessary — the heuristic fallback in pending ratings GET can retroactively detect pairing sessions even if the link wasn't written at drink time.

### Idempotency

The resolve endpoint must guard against double-submit:
- WHERE clause includes `AND pr.status = 'pending'` — a second submit finds no row and returns 404
- `recordFeedback()` is an UPDATE (not INSERT) keyed on session ID — safe to call twice

### Failure Modes

| Failure | Impact | Mitigation |
|---------|--------|------------|
| Pairing link fails at drink time | Pending rating has no `pairing_session_id` | Heuristic fallback in GET (see §3) |
| Pending rating creation fails | No reminder shown | Already fire-and-forget; user can rate via wine detail modal |
| Wine rating save succeeds but pairing feedback fails | Wine rated, pairing not | Show partial-success toast ("Wine rated; pairing feedback failed — you can re-submit from the pairing view") |
| Double-submit on resolve | Second attempt finds `status != 'pending'` | Return 404, frontend already removed card from DOM |

---

## Implementation Details

### 1. Migration: `061_pending_ratings_pairing_link.sql`

```sql
-- Migration 061: Link pending ratings to pairing sessions
-- Enables the reminder bar to prompt for both wine rating AND pairing feedback
-- when the consumption originated from a pairing interaction.

ALTER TABLE pending_ratings
  ADD COLUMN IF NOT EXISTS pairing_session_id INTEGER
  REFERENCES pairing_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pending_ratings_pairing_session
  ON pending_ratings(pairing_session_id)
  WHERE pairing_session_id IS NOT NULL;

COMMENT ON COLUMN pending_ratings.pairing_session_id IS
  'Links to pairing session if consumption originated from a pairing interaction';

-- ROLLBACK:
-- ALTER TABLE pending_ratings DROP COLUMN IF EXISTS pairing_session_id;
```

### 2. Session Linking — Dual Strategy (Explicit + Heuristic Fallback)

**Problem**: The original plan used only a 48h heuristic lookup (`findRecentSessionForWine`). This can mis-link when a user pairs the same wine for multiple dishes.

**Solution**: Prefer **explicit session ID propagation** from the pairing flow, with the heuristic as fallback for non-pairing drink paths.

#### 2a. Explicit Path — Frontend passes `pairing_session_id` in drink request

**`src/schemas/slot.js`** — add to `drinkBottleSchema`:
```js
export const drinkBottleSchema = z.object({
  occasion: z.string().max(200).optional().nullable(),
  pairing_dish: z.string().max(200).optional().nullable(),
  rating: z.union([z.number().min(0).max(5), z.null()]).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  pairing_session_id: z.number().int().positive().optional().nullable()  // NEW
});
```

**`public/js/pairing.js`** — in `showDrinkActionPanel()`, pass session ID to drink call:
```js
// currentSessionId is already module-scoped and set when recommendations are displayed
await drinkBottle(location, { pairing_session_id: currentSessionId });
```

**`src/routes/slots.js`** — prefer explicit ID, fall back to heuristic:
```js
import { findRecentSessionForWine, linkConsumption } from '../../services/pairing/pairingSession.js';

// After transaction, before pending rating creation:
let pairingSessionId = req.body.pairing_session_id || null;  // Explicit from frontend
if (!pairingSessionId) {
  // Heuristic fallback: find recent unlinked session for this wine
  try {
    const recentSession = await findRecentSessionForWine(wineId, req.cellarId, 48);
    if (recentSession) pairingSessionId = recentSession.id;
  } catch (err) {
    logger.warn('PairingLink', `Heuristic lookup failed: ${err.message}`);
  }
}

// Link consumption to pairing session (best-effort, non-blocking)
if (pairingSessionId) {
  try {
    await linkConsumption(pairingSessionId, consumptionLogId, req.cellarId);
  } catch (err) {
    logger.warn('PairingLink', `linkConsumption failed: ${err.message}`);
    // Don't null out pairingSessionId — still pass to pending rating for UI context
  }
}
```

Then pass `pairingSessionId` to `createPendingRating()`:
```js
if (!rating && consumptionLogId) {
  createPendingRating(req.cellarId, consumptionLogId, wineId, location, pairingSessionId).catch(err => {
    logger.warn('PendingRating', `Failed to create: ${err.message}`);
  });
}
```

#### 2b. Update `createPendingRating()` signature

```js
async function createPendingRating(cellarId, consumptionLogId, wineId, locationCode, pairingSessionId = null) {
  const wine = await db.prepare(
    'SELECT wine_name, vintage, colour, style FROM wines WHERE id = $1 AND cellar_id = $2'
  ).get(wineId, cellarId);
  if (!wine) return;

  await db.prepare(`
    INSERT INTO pending_ratings (cellar_id, consumption_log_id, wine_id, wine_name, vintage, colour, style, location_code, pairing_session_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `).run(cellarId, consumptionLogId, wineId, wine.wine_name, wine.vintage, wine.colour, wine.style, locationCode, pairingSessionId);
}
```

### 3. Enhance GET `/api/pending-ratings` — `src/routes/pendingRatings.js`

Add JOINs for `wines.personal_rating` and `pairing_sessions` context:

```sql
SELECT pr.id, pr.consumption_log_id, pr.wine_id, pr.wine_name,
       pr.vintage, pr.colour, pr.style, pr.location_code, pr.consumed_at,
       pr.pairing_session_id,
       cl.rating AS existing_rating, cl.notes AS existing_notes,
       w.personal_rating AS previous_rating,
       ps.dish_description AS pairing_dish,
       ps.pairing_fit_rating AS pairing_already_rated
FROM pending_ratings pr
LEFT JOIN consumption_log cl ON cl.id = pr.consumption_log_id
LEFT JOIN wines w ON w.id = pr.wine_id AND w.cellar_id = $1
LEFT JOIN pairing_sessions ps ON ps.id = pr.pairing_session_id AND ps.cellar_id = $1
WHERE pr.cellar_id = $1 AND pr.status = 'pending'
ORDER BY pr.consumed_at DESC
```

New fields for frontend: `previous_rating`, `pairing_session_id`, `pairing_dish`, `pairing_already_rated`.

### 4. Enhance PUT resolve — `src/routes/pendingRatings.js`

**Static import** at module top (not dynamic `import()` in hot path):
```js
import { recordFeedback } from '../services/pairing/pairingSession.js';
```

**Add Zod validation schema** — new file `src/schemas/pendingRating.js`:
```js
import { z } from 'zod';

export const pairingFeedbackSchema = z.object({
  pairingFitRating: z.number().min(1).max(5),
  wouldPairAgain: z.boolean().nullable(),  // null = not answered (no default bias)
  failureReasons: z.array(z.string().max(50)).max(5).optional().nullable(),
  notes: z.string().max(300).optional().nullable()
}).strict();

export const resolvePendingRatingSchema = z.object({
  status: z.enum(['rated', 'dismissed']),
  rating: z.number().int().min(1).max(5).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  pairingFeedback: pairingFeedbackSchema.optional().nullable()
});
```

**Idempotency-safe resolve** — fetch includes `AND status = 'pending'`:
```js
const pending = await db.prepare(
  'SELECT consumption_log_id, wine_id, pairing_session_id FROM pending_ratings WHERE id = $1 AND cellar_id = $2 AND status = $3'
).get(req.params.id, req.cellarId, 'pending');
if (!pending) return res.status(404).json({ error: 'Pending rating not found or already resolved' });
```

**Pairing feedback after wine rating** (non-atomic — partial success is acceptable):
```js
// After wine rating write succeeds...
if (pending.pairing_session_id && pairingFeedback?.pairingFitRating) {
  try {
    await recordFeedback(pending.pairing_session_id, {
      pairingFitRating: pairingFeedback.pairingFitRating,
      wouldPairAgain: pairingFeedback.wouldPairAgain,  // null if not answered
      failureReasons: pairingFeedback.failureReasons || null,
      notes: pairingFeedback.notes || null
    }, req.cellarId);
  } catch (err) {
    // Wine rating saved, pairing feedback failed — partial success
    logger.warn('PairingFeedback', `Failed for session ${pending.pairing_session_id}: ${err.message}`);
    return res.json({ success: true, pairingFeedbackError: 'Pairing feedback could not be saved' });
  }
}
```

### 5. Frontend API — `public/js/api/pendingRatings.js`

Add optional `pairingFeedback` parameter:
```js
export async function resolvePendingRating(id, status, rating, notes, pairingFeedback) {
  const res = await fetch(`${API_BASE}/api/pending-ratings/${id}/resolve`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, rating, notes, pairingFeedback })
  });
  return handleResponse(res, 'Failed to resolve pending rating');
}
```

Backward compatible — existing callers pass `undefined`.

### 6. Rating Reminder UI — `public/js/ratingReminder.js`

#### 6a. Module-level item map

```js
/** @type {Map<string, Object>} Pending item data keyed by string ID */
const _pendingItems = new Map();
```

Populated in `renderExpandedCards()`. Used by `wireRatingCard()` to access `previous_rating`, `pairing_session_id`, etc. without DOM data attributes. Cleared on bar dismiss.

**Why Map over data-* attributes**: Multiple handlers need `pairing_dish`, `previous_rating`, `pairing_session_id`, `pairing_already_rated`. Storing all in data-* attributes creates fragile DOM coupling. The Map is set once per expand and read by card wiring — no stale state risk since cards are re-rendered on each expand.

#### 6b. Previous rating hint

In `renderRatingCard()`, when `item.previous_rating` exists:
```html
<div class="rating-card-previous">Previously rated ${item.previous_rating}/5</div>
```

In `wireRatingCard()`, pre-select the dropdown:
```js
const item = _pendingItems.get(card.dataset.id);
if (item?.previous_rating) {
  const select = card.querySelector('.rating-card-select');
  if (select) select.value = String(Math.round(item.previous_rating));
}
```

#### 6c. Inline pairing feedback — **collapsed by default** (progressive disclosure)

When `item.pairing_session_id && !item.pairing_already_rated`:

```html
<div class="rating-card-pairing" data-collapsed="true">
  <button type="button" class="rating-card-pairing-toggle">
    🍽 Paired with: <strong>${escapeHtml(item.pairing_dish)}</strong>
    <span class="pairing-expand-hint">Rate pairing ▸</span>
  </button>
  <div class="rating-card-pairing-controls" style="display:none">
    <label>Pairing fit:
      <select class="pairing-fit-select">
        <option value="">—</option>
        <option value="5">5 Perfect</option>
        <option value="4">4 Very Good</option>
        <option value="3">3 Good</option>
        <option value="2">2 Okay</option>
        <option value="1">1 Poor</option>
      </select>
    </label>
    <span class="pairing-pair-again">
      Pair again?
      <label><input type="radio" name="pair-again-${item.id}" value="true"> Yes</label>
      <label><input type="radio" name="pair-again-${item.id}" value="false"> No</label>
    </span>
  </div>
</div>
```

Toggle handler wired in `wireRatingCard()`:
```js
const pairingToggle = card.querySelector('.rating-card-pairing-toggle');
if (pairingToggle) {
  pairingToggle.addEventListener('click', () => {
    const controls = card.querySelector('.rating-card-pairing-controls');
    const hint = card.querySelector('.pairing-expand-hint');
    const isHidden = controls.style.display === 'none';
    controls.style.display = isHidden ? 'flex' : 'none';
    hint.textContent = isHidden ? '▾' : 'Rate pairing ▸';
  });
}
```

When `item.pairing_already_rated` is set:
```html
<div class="rating-card-pairing-done">🍽 Paired with ${escapeHtml(item.pairing_dish)} — feedback recorded</div>
```

#### 6d. Updated save handler — explicit `wouldPairAgain` (no default bias)

```js
let pairingFeedback = undefined;
const pairingFitSelect = card.querySelector('.pairing-fit-select');
if (pairingFitSelect?.value) {
  const wouldPairAgainEl = card.querySelector(`input[name="pair-again-${id}"]:checked`);
  pairingFeedback = {
    pairingFitRating: parseInt(pairingFitSelect.value, 10),
    wouldPairAgain: wouldPairAgainEl ? wouldPairAgainEl.value === 'true' : null  // null = not answered
  };
}
await resolvePendingRating(id, 'rated', rating, notes, pairingFeedback);
```

#### 6e. Completion feedback

```js
const result = await resolvePendingRating(id, 'rated', rating, notes, pairingFeedback);
if (result.pairingFeedbackError) {
  showToast(`Rated ${rating}/5 — pairing feedback could not be saved`, 4000);
} else if (pairingFeedback) {
  showToast(`Rated ${rating}/5 + pairing feedback saved!`);
} else {
  showToast(`Rated ${rating}/5 — saved!`);
}
```

#### SRP Note

`ratingReminder.js` is currently 248 lines. With these changes it grows to ~350 lines. This stays under the 500-line project guideline. The responsibilities are:
- `showRatingBar()` + `renderExpandedCards()` — bar lifecycle
- `renderRatingCard()` — card HTML generation (pure function)
- `wireRatingCard()` — event binding (reads from `_pendingItems` map)
- `removeCard()` — DOM cleanup

If a future iteration adds more complexity (e.g. failure reason checkboxes), extract `collectPairingFeedback(card, id)` into a helper function at that point.

### 7. CSS — `public/css/components.css`

Append after existing rating reminder styles:

```css
/* Previous rating hint */
.rating-card-previous {
  font-size: 0.8rem;
  color: var(--accent, #d4a843);
  margin-bottom: 0.3rem;
}

/* Pairing feedback inline (collapsed by default) */
.rating-card-pairing {
  width: 100%;
  margin-top: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px dashed var(--border, #333);
}
.rating-card-pairing-toggle {
  background: none;
  border: none;
  color: var(--text-muted, #999);
  cursor: pointer;
  font-size: 0.85rem;
  padding: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  text-align: left;
}
.rating-card-pairing-toggle:hover { color: var(--text, #eee); }
.rating-card-pairing-toggle strong { color: var(--text, #eee); }
.pairing-expand-hint {
  margin-left: auto;
  font-size: 0.75rem;
  color: var(--accent, #d4a843);
}
.rating-card-pairing-controls {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-top: 0.4rem;
  padding: 0.4rem 0;
}
.rating-card-pairing-controls select {
  padding: 0.3rem 0.5rem;
  border-radius: 4px;
  background: var(--bg-card, #1e1e2e);
  color: var(--text, #eee);
  border: 1px solid var(--border, #333);
}
.pairing-pair-again {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.85rem;
  color: var(--text-muted, #999);
}
.pairing-pair-again label { cursor: pointer; }
.rating-card-pairing-done {
  font-size: 0.8rem;
  color: var(--text-muted, #999);
  font-style: italic;
}
```

### 8. Sommelier Feedback Loop — `src/services/pairing/sommelier.js`

**New function** in `pairingSession.js`:
```js
/**
 * Get recent pairing feedback history for sommelier context.
 * @param {string} cellarId - Cellar UUID
 * @param {number} [limit=5] - Max results
 * @returns {Promise<Object[]>}
 */
export async function getRelevantPairingHistory(cellarId, limit = 5) {
  const rows = await db.prepare(`
    SELECT ps.dish_description, ps.pairing_fit_rating, ps.would_pair_again,
           ps.failure_reasons, w.wine_name, w.vintage, w.colour, w.style
    FROM pairing_sessions ps
    LEFT JOIN wines w ON ps.chosen_wine_id = w.id
    WHERE ps.cellar_id = $1 AND ps.pairing_fit_rating IS NOT NULL
    ORDER BY ps.feedback_at DESC LIMIT $2
  `).all(cellarId, limit);

  return rows.map(r => ({
    ...r,
    failure_reasons: r.failure_reasons ? JSON.parse(r.failure_reasons) : null
  }));
}
```

**In `getSommelierRecommendation()`** — static import + inject into user prompt:

```js
// At module top (static import)
import { getRelevantPairingHistory } from './pairingSession.js';

// In getSommelierRecommendation(), before buildSommelierPrompts():
let historyBlock = '';
try {
  const history = await getRelevantPairingHistory(cellarId, 5);
  if (history.length > 0) {
    historyBlock = '\n\nPAST PAIRING EXPERIENCES:\n';
    for (const h of history) {
      const verdict = h.pairing_fit_rating >= 4 ? 'GREAT' : h.pairing_fit_rating <= 2 ? 'POOR' : 'OK';
      const reasons = h.failure_reasons?.length ? ` — issues: ${h.failure_reasons.join(', ')}` : '';
      historyBlock += `- ${h.wine_name} ${h.vintage || 'NV'} with "${h.dish_description}": ${verdict} (${h.pairing_fit_rating}/5)${reasons}${h.would_pair_again === false ? ' — would NOT pair again' : ''}\n`;
    }
    historyBlock += 'Use this to avoid repeating poor pairings and favor proven styles.\n';
  }
} catch (err) {
  logger.warn('Sommelier', `Failed to fetch pairing history: ${err.message}`);
}
```

Append `historyBlock` to the **user prompt** in `buildSommelierPrompts()` (not system prompt — user-specific data).

**Why prompt injection over pairingEngine.js**: The deterministic engine uses style-bucket affinity matrices. Per-user overrides there require maintaining adjustment matrices that are brittle with small sample sizes (< 10 data points). The Claude sommelier already personalizes within its shortlist candidates — adding history context is zero-risk and delivers immediate value. Future: once > 50 feedback data points exist, consider a `pairing_penalty` Map in `pairingEngine.js`.

### 9. Cache Busting — `public/sw.js` + `public/index.html`

- Bump `CACHE_VERSION` (e.g. `v183` → `v184`)
- Update `components.css?v=` string in both files
- No new frontend files to add to `STATIC_ASSETS` (all changes are to existing files)

---

## Deprecation / Cleanup

### Existing `#pairing-feedback-modal` (index.html:484-516)

**Status: RETAINED** — not deprecated by this plan.

The existing pairing feedback modal serves a different trigger point: it opens **immediately after choosing a wine** from sommelier recommendations (`pairing.js:118`). This is a proactive "rate the recommendation" flow.

The new inline controls in the reminder bar serve a **deferred** trigger: "you drank this wine from a pairing, how was the pairing?" — days later.

Both paths write to the same `pairing_sessions` table via `recordFeedback()`. The plan adds `pairing_already_rated` to the GET response, so the reminder bar shows "feedback recorded" instead of duplicate fields when the modal was already used.

**Ownership**:
- `#pairing-feedback-modal` + `openPairingFeedbackModal()` → `sommelier.js` (init wiring) + `manualPairing.js` (opener)
- Inline pairing controls → `ratingReminder.js`

No dead code is created.

---

## Implementation Sequence

| # | What | Files | Risk |
|---|------|-------|------|
| 1 | Migration | `061_pending_ratings_pairing_link.sql` | Low |
| 2 | Zod schemas | `src/schemas/pendingRating.js`, update `slot.js` | Low |
| 3 | Explicit session ID in drink + heuristic fallback | `src/routes/slots.js` | Low |
| 4 | Frontend: pass session ID from pairing drink panel | `public/js/pairing.js` | Low |
| 5 | Enhance GET pending-ratings | `src/routes/pendingRatings.js` | Low |
| 6 | Enhance PUT resolve (validation + idempotency + pairing) | `src/routes/pendingRatings.js` | Medium |
| 7 | Frontend API update | `public/js/api/pendingRatings.js` | Low |
| 8 | Previous rating hint + pre-select | `public/js/ratingReminder.js` | Low |
| 9 | CSS for pairing + previous rating | `public/css/components.css` | Low |
| 10 | Collapsible inline pairing fields + save handler | `public/js/ratingReminder.js` | Medium |
| 11 | `getRelevantPairingHistory()` | `src/services/pairing/pairingSession.js` | Low |
| 12 | Sommelier prompt injection | `src/services/pairing/sommelier.js` | Low |
| 13 | Cache busting | `sw.js`, `index.html` | Low |
| 14 | Tests | Multiple | Low |

---

## Existing Functions Reused (not reimplemented)

| Function | File | Purpose |
|----------|------|---------|
| `findRecentSessionForWine(wineId, cellarId, 48)` | `pairingSession.js:201` | Heuristic fallback: find unlinked session |
| `linkConsumption(sessionId, logId, cellarId)` | `pairingSession.js:101` | Set `consumption_log_id` + `confirmed_consumed` |
| `recordFeedback(sessionId, feedback, cellarId)` | `pairingSession.js:122` | Validate + write pairing feedback |
| `FAILURE_REASONS` | `pairingSession.js:11-24` | Vocabulary for pairing issues (reused by server-side validation) |
| `escapeHtml()` | `utils.js` | XSS-safe rendering |
| `drinkBottle(location, details)` | `api/wines.js:240` | Already accepts `details` object — just pass `pairing_session_id` |

---

## Verification

1. **Run migration** on Supabase: `061_pending_ratings_pairing_link.sql`
2. **`npm run test:unit`** — all existing + new tests pass
3. **Flow A (no pairing)**: Drink a bottle with no pairing session → reminder shows wine rating only. If previous rating exists, "Previously rated X/5" shown and dropdown pre-selected.
4. **Flow B (explicit session — pairing drink panel)**: Ask sommelier → choose wine → click "Drink This Bottle" on recommendation card → drink request includes `pairing_session_id` → reminder card shows wine rating + collapsed "Paired with: grilled salmon — Rate pairing ▸". Click to expand, fill both, Save → verify `consumption_log.rating`, `wines.personal_rating`, AND `pairing_sessions.pairing_fit_rating` all updated.
5. **Flow C (heuristic fallback — wine detail modal)**: Ask sommelier → choose wine → open wine detail → click Drink (no session ID in request) → heuristic finds recent session → same UX as Flow B.
6. **Flow D (pairing already rated)**: Submit pairing feedback via modal immediately after choosing → later drink the wine → reminder shows "feedback recorded" badge, no duplicate fields.
7. **Flow E (partial success)**: Wine rating saves, pairing feedback write fails → toast says "Rated 4/5 — pairing feedback could not be saved".
8. **Flow F (double-submit)**: Click Save twice quickly → second attempt returns 404 (pending already resolved), card already removed from DOM.
9. **Flow G (wouldPairAgain unanswered)**: Select pairing fit but don't click Yes/No → `wouldPairAgain` sent as `null`, stored as NULL.
10. **Sommelier improvement**: After submitting pairing feedbacks, ask sommelier again → verify Claude prompt includes "PAST PAIRING EXPERIENCES" block.
11. **Backward compat**: Existing pending ratings (no `pairing_session_id`) render as before — no regression.
