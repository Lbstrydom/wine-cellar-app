# Pairing Feedback & User Profile - Implementation Brief

**Version**: 1.0  
**Date**: 7 January 2026  
**Status**: Ready for implementation  
**Phases**: 1a, 1b, 1c, 2a, 2b, 2c (Phase 3 deferred)

---

## Executive Summary

Implement a feedback loop for wine pairing recommendations that captures:
1. Every pairing session (dish, AI analysis, recommendations)
2. User's wine selection
3. Link to actual consumption events
4. Post-pairing feedback (fit rating, would pair again, failure reasons)

This data feeds a derived user taste profile that improves future AI recommendations.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    PAIRING FEEDBACK FLOW                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. User requests pairing ──► Save session to pairing_sessions  │
│                                                                 │
│  2. User clicks "Choose This Wine" ──► Update chosen_wine_id    │
│                                                                 │
│  3. User logs consumption ──► Link consumption_log.id           │
│                              ──► Trigger feedback prompt        │
│                                                                 │
│  4. User submits feedback ──► Store rating + failure reasons    │
│                                                                 │
│  5. Profile recalculation ──► Derive taste preferences          │
│                              ──► Inject into future prompts     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 1a: Database Migration

### File: `src/db/migrations/023_pairing_sessions.sql`

```sql
-- Pairing Sessions: captures every Find Pairing interaction
-- Supports both PostgreSQL (production) and SQLite (local dev)

CREATE TABLE IF NOT EXISTS pairing_sessions (
  id SERIAL PRIMARY KEY,
  user_id TEXT DEFAULT 'default',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- The request
  dish_description TEXT NOT NULL,
  source_filter TEXT,
  colour_filter TEXT,
  
  -- AI analysis (structured for querying)
  food_signals JSONB,
  dish_analysis TEXT,
  
  -- Recommendations (ranked, with wine_ids for joins)
  recommendations JSONB NOT NULL,
  
  -- User selection
  chosen_wine_id INTEGER REFERENCES wines(id) ON DELETE SET NULL,
  chosen_rank INTEGER,
  chosen_at TIMESTAMPTZ,
  
  -- Consumption link (ground truth)
  consumption_log_id INTEGER REFERENCES consumption_log(id) ON DELETE SET NULL,
  confirmed_consumed BOOLEAN DEFAULT FALSE,
  
  -- Feedback (filled later)
  pairing_fit_rating REAL CHECK (pairing_fit_rating IS NULL OR (pairing_fit_rating >= 1 AND pairing_fit_rating <= 5)),
  would_pair_again BOOLEAN,
  failure_reasons JSONB,
  feedback_notes TEXT,
  feedback_at TIMESTAMPTZ
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_pairing_sessions_user ON pairing_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_pairing_sessions_wine ON pairing_sessions(chosen_wine_id);
CREATE INDEX IF NOT EXISTS idx_pairing_sessions_date ON pairing_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pairing_sessions_consumption ON pairing_sessions(consumption_log_id);

-- GIN index for JSONB queries (PostgreSQL only, skip for SQLite)
-- CREATE INDEX IF NOT EXISTS idx_pairing_sessions_signals ON pairing_sessions USING GIN (food_signals);

-- Partial index for pending feedback queries
CREATE INDEX IF NOT EXISTS idx_pairing_sessions_pending_feedback 
  ON pairing_sessions(user_id, created_at) 
  WHERE chosen_wine_id IS NOT NULL AND pairing_fit_rating IS NULL;

-- Add comment for failure_reasons vocabulary
COMMENT ON COLUMN pairing_sessions.failure_reasons IS 
  'Valid values: too_tannic, too_acidic, too_sweet, too_oaky, too_light, too_heavy, 
   clashed_with_spice, clashed_with_sauce, overwhelmed_dish, underwhelmed_dish, 
   wrong_temperature, other';
```

### File: `src/db/migrations/024_user_taste_profile.sql`

```sql
-- User Taste Profile: DERIVED snapshot, recomputable from events
-- This is a cache, not source of truth

CREATE TABLE IF NOT EXISTS user_taste_profile (
  user_id TEXT PRIMARY KEY DEFAULT 'default',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Derived preferences (jsonb for flexibility)
  colour_preferences JSONB,
  style_preferences JSONB,
  region_preferences JSONB,
  grape_preferences JSONB,
  
  -- Pairing-specific learnings
  food_wine_affinities JSONB,
  failure_patterns JSONB,
  
  -- Meta
  data_points INTEGER DEFAULT 0,
  data_diversity_score REAL,
  data_recency_days INTEGER,
  profile_confidence TEXT CHECK (profile_confidence IN ('insufficient', 'low', 'medium', 'high')),
  
  -- Audit
  last_recalculated TIMESTAMPTZ,
  contributing_session_ids INTEGER[]
);

COMMENT ON TABLE user_taste_profile IS 
  'Derived snapshot, recomputable from pairing_sessions + wine_ratings + consumption_log. 
   Delete and rebuild if data integrity is questioned.';
```

---

## Phase 1a: Pairing Session Service

### File: `src/services/pairingSession.js`

```javascript
/**
 * @fileoverview Pairing session persistence and feedback management.
 * Captures every Find Pairing interaction for learning and profile building.
 */

import db from '../db/index.js';

/**
 * Failure reason vocabulary (controlled, not free text)
 */
export const FAILURE_REASONS = [
  'too_tannic',
  'too_acidic', 
  'too_sweet',
  'too_oaky',
  'too_light',
  'too_heavy',
  'clashed_with_spice',
  'clashed_with_sauce',
  'overwhelmed_dish',
  'underwhelmed_dish',
  'wrong_temperature',
  'other'
];

/**
 * Create a new pairing session record.
 * Called automatically when getSommelierRecommendation returns successfully.
 * 
 * @param {Object} params
 * @param {string} params.dish - Original dish description
 * @param {string} params.source - 'all' | 'reduce_now'
 * @param {string} params.colour - 'any' | 'red' | 'white' | 'rose' | 'sparkling'
 * @param {string[]} params.foodSignals - Extracted food signals
 * @param {string} params.dishAnalysis - AI's dish interpretation
 * @param {Object[]} params.recommendations - Ranked recommendations with wine_ids
 * @param {string} [params.userId='default'] - User identifier
 * @returns {Promise<number>} Session ID
 */
export async function createPairingSession({
  dish,
  source,
  colour,
  foodSignals,
  dishAnalysis,
  recommendations,
  userId = 'default'
}) {
  const result = await db.prepare(`
    INSERT INTO pairing_sessions (
      user_id,
      dish_description,
      source_filter,
      colour_filter,
      food_signals,
      dish_analysis,
      recommendations
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id
  `).get(
    userId,
    dish,
    source,
    colour,
    JSON.stringify(foodSignals),
    dishAnalysis,
    JSON.stringify(recommendations)
  );
  
  return result.id;
}

/**
 * Record which wine the user chose from recommendations.
 * 
 * @param {number} sessionId - Pairing session ID
 * @param {number} wineId - Chosen wine ID
 * @param {number} rank - Which rank was chosen (1, 2, or 3)
 * @returns {Promise<void>}
 */
export async function recordWineChoice(sessionId, wineId, rank) {
  await db.prepare(`
    UPDATE pairing_sessions
    SET chosen_wine_id = $1,
        chosen_rank = $2,
        chosen_at = NOW()
    WHERE id = $3
  `).run(wineId, rank, sessionId);
}

/**
 * Link a pairing session to a consumption event.
 * Called when user logs consumption of a wine that has a recent pairing session.
 * 
 * @param {number} sessionId - Pairing session ID
 * @param {number} consumptionLogId - ID from consumption_log table
 * @returns {Promise<void>}
 */
export async function linkConsumption(sessionId, consumptionLogId) {
  await db.prepare(`
    UPDATE pairing_sessions
    SET consumption_log_id = $1,
        confirmed_consumed = TRUE
    WHERE id = $2
  `).run(consumptionLogId, sessionId);
}

/**
 * Record user feedback on a pairing.
 * 
 * @param {number} sessionId - Pairing session ID
 * @param {Object} feedback
 * @param {number} feedback.pairingFitRating - 1.0-5.0 in 0.5 steps
 * @param {boolean} feedback.wouldPairAgain - Would they pair these again?
 * @param {string[]} [feedback.failureReasons] - If rating <= 2.5, what went wrong
 * @param {string} [feedback.notes] - Optional free text (never injected into prompts)
 * @returns {Promise<void>}
 */
export async function recordFeedback(sessionId, {
  pairingFitRating,
  wouldPairAgain,
  failureReasons = null,
  notes = null
}) {
  // Validate rating
  if (pairingFitRating < 1 || pairingFitRating > 5) {
    throw new Error('Pairing fit rating must be between 1 and 5');
  }
  
  // Validate failure reasons if provided
  if (failureReasons) {
    const invalid = failureReasons.filter(r => !FAILURE_REASONS.includes(r));
    if (invalid.length > 0) {
      throw new Error(`Invalid failure reasons: ${invalid.join(', ')}`);
    }
  }
  
  await db.prepare(`
    UPDATE pairing_sessions
    SET pairing_fit_rating = $1,
        would_pair_again = $2,
        failure_reasons = $3,
        feedback_notes = $4,
        feedback_at = NOW()
    WHERE id = $5
  `).run(
    pairingFitRating,
    wouldPairAgain,
    failureReasons ? JSON.stringify(failureReasons) : null,
    notes,
    sessionId
  );
}

/**
 * Find pairing sessions pending feedback.
 * Used by feedback trigger logic.
 * 
 * @param {string} [userId='default'] - User identifier
 * @param {number} [maxAgeDays=2] - Only return sessions within this many days
 * @returns {Promise<Object[]>} Sessions needing feedback
 */
export async function getPendingFeedbackSessions(userId = 'default', maxAgeDays = 2) {
  const results = await db.prepare(`
    SELECT 
      ps.id,
      ps.dish_description,
      ps.chosen_wine_id,
      ps.chosen_at,
      ps.confirmed_consumed,
      w.wine_name,
      w.vintage
    FROM pairing_sessions ps
    LEFT JOIN wines w ON ps.chosen_wine_id = w.id
    WHERE ps.user_id = $1
      AND ps.chosen_wine_id IS NOT NULL
      AND ps.pairing_fit_rating IS NULL
      AND ps.created_at > NOW() - INTERVAL '${maxAgeDays} days'
    ORDER BY ps.created_at DESC
  `).all(userId);
  
  return results;
}

/**
 * Find recent pairing session for a specific wine.
 * Used when user logs consumption to auto-link sessions.
 * 
 * @param {number} wineId - Wine ID
 * @param {string} [userId='default'] - User identifier
 * @param {number} [maxAgeHours=48] - Look back this many hours
 * @returns {Promise<Object|null>} Most recent matching session or null
 */
export async function findRecentSessionForWine(wineId, userId = 'default', maxAgeHours = 48) {
  const result = await db.prepare(`
    SELECT id, dish_description, created_at
    FROM pairing_sessions
    WHERE user_id = $1
      AND chosen_wine_id = $2
      AND consumption_log_id IS NULL
      AND created_at > NOW() - INTERVAL '${maxAgeHours} hours'
    ORDER BY created_at DESC
    LIMIT 1
  `).get(userId, wineId);
  
  return result || null;
}

/**
 * Get pairing history for a user.
 * Used for "Past Pairings" review section.
 * 
 * @param {string} [userId='default'] - User identifier
 * @param {Object} [options]
 * @param {number} [options.limit=20] - Max results
 * @param {number} [options.offset=0] - Pagination offset
 * @param {boolean} [options.feedbackOnly=false] - Only sessions with feedback
 * @returns {Promise<Object[]>} Pairing history
 */
export async function getPairingHistory(userId = 'default', { limit = 20, offset = 0, feedbackOnly = false } = {}) {
  const feedbackFilter = feedbackOnly ? 'AND ps.pairing_fit_rating IS NOT NULL' : '';
  
  const results = await db.prepare(`
    SELECT 
      ps.id,
      ps.dish_description,
      ps.food_signals,
      ps.created_at,
      ps.chosen_wine_id,
      ps.chosen_rank,
      ps.confirmed_consumed,
      ps.pairing_fit_rating,
      ps.would_pair_again,
      ps.failure_reasons,
      w.wine_name,
      w.vintage,
      w.colour
    FROM pairing_sessions ps
    LEFT JOIN wines w ON ps.chosen_wine_id = w.id
    WHERE ps.user_id = $1
      ${feedbackFilter}
    ORDER BY ps.created_at DESC
    LIMIT $2 OFFSET $3
  `).all(userId, limit, offset);
  
  return results.map(r => ({
    ...r,
    food_signals: r.food_signals ? JSON.parse(r.food_signals) : [],
    failure_reasons: r.failure_reasons ? JSON.parse(r.failure_reasons) : null
  }));
}

/**
 * Get aggregate statistics for pairing feedback.
 * Used for profile calculation and UI display.
 * 
 * @param {string} [userId='default'] - User identifier
 * @returns {Promise<Object>} Aggregate stats
 */
export async function getPairingStats(userId = 'default') {
  const result = await db.prepare(`
    SELECT 
      COUNT(*) as total_sessions,
      COUNT(chosen_wine_id) as sessions_with_choice,
      COUNT(pairing_fit_rating) as sessions_with_feedback,
      AVG(pairing_fit_rating) as avg_pairing_rating,
      SUM(CASE WHEN would_pair_again THEN 1 ELSE 0 END) as would_pair_again_count,
      SUM(CASE WHEN confirmed_consumed THEN 1 ELSE 0 END) as confirmed_consumed_count
    FROM pairing_sessions
    WHERE user_id = $1
  `).get(userId);
  
  return {
    totalSessions: result.total_sessions,
    sessionsWithChoice: result.sessions_with_choice,
    sessionsWithFeedback: result.sessions_with_feedback,
    avgPairingRating: result.avg_pairing_rating ? parseFloat(result.avg_pairing_rating.toFixed(2)) : null,
    wouldPairAgainRate: result.sessions_with_feedback > 0 
      ? (result.would_pair_again_count / result.sessions_with_feedback * 100).toFixed(1)
      : null,
    consumptionConfirmationRate: result.sessions_with_choice > 0
      ? (result.confirmed_consumed_count / result.sessions_with_choice * 100).toFixed(1)
      : null
  };
}
```

---

## Phase 1a: Integration with Existing Pairing Service

### File: `src/services/claude.js` (MODIFY)

Add session creation after successful pairing response.

```javascript
// In getSommelierRecommendation function, after parsing the AI response:

import { createPairingSession } from './pairingSession.js';

// ... existing code ...

// After successful response parsing, save the session
const sessionId = await createPairingSession({
  dish,
  source,
  colour,
  foodSignals: parsedResponse.signals || [],
  dishAnalysis: parsedResponse.dish_analysis || '',
  recommendations: parsedResponse.recommendations.map((rec, idx) => ({
    rank: idx + 1,
    wine_id: rec.wine_id,
    wine_name: rec.wine_name,
    vintage: rec.vintage,
    why: rec.why,
    is_priority: rec.is_priority
  }))
});

// Include sessionId in the response for frontend to track
return {
  ...parsedResponse,
  sessionId  // <-- ADD THIS
};
```

---

## Phase 1b: API Routes

### File: `src/routes/pairing.js` (MODIFY or CREATE)

```javascript
/**
 * @fileoverview Pairing feedback API routes.
 */

import express from 'express';
import { 
  recordWineChoice,
  recordFeedback,
  getPendingFeedbackSessions,
  getPairingHistory,
  getPairingStats,
  FAILURE_REASONS
} from '../services/pairingSession.js';

const router = express.Router();

/**
 * POST /api/pairing/sessions/:id/choose
 * Record which wine the user chose from recommendations.
 */
router.post('/sessions/:id/choose', async (req, res) => {
  try {
    const sessionId = parseInt(req.params.id, 10);
    const { wineId, rank } = req.body;
    
    if (!wineId || !rank) {
      return res.status(400).json({ error: 'wineId and rank are required' });
    }
    
    await recordWineChoice(sessionId, wineId, rank);
    res.json({ success: true });
  } catch (error) {
    console.error('Error recording wine choice:', error);
    res.status(500).json({ error: 'Failed to record wine choice' });
  }
});

/**
 * POST /api/pairing/sessions/:id/feedback
 * Record user feedback on a pairing.
 */
router.post('/sessions/:id/feedback', async (req, res) => {
  try {
    const sessionId = parseInt(req.params.id, 10);
    const { pairingFitRating, wouldPairAgain, failureReasons, notes } = req.body;
    
    if (pairingFitRating === undefined || wouldPairAgain === undefined) {
      return res.status(400).json({ error: 'pairingFitRating and wouldPairAgain are required' });
    }
    
    await recordFeedback(sessionId, {
      pairingFitRating,
      wouldPairAgain,
      failureReasons,
      notes
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error recording feedback:', error);
    res.status(500).json({ error: error.message || 'Failed to record feedback' });
  }
});

/**
 * GET /api/pairing/sessions/pending-feedback
 * Get sessions that need feedback.
 */
router.get('/sessions/pending-feedback', async (req, res) => {
  try {
    const sessions = await getPendingFeedbackSessions();
    res.json({ sessions });
  } catch (error) {
    console.error('Error fetching pending sessions:', error);
    res.status(500).json({ error: 'Failed to fetch pending sessions' });
  }
});

/**
 * GET /api/pairing/history
 * Get pairing history with optional filters.
 */
router.get('/history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 20;
    const offset = parseInt(req.query.offset, 10) || 0;
    const feedbackOnly = req.query.feedbackOnly === 'true';
    
    const history = await getPairingHistory('default', { limit, offset, feedbackOnly });
    res.json({ history });
  } catch (error) {
    console.error('Error fetching pairing history:', error);
    res.status(500).json({ error: 'Failed to fetch pairing history' });
  }
});

/**
 * GET /api/pairing/stats
 * Get aggregate pairing statistics.
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = await getPairingStats();
    res.json(stats);
  } catch (error) {
    console.error('Error fetching pairing stats:', error);
    res.status(500).json({ error: 'Failed to fetch pairing stats' });
  }
});

/**
 * GET /api/pairing/failure-reasons
 * Get valid failure reason vocabulary.
 */
router.get('/failure-reasons', (req, res) => {
  res.json({ reasons: FAILURE_REASONS });
});

export default router;
```

### Register route in `src/server.js` or `src/app.js`:

```javascript
import pairingRoutes from './routes/pairing.js';
// ...
app.use('/api/pairing', pairingRoutes);
```

---

## Phase 1b: Frontend - Choose This Wine Button

### File: `public/js/pairing.js` (MODIFY)

Add "Choose This Wine" button to recommendation cards and track selection.

```javascript
/**
 * Track the current pairing session ID (set when recommendations return)
 */
let currentSessionId = null;

/**
 * Render a single recommendation card with "Choose This Wine" button.
 * MODIFY existing renderRecommendation function.
 */
function renderRecommendation(rec, rank) {
  const card = document.createElement('div');
  card.className = 'recommendation-card';
  card.innerHTML = `
    <div class="rec-header">
      <span class="rec-rank">#${rank}</span>
      <span class="rec-wine-name">${rec.wine_name}</span>
      <span class="rec-vintage">${rec.vintage || 'NV'}</span>
      ${rec.is_priority ? '<span class="priority-badge">★ Priority</span>' : ''}
    </div>
    <div class="rec-why">${rec.why}</div>
    ${rec.food_tip ? `<div class="rec-food-tip">💡 ${rec.food_tip}</div>` : ''}
    <div class="rec-serving">
      ${rec.serving_temp ? `🌡️ ${rec.serving_temp}` : ''}
      ${rec.decant_time ? ` | ⏱️ Decant ${rec.decant_time}` : ''}
    </div>
    <div class="rec-actions">
      <button class="btn btn-primary btn-choose-wine" 
              data-wine-id="${rec.wine_id}" 
              data-rank="${rank}">
        Choose This Wine
      </button>
      <button class="btn btn-secondary btn-view-wine" 
              data-wine-id="${rec.wine_id}">
        View Details
      </button>
    </div>
  `;
  
  // Attach click handlers
  card.querySelector('.btn-choose-wine').addEventListener('click', (e) => {
    handleChooseWine(rec.wine_id, rank, e.target);
  });
  
  card.querySelector('.btn-view-wine').addEventListener('click', () => {
    openWineDetail(rec.wine_id);
  });
  
  return card;
}

/**
 * Handle "Choose This Wine" button click.
 */
async function handleChooseWine(wineId, rank, buttonElement) {
  if (!currentSessionId) {
    console.warn('No session ID available');
    return;
  }
  
  try {
    buttonElement.disabled = true;
    buttonElement.textContent = 'Chosen ✓';
    
    // Mark all other choose buttons as not selected
    document.querySelectorAll('.btn-choose-wine').forEach(btn => {
      if (btn !== buttonElement) {
        btn.classList.remove('chosen');
        btn.textContent = 'Choose This Wine';
        btn.disabled = false;
      }
    });
    
    buttonElement.classList.add('chosen');
    
    // Record the choice
    await fetch(`/api/pairing/sessions/${currentSessionId}/choose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wineId, rank })
    });
    
  } catch (error) {
    console.error('Error recording wine choice:', error);
    buttonElement.disabled = false;
    buttonElement.textContent = 'Choose This Wine';
  }
}

/**
 * MODIFY existing displayRecommendations to capture sessionId.
 */
function displayRecommendations(response) {
  // Store session ID for choice tracking
  currentSessionId = response.sessionId || null;
  
  // ... rest of existing display logic ...
}
```

### CSS additions for `public/css/styles.css`:

```css
/* Pairing recommendation cards */
.rec-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border-color);
}

.btn-choose-wine {
  flex: 1;
}

.btn-choose-wine.chosen {
  background: var(--success-color);
  cursor: default;
}

.btn-view-wine {
  flex: 0 0 auto;
}
```

---

## Phase 1c: Link to Consumption Events

### File: `src/services/consumption.js` (MODIFY or wherever consumption is handled)

When a user logs consumption, check for recent pairing sessions and link them.

```javascript
import { findRecentSessionForWine, linkConsumption } from './pairingSession.js';

/**
 * Log wine consumption and link to pairing session if applicable.
 * MODIFY existing logConsumption function.
 */
export async function logConsumption(wineId, quantity = 1, notes = null) {
  // ... existing consumption logging logic ...
  
  // Insert into consumption_log and get the ID
  const consumptionResult = await db.prepare(`
    INSERT INTO consumption_log (wine_id, quantity, notes, consumed_at)
    VALUES ($1, $2, $3, NOW())
    RETURNING id
  `).get(wineId, quantity, notes);
  
  const consumptionLogId = consumptionResult.id;
  
  // Check for recent pairing session with this wine
  const recentSession = await findRecentSessionForWine(wineId);
  
  if (recentSession) {
    // Link the consumption to the pairing session
    await linkConsumption(recentSession.id, consumptionLogId);
    
    // Return session info for feedback prompt trigger
    return {
      consumptionLogId,
      linkedPairingSession: {
        id: recentSession.id,
        dish: recentSession.dish_description
      }
    };
  }
  
  return { consumptionLogId, linkedPairingSession: null };
}
```

---

## Phase 2a: Feedback Modal

### File: `public/js/pairingFeedback.js` (NEW)

```javascript
/**
 * @fileoverview Pairing feedback modal and trigger logic.
 */

/**
 * Show feedback modal for a pairing session.
 * 
 * @param {Object} session - Session data
 * @param {number} session.id - Session ID
 * @param {string} session.dish_description - Original dish
 * @param {string} session.wine_name - Chosen wine name
 * @param {number} session.vintage - Wine vintage
 */
export function showFeedbackModal(session) {
  const modal = document.getElementById('pairing-feedback-modal');
  
  // Populate modal content
  modal.querySelector('.feedback-dish').textContent = session.dish_description;
  modal.querySelector('.feedback-wine').textContent = 
    `${session.wine_name} ${session.vintage || ''}`;
  
  // Reset form
  const form = modal.querySelector('form');
  form.reset();
  form.dataset.sessionId = session.id;
  
  // Hide failure reasons initially
  modal.querySelector('.failure-reasons-section').style.display = 'none';
  
  // Show modal
  modal.classList.add('active');
  modal.setAttribute('aria-hidden', 'false');
}

/**
 * Initialize feedback modal handlers.
 */
export function initFeedbackModal() {
  const modal = document.getElementById('pairing-feedback-modal');
  const form = modal.querySelector('form');
  const slider = form.querySelector('#pairing-fit-rating');
  const sliderValue = form.querySelector('.slider-value');
  const failureSection = modal.querySelector('.failure-reasons-section');
  
  // Update slider display
  slider.addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    sliderValue.textContent = value.toFixed(1);
    
    // Show failure reasons if rating is low
    failureSection.style.display = value <= 2.5 ? 'block' : 'none';
  });
  
  // Form submission
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const sessionId = form.dataset.sessionId;
    const pairingFitRating = parseFloat(slider.value);
    const wouldPairAgain = form.querySelector('input[name="would-pair-again"]:checked')?.value === 'yes';
    
    // Collect failure reasons if applicable
    let failureReasons = null;
    if (pairingFitRating <= 2.5) {
      failureReasons = Array.from(form.querySelectorAll('input[name="failure-reason"]:checked'))
        .map(cb => cb.value);
    }
    
    const notes = form.querySelector('#feedback-notes').value.trim() || null;
    
    try {
      await fetch(`/api/pairing/sessions/${sessionId}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pairingFitRating,
          wouldPairAgain,
          failureReasons,
          notes
        })
      });
      
      closeModal(modal);
      showToast('Thanks for your feedback!');
      
    } catch (error) {
      console.error('Error submitting feedback:', error);
      showToast('Failed to save feedback', 'error');
    }
  });
  
  // Close handlers
  modal.querySelector('.btn-skip').addEventListener('click', () => {
    closeModal(modal);
  });
  
  modal.querySelector('.modal-close').addEventListener('click', () => {
    closeModal(modal);
  });
}

/**
 * Check for pending feedback on app load.
 * Shows feedback prompt if there's a recent session needing feedback.
 */
export async function checkPendingFeedback() {
  try {
    const response = await fetch('/api/pairing/sessions/pending-feedback');
    const { sessions } = await response.json();
    
    if (sessions.length > 0) {
      // Show feedback for the most recent session with confirmed consumption first
      const prioritySession = sessions.find(s => s.confirmed_consumed) || sessions[0];
      showFeedbackModal(prioritySession);
    }
  } catch (error) {
    console.error('Error checking pending feedback:', error);
  }
}

function closeModal(modal) {
  modal.classList.remove('active');
  modal.setAttribute('aria-hidden', 'true');
}

function showToast(message, type = 'success') {
  // Use existing toast system or implement simple toast
  console.log(`[${type}] ${message}`);
}
```

### File: `public/index.html` (ADD modal HTML)

```html
<!-- Pairing Feedback Modal -->
<div id="pairing-feedback-modal" class="modal" aria-hidden="true" role="dialog">
  <div class="modal-content">
    <button class="modal-close" aria-label="Close">&times;</button>
    
    <h2>How was the pairing?</h2>
    
    <div class="feedback-context">
      <div class="feedback-wine">🍷 <span class="feedback-wine"></span></div>
      <div class="feedback-dish">🍽️ <span class="feedback-dish"></span></div>
    </div>
    
    <form id="pairing-feedback-form">
      <!-- Rating Slider -->
      <div class="form-group">
        <label for="pairing-fit-rating">How well did it match the dish?</label>
        <div class="slider-container">
          <span class="slider-label">Miss</span>
          <input type="range" 
                 id="pairing-fit-rating" 
                 name="pairing-fit-rating"
                 min="1" max="5" step="0.5" 
                 value="3.5">
          <span class="slider-label">Perfect</span>
        </div>
        <div class="slider-value">3.5</div>
      </div>
      
      <!-- Would Pair Again -->
      <div class="form-group">
        <label>Would you pair these again?</label>
        <div class="radio-group">
          <label>
            <input type="radio" name="would-pair-again" value="yes"> Yes
          </label>
          <label>
            <input type="radio" name="would-pair-again" value="no"> No
          </label>
        </div>
      </div>
      
      <!-- Failure Reasons (shown only when rating <= 2.5) -->
      <div class="failure-reasons-section" style="display: none;">
        <label>What didn't work? (tap all that apply)</label>
        <div class="checkbox-grid">
          <label><input type="checkbox" name="failure-reason" value="too_tannic"> Wine too tannic</label>
          <label><input type="checkbox" name="failure-reason" value="too_acidic"> Wine too acidic</label>
          <label><input type="checkbox" name="failure-reason" value="too_sweet"> Wine too sweet</label>
          <label><input type="checkbox" name="failure-reason" value="too_oaky"> Wine too oaky</label>
          <label><input type="checkbox" name="failure-reason" value="too_light"> Wine too light</label>
          <label><input type="checkbox" name="failure-reason" value="too_heavy"> Wine too heavy</label>
          <label><input type="checkbox" name="failure-reason" value="clashed_with_spice"> Clashed with spice</label>
          <label><input type="checkbox" name="failure-reason" value="clashed_with_sauce"> Clashed with sauce</label>
          <label><input type="checkbox" name="failure-reason" value="overwhelmed_dish"> Overwhelmed the dish</label>
          <label><input type="checkbox" name="failure-reason" value="underwhelmed_dish"> Underwhelmed the dish</label>
          <label><input type="checkbox" name="failure-reason" value="wrong_temperature"> Wrong serving temp</label>
          <label><input type="checkbox" name="failure-reason" value="other"> Other</label>
        </div>
      </div>
      
      <!-- Optional Notes -->
      <div class="form-group">
        <label for="feedback-notes">Notes (optional)</label>
        <textarea id="feedback-notes" name="notes" rows="2" 
                  placeholder="Any other thoughts..."></textarea>
      </div>
      
      <!-- Actions -->
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary">Submit</button>
        <button type="button" class="btn btn-secondary btn-skip">Skip</button>
      </div>
    </form>
  </div>
</div>
```

---

## Phase 2c: Feedback Trigger Policy

### File: `public/js/app.js` (MODIFY)

```javascript
import { initFeedbackModal, checkPendingFeedback } from './pairingFeedback.js';

// On app initialization
document.addEventListener('DOMContentLoaded', () => {
  // ... existing init code ...
  
  // Initialize feedback modal
  initFeedbackModal();
  
  // Check for pending feedback after short delay (let main UI load first)
  setTimeout(() => {
    checkPendingFeedback();
  }, 2000);
});
```

### Trigger on consumption logging (MODIFY consumption UI):

```javascript
// When user logs consumption successfully
async function handleConsumptionLogged(result) {
  if (result.linkedPairingSession) {
    // Show feedback modal for the linked pairing
    showFeedbackModal({
      id: result.linkedPairingSession.id,
      dish_description: result.linkedPairingSession.dish,
      wine_name: currentWine.wine_name,  // from consumption context
      vintage: currentWine.vintage
    });
  }
}
```

---

## Testing Requirements

### Unit Tests: `tests/unit/services/pairingSession.test.js`

```javascript
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createPairingSession,
  recordWineChoice,
  recordFeedback,
  getPendingFeedbackSessions,
  FAILURE_REASONS
} from '../../../src/services/pairingSession.js';

describe('pairingSession service', () => {
  describe('createPairingSession', () => {
    it('should create a session and return ID', async () => {
      const sessionId = await createPairingSession({
        dish: 'Grilled lamb with rosemary',
        source: 'all',
        colour: 'red',
        foodSignals: ['grilled', 'lamb', 'herbal'],
        dishAnalysis: 'Rich, herb-forward dish needing structured wine',
        recommendations: [
          { rank: 1, wine_id: 1, wine_name: 'Test Shiraz', vintage: 2019, why: 'Perfect match' }
        ]
      });
      
      expect(sessionId).toBeDefined();
      expect(typeof sessionId).toBe('number');
    });
  });
  
  describe('recordWineChoice', () => {
    it('should update session with chosen wine', async () => {
      // Create session first
      const sessionId = await createPairingSession({ /* ... */ });
      
      await recordWineChoice(sessionId, 1, 1);
      
      // Verify update
      const session = await getSessionById(sessionId);
      expect(session.chosen_wine_id).toBe(1);
      expect(session.chosen_rank).toBe(1);
      expect(session.chosen_at).toBeDefined();
    });
  });
  
  describe('recordFeedback', () => {
    it('should validate rating range', async () => {
      const sessionId = await createPairingSession({ /* ... */ });
      
      await expect(recordFeedback(sessionId, {
        pairingFitRating: 6,  // Invalid
        wouldPairAgain: true
      })).rejects.toThrow('between 1 and 5');
    });
    
    it('should validate failure reasons vocabulary', async () => {
      const sessionId = await createPairingSession({ /* ... */ });
      
      await expect(recordFeedback(sessionId, {
        pairingFitRating: 2,
        wouldPairAgain: false,
        failureReasons: ['invalid_reason']
      })).rejects.toThrow('Invalid failure reasons');
    });
    
    it('should accept valid feedback', async () => {
      const sessionId = await createPairingSession({ /* ... */ });
      
      await recordFeedback(sessionId, {
        pairingFitRating: 4.5,
        wouldPairAgain: true,
        notes: 'Great match!'
      });
      
      const session = await getSessionById(sessionId);
      expect(session.pairing_fit_rating).toBe(4.5);
      expect(session.would_pair_again).toBe(true);
    });
  });
  
  describe('FAILURE_REASONS', () => {
    it('should contain expected failure types', () => {
      expect(FAILURE_REASONS).toContain('too_tannic');
      expect(FAILURE_REASONS).toContain('clashed_with_spice');
      expect(FAILURE_REASONS.length).toBe(12);
    });
  });
});
```

---

## Files Summary

| Phase | File | Action |
|-------|------|--------|
| 1a | `src/db/migrations/023_pairing_sessions.sql` | CREATE |
| 1a | `src/db/migrations/024_user_taste_profile.sql` | CREATE |
| 1a | `src/services/pairingSession.js` | CREATE |
| 1a | `src/services/claude.js` | MODIFY - add session creation |
| 1b | `src/routes/pairing.js` | CREATE |
| 1b | `src/server.js` | MODIFY - register route |
| 1b | `public/js/pairing.js` | MODIFY - add Choose button |
| 1b | `public/css/styles.css` | MODIFY - add styles |
| 1c | `src/services/consumption.js` | MODIFY - link sessions |
| 2a | `public/js/pairingFeedback.js` | CREATE |
| 2a | `public/index.html` | MODIFY - add modal HTML |
| 2b | (included in 2a) | Failure reasons in modal |
| 2c | `public/js/app.js` | MODIFY - trigger on load |
| Test | `tests/unit/services/pairingSession.test.js` | CREATE |

---

## Acceptance Criteria

### Phase 1a
- [ ] Migration runs without error on PostgreSQL
- [ ] Migration runs without error on SQLite (local dev)
- [ ] `pairing_sessions` table created with all columns
- [ ] `user_taste_profile` table created
- [ ] Indexes created

### Phase 1b
- [ ] Every Find Pairing request creates a `pairing_sessions` record
- [ ] `sessionId` returned in pairing response
- [ ] "Choose This Wine" button appears on recommendation cards
- [ ] Clicking button records choice via API
- [ ] Button shows "Chosen ✓" state after selection
- [ ] API routes return correct data

### Phase 1c
- [ ] Logging consumption checks for recent pairing session
- [ ] If found, links `consumption_log_id` to session
- [ ] `confirmed_consumed` set to TRUE

### Phase 2a
- [ ] Feedback modal renders correctly
- [ ] Slider updates display value in real-time
- [ ] Submit sends data to API
- [ ] Modal closes on submit or skip

### Phase 2b
- [ ] Failure reasons section hidden by default
- [ ] Shows when rating <= 2.5
- [ ] Multi-select checkboxes work
- [ ] Failure reasons saved correctly

### Phase 2c
- [ ] Pending feedback check runs on app load
- [ ] Modal shows for most recent pending session
- [ ] Modal shows after consumption logging if linked session exists
- [ ] Only one prompt per session (skip = never ask again)

---

## Notes for Implementation

1. **Database Compatibility**: The migrations use PostgreSQL syntax. For SQLite compatibility in local dev, the abstraction layer in `src/db/index.js` should handle `NOW()` → `datetime('now')` translation.

2. **Session ID Handling**: Ensure the `sessionId` is passed through the response chain from `claude.js` to the frontend without breaking existing consumers.

3. **Consumption Table**: Verify the actual table name is `consumption_log` and adjust if different.

4. **Feedback Modal Styling**: Match existing modal patterns in the app for consistency.

5. **Service Worker**: If feedback modal needs offline support, cache the modal HTML in sw.js.

6. **Rate Limiting**: The feedback endpoints are low-volume; existing rate limits should suffice.

---

**End of Implementation Brief**
