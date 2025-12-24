# Phase 7: Drinking Window Feature

## Overview

Replace implicit urgency logic (age, low ratings) with explicit drinking window data captured from critics and user input. This enables accurate "drink soon" recommendations based on actual maturity windows rather than proxies.

---

## 1. Database Changes

### 1.1 Migration: Create Drinking Windows Table

Create file: `migrations/007_drinking_windows.sql`

```sql
-- Drinking windows table (supports multiple opinions per wine)
CREATE TABLE IF NOT EXISTS drinking_windows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wine_id INTEGER NOT NULL REFERENCES wines(id) ON DELETE CASCADE,
  source TEXT NOT NULL,                    -- 'halliday', 'vivino', 'wine_spectator', 'manual', etc.
  drink_from_year INTEGER,                 -- earliest recommended year
  drink_by_year INTEGER,                   -- latest recommended year
  peak_year INTEGER,                       -- optimal drinking year (optional)
  confidence TEXT DEFAULT 'medium',        -- 'high', 'medium', 'low'
  raw_text TEXT,                           -- original text: "Drink 2024-2030"
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(wine_id, source)                  -- one window per source per wine
);

CREATE INDEX idx_drinking_windows_wine_id ON drinking_windows(wine_id);
CREATE INDEX idx_drinking_windows_drink_by ON drinking_windows(drink_by_year);
CREATE INDEX idx_drinking_windows_source ON drinking_windows(source);

-- New user settings for window-based reduce rules
INSERT OR IGNORE INTO user_settings (key, value, description) VALUES
  ('reduce_window_urgency_months', '12', 'Flag wines within N months of drink_by date'),
  ('reduce_include_no_window', 'true', 'Include wines without drinking window data in evaluation'),
  ('reduce_window_source_priority', '["manual","halliday","wine_spectator","decanter","vivino"]', 'Priority order for selecting drinking window when multiple sources exist');
```

### 1.2 Optional: Add Convenience Columns to Wines Table

If you want quick access without joins:

```sql
-- Optional: cached "best" window on wines table for quick queries
ALTER TABLE wines ADD COLUMN drink_from_year INTEGER;
ALTER TABLE wines ADD COLUMN drink_by_year INTEGER;
ALTER TABLE wines ADD COLUMN drinking_window_source TEXT;
```

---

## 2. Backend API Changes

### 2.1 New File: `drinkingWindows.js`

Create a new route handler for drinking window operations:

```javascript
const express = require('express');
const router = express.Router();
const db = require('./db');

// GET /api/wines/:wine_id/drinking-windows
// Returns all drinking windows for a wine
router.get('/wines/:wine_id/drinking-windows', async (req, res) => {
  try {
    const { wine_id } = req.params;
    const windows = await db.all(`
      SELECT * FROM drinking_windows 
      WHERE wine_id = ? 
      ORDER BY 
        CASE source 
          WHEN 'manual' THEN 0 
          ELSE 1 
        END,
        updated_at DESC
    `, [wine_id]);
    res.json(windows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/wines/:wine_id/drinking-windows
// Add or update a drinking window (upsert by source)
router.post('/wines/:wine_id/drinking-windows', async (req, res) => {
  try {
    const { wine_id } = req.params;
    const { source, drink_from_year, drink_by_year, peak_year, confidence, raw_text } = req.body;
    
    if (!source) {
      return res.status(400).json({ error: 'source is required' });
    }
    
    await db.run(`
      INSERT INTO drinking_windows (wine_id, source, drink_from_year, drink_by_year, peak_year, confidence, raw_text, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(wine_id, source) DO UPDATE SET
        drink_from_year = excluded.drink_from_year,
        drink_by_year = excluded.drink_by_year,
        peak_year = excluded.peak_year,
        confidence = excluded.confidence,
        raw_text = excluded.raw_text,
        updated_at = CURRENT_TIMESTAMP
    `, [wine_id, source, drink_from_year, drink_by_year, peak_year, confidence || 'medium', raw_text]);
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/wines/:wine_id/drinking-windows/:source
router.delete('/wines/:wine_id/drinking-windows/:source', async (req, res) => {
  try {
    const { wine_id, source } = req.params;
    await db.run('DELETE FROM drinking_windows WHERE wine_id = ? AND source = ?', [wine_id, source]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/drinking-windows/urgent
// Returns wines with urgent drinking windows
router.get('/drinking-windows/urgent', async (req, res) => {
  try {
    const urgencyMonths = parseInt(req.query.months) || 12;
    const currentYear = new Date().getFullYear();
    const urgencyYear = currentYear + Math.ceil(urgencyMonths / 12);
    
    const urgent = await db.all(`
      SELECT 
        w.id, w.name, w.vintage, w.producer, w.bottle_count,
        dw.drink_from_year, dw.drink_by_year, dw.peak_year, dw.source as window_source,
        (dw.drink_by_year - ?) as years_remaining
      FROM wines w
      JOIN drinking_windows dw ON w.id = dw.wine_id
      WHERE w.bottle_count > 0
        AND dw.drink_by_year IS NOT NULL
        AND dw.drink_by_year <= ?
      ORDER BY dw.drink_by_year ASC
    `, [currentYear, urgencyYear]);
    
    res.json(urgent);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
```

### 2.2 Update `reduceNow.js` - Evaluate Endpoint

Replace the existing evaluate logic with window-based evaluation:

```javascript
// POST /api/reduce-now/evaluate
router.post('/evaluate', async (req, res) => {
  try {
    const settings = await getSettings();
    const urgencyMonths = parseInt(settings.reduce_window_urgency_months) || 12;
    const includeNoWindow = settings.reduce_include_no_window === 'true';
    const ageThreshold = parseInt(settings.reduce_age_threshold) || 10;
    const ratingMinimum = parseFloat(settings.reduce_rating_minimum) || 3.0;
    const sourcePriority = JSON.parse(settings.reduce_window_source_priority || '["manual","halliday","vivino"]');
    
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;
    const urgencyDate = new Date();
    urgencyDate.setMonth(urgencyDate.getMonth() + urgencyMonths);
    const urgencyYear = urgencyDate.getFullYear();
    
    const candidates = [];
    const seenWineIds = new Set();
    
    // Priority 1: Wines past their drinking window
    const pastWindow = await db.all(`
      SELECT DISTINCT
        w.id, w.name, w.vintage, w.producer, w.bottle_count,
        dw.drink_by_year, dw.source as window_source
      FROM wines w
      JOIN drinking_windows dw ON w.id = dw.wine_id
      WHERE w.bottle_count > 0
        AND dw.drink_by_year IS NOT NULL
        AND dw.drink_by_year < ?
      ORDER BY dw.drink_by_year ASC
    `, [currentYear]);
    
    for (const wine of pastWindow) {
      if (seenWineIds.has(wine.id)) continue;
      seenWineIds.add(wine.id);
      candidates.push({
        wine_id: wine.id,
        wine_name: wine.name,
        vintage: wine.vintage,
        producer: wine.producer,
        bottle_count: wine.bottle_count,
        priority: 1,
        reason: `Past drinking window (ended ${wine.drink_by_year})`,
        drink_by_year: wine.drink_by_year,
        window_source: wine.window_source,
        urgency: 'critical'
      });
    }
    
    // Priority 2: Wines within urgency threshold
    const closingWindow = await db.all(`
      SELECT DISTINCT
        w.id, w.name, w.vintage, w.producer, w.bottle_count,
        dw.drink_by_year, dw.source as window_source
      FROM wines w
      JOIN drinking_windows dw ON w.id = dw.wine_id
      WHERE w.bottle_count > 0
        AND dw.drink_by_year IS NOT NULL
        AND dw.drink_by_year >= ?
        AND dw.drink_by_year <= ?
      ORDER BY dw.drink_by_year ASC
    `, [currentYear, urgencyYear]);
    
    for (const wine of closingWindow) {
      if (seenWineIds.has(wine.id)) continue;
      seenWineIds.add(wine.id);
      const yearsRemaining = wine.drink_by_year - currentYear;
      candidates.push({
        wine_id: wine.id,
        wine_name: wine.name,
        vintage: wine.vintage,
        producer: wine.producer,
        bottle_count: wine.bottle_count,
        priority: 2,
        reason: yearsRemaining === 0 
          ? `Final year of drinking window (${wine.drink_by_year})`
          : `Drinking window closes ${wine.drink_by_year} (${yearsRemaining} year${yearsRemaining > 1 ? 's' : ''} left)`,
        drink_by_year: wine.drink_by_year,
        window_source: wine.window_source,
        urgency: yearsRemaining === 0 ? 'high' : 'medium'
      });
    }
    
    // Priority 3: Wines at peak year
    const atPeak = await db.all(`
      SELECT DISTINCT
        w.id, w.name, w.vintage, w.producer, w.bottle_count,
        dw.peak_year, dw.drink_by_year, dw.source as window_source
      FROM wines w
      JOIN drinking_windows dw ON w.id = dw.wine_id
      WHERE w.bottle_count > 0
        AND dw.peak_year = ?
    `, [currentYear]);
    
    for (const wine of atPeak) {
      if (seenWineIds.has(wine.id)) continue;
      seenWineIds.add(wine.id);
      candidates.push({
        wine_id: wine.id,
        wine_name: wine.name,
        vintage: wine.vintage,
        producer: wine.producer,
        bottle_count: wine.bottle_count,
        priority: 3,
        reason: `At peak drinking year (${wine.peak_year})`,
        peak_year: wine.peak_year,
        drink_by_year: wine.drink_by_year,
        window_source: wine.window_source,
        urgency: 'peak'
      });
    }
    
    // Priority 4: No window data but old vintage (fallback)
    if (includeNoWindow) {
      const noWindowOld = await db.all(`
        SELECT w.id, w.name, w.vintage, w.producer, w.bottle_count
        FROM wines w
        LEFT JOIN drinking_windows dw ON w.id = dw.wine_id
        WHERE w.bottle_count > 0
          AND dw.id IS NULL
          AND w.vintage IS NOT NULL
          AND (? - w.vintage) >= ?
      `, [currentYear, ageThreshold]);
      
      for (const wine of noWindowOld) {
        if (seenWineIds.has(wine.id)) continue;
        seenWineIds.add(wine.id);
        const age = currentYear - wine.vintage;
        candidates.push({
          wine_id: wine.id,
          wine_name: wine.name,
          vintage: wine.vintage,
          producer: wine.producer,
          bottle_count: wine.bottle_count,
          priority: 4,
          reason: `No drinking window data; vintage ${wine.vintage} is ${age} years old`,
          needs_window_data: true,
          urgency: 'unknown'
        });
      }
    }
    
    // Priority 5: Low rating (original logic, kept as fallback)
    const lowRated = await db.all(`
      SELECT w.id, w.name, w.vintage, w.producer, w.bottle_count,
             w.purchase_stars, w.vivino_rating
      FROM wines w
      LEFT JOIN drinking_windows dw ON w.id = dw.wine_id
      WHERE w.bottle_count > 0
        AND (w.purchase_stars < ? OR (w.purchase_stars IS NULL AND w.vivino_rating < ?))
    `, [ratingMinimum, ratingMinimum]);
    
    for (const wine of lowRated) {
      if (seenWineIds.has(wine.id)) continue;
      seenWineIds.add(wine.id);
      const rating = wine.purchase_stars || wine.vivino_rating;
      candidates.push({
        wine_id: wine.id,
        wine_name: wine.name,
        vintage: wine.vintage,
        producer: wine.producer,
        bottle_count: wine.bottle_count,
        priority: 5,
        reason: `Low rating (${rating} stars) - consider drinking soon`,
        urgency: 'low'
      });
    }
    
    res.json({
      candidates,
      settings_used: {
        urgency_months: urgencyMonths,
        include_no_window: includeNoWindow,
        age_threshold: ageThreshold,
        rating_minimum: ratingMinimum
      },
      summary: {
        total: candidates.length,
        critical: candidates.filter(c => c.urgency === 'critical').length,
        high: candidates.filter(c => c.urgency === 'high').length,
        medium: candidates.filter(c => c.urgency === 'medium').length,
        peak: candidates.filter(c => c.urgency === 'peak').length,
        unknown: candidates.filter(c => c.urgency === 'unknown').length
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

---

## 3. Search Extraction Changes

### 3.1 Drinking Window Patterns

Add to `searchProviders.js` or a new `windowParser.js`:

```javascript
const DRINKING_WINDOW_PATTERNS = [
  // "Drink 2024-2030" or "Drink 2024 - 2030"
  { 
    pattern: /drink\s*(\d{4})\s*[-–—to]+\s*(\d{4})/i,
    extract: (m) => ({ drink_from: parseInt(m[1]), drink_by: parseInt(m[2]) })
  },
  // "Best 2025-2035"
  { 
    pattern: /best\s*(\d{4})\s*[-–—to]+\s*(\d{4})/i,
    extract: (m) => ({ drink_from: parseInt(m[1]), drink_by: parseInt(m[2]) })
  },
  // "Drink now through 2028" or "Drink now-2028"
  { 
    pattern: /drink\s*now\s*(?:through|[-–—to]+)\s*(\d{4})/i,
    extract: (m, vintage) => ({ drink_from: new Date().getFullYear(), drink_by: parseInt(m[1]) })
  },
  // "Drink after 2026"
  { 
    pattern: /drink\s*after\s*(\d{4})/i,
    extract: (m) => ({ drink_from: parseInt(m[1]), drink_by: null })
  },
  // "Hold until 2025" or "Cellar until 2030"
  { 
    pattern: /(?:hold|cellar)\s*(?:until|till|to)\s*(\d{4})/i,
    extract: (m) => ({ drink_from: parseInt(m[1]), drink_by: null })
  },
  // "Drinking window: 2024-2030"
  { 
    pattern: /drinking\s*window[:\s]+(\d{4})\s*[-–—to]+\s*(\d{4})/i,
    extract: (m) => ({ drink_from: parseInt(m[1]), drink_by: parseInt(m[2]) })
  },
  // "Ready now" or "Drink now"
  { 
    pattern: /(?:ready|drink)\s*now(?!\s*(?:through|[-–—to]))/i,
    extract: (m, vintage) => ({ drink_from: new Date().getFullYear(), drink_by: null })
  },
  // "Past its peak" or "Drink up" or "Drink soon"
  { 
    pattern: /past\s*(?:its\s*)?peak|drink\s*up|drink\s*soon/i,
    extract: (m) => ({ drink_from: null, drink_by: new Date().getFullYear(), is_urgent: true })
  },
  // Relative: "Best in 3-7 years" (requires vintage)
  { 
    pattern: /best\s*in\s*(\d+)\s*[-–—to]+\s*(\d+)\s*years?/i,
    extract: (m, vintage) => vintage ? { 
      drink_from: vintage + parseInt(m[1]), 
      drink_by: vintage + parseInt(m[2]) 
    } : null
  },
  // "Peak 2027" or "Peak: 2027"
  { 
    pattern: /peak[:\s]+(\d{4})/i,
    extract: (m) => ({ peak: parseInt(m[1]) })
  }
];

/**
 * Parse drinking window from text
 * @param {string} text - Text to parse
 * @param {number|null} vintage - Wine vintage year for relative calculations
 * @returns {object|null} - { drink_from, drink_by, peak, raw_text } or null
 */
function parseDrinkingWindow(text, vintage = null) {
  if (!text) return null;
  
  for (const { pattern, extract } of DRINKING_WINDOW_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const result = extract(match, vintage);
      if (result) {
        return {
          ...result,
          raw_text: match[0]
        };
      }
    }
  }
  return null;
}

/**
 * Parse Vivino relative window format
 * @param {string} text - Vivino maturity text
 * @param {number} vintage - Wine vintage
 */
function parseVivinoWindow(text, vintage) {
  if (!text || !vintage) return null;
  
  // "Best in 3-7 years"
  const relativeMatch = text.match(/best\s*in\s*(\d+)\s*[-–—to]+\s*(\d+)\s*years?/i);
  if (relativeMatch) {
    return {
      drink_from: vintage + parseInt(relativeMatch[1]),
      drink_by: vintage + parseInt(relativeMatch[2]),
      raw_text: relativeMatch[0]
    };
  }
  
  // "Drink within 2 years"
  const withinMatch = text.match(/(?:drink|best)\s*within\s*(\d+)\s*years?/i);
  if (withinMatch) {
    const currentYear = new Date().getFullYear();
    return {
      drink_from: currentYear,
      drink_by: currentYear + parseInt(withinMatch[1]),
      raw_text: withinMatch[0]
    };
  }
  
  return null;
}

module.exports = { parseDrinkingWindow, parseVivinoWindow, DRINKING_WINDOW_PATTERNS };
```

### 3.2 Update Claude Extraction Prompt

In `claude.js`, update the extraction prompt (around line 477-531):

```javascript
const extractionPrompt = `
Extract wine ratings for "${wineName}" ${vintage || ''} from these pages.

For each rating found, provide a JSON object with:
- source: source identifier (e.g., "halliday", "vivino", "wine_spectator")
- lens: "competition" | "panel_guide" | "critic" | "community"
- score_type: "medal" | "points" | "stars" | "symbol"
- raw_score: exactly as shown (e.g., "Gold", "92", "4.2", "Tre Bicchieri")
- normalised_score: converted to 100-point scale if possible, otherwise null
- drinking_window: object or null, containing:
  - drink_from: year (integer) when wine becomes ready, or null
  - drink_by: year (integer) when wine should be consumed by, or null
  - peak: year (integer) when wine is at optimum, or null
  - raw_text: original text describing the window (e.g., "Drink 2024-2030")
- evidence_excerpt: brief quote proving the rating exists
- match_confidence: "high" | "medium" | "low"

Common drinking window formats to look for:
- "Drink 2024-2030" or "Drink 2024 to 2030"
- "Best now through 2028"
- "Drink after 2026" or "Hold until 2025"
- "Ready now" or "Drink now"
- "Peak 2027"
- "Past its peak" or "Drink up"
- Italian: "Bere entro il 2030" (drink by 2030)
- French: "À boire jusqu'en 2028" (drink until 2028)

Return as JSON array. If no ratings found, return empty array.
`;
```

### 3.3 Post-Processing: Save Windows

In `claude.js`, after extracting ratings, save drinking windows:

```javascript
async function saveExtractedWindows(wineId, ratings) {
  for (const rating of ratings) {
    if (rating.drinking_window && (rating.drinking_window.drink_from || rating.drinking_window.drink_by)) {
      try {
        await db.run(`
          INSERT INTO drinking_windows (wine_id, source, drink_from_year, drink_by_year, peak_year, confidence, raw_text, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(wine_id, source) DO UPDATE SET
            drink_from_year = excluded.drink_from_year,
            drink_by_year = excluded.drink_by_year,
            peak_year = excluded.peak_year,
            raw_text = excluded.raw_text,
            updated_at = CURRENT_TIMESTAMP
        `, [
          wineId,
          rating.source,
          rating.drinking_window.drink_from || null,
          rating.drinking_window.drink_by || null,
          rating.drinking_window.peak || null,
          rating.match_confidence || 'medium',
          rating.drinking_window.raw_text || null
        ]);
      } catch (err) {
        console.error(`Failed to save drinking window for ${rating.source}:`, err);
      }
    }
  }
}
```

---

## 4. Frontend Changes

### 4.1 Wine Modal: Display Drinking Window

Add to the wine detail modal in `index.html`:

```html
<div id="drinking-window-section" class="modal-section">
  <h4>Drinking Window</h4>
  <div id="drinking-window-display">
    <!-- Populated by JS -->
  </div>
  <div id="drinking-window-manual" class="manual-entry">
    <label>Set your own window:</label>
    <div class="window-inputs">
      <input type="number" id="manual-drink-from" placeholder="From" min="1900" max="2100">
      <span>to</span>
      <input type="number" id="manual-drink-by" placeholder="By" min="1900" max="2100">
      <button onclick="saveManualWindow()">Save</button>
    </div>
  </div>
</div>
```

### 4.2 JavaScript: Window Display Logic

Add to `bottles.js` or create `drinkingWindows.js`:

```javascript
async function loadDrinkingWindows(wineId) {
  const response = await fetch(`/api/wines/${wineId}/drinking-windows`);
  const windows = await response.json();
  
  const container = document.getElementById('drinking-window-display');
  
  if (windows.length === 0) {
    container.innerHTML = '<p class="no-data">No drinking window data. Fetch ratings or enter manually.</p>';
    return;
  }
  
  const currentYear = new Date().getFullYear();
  
  const html = windows.map(w => {
    const status = getWindowStatus(w, currentYear);
    return `
      <div class="window-entry ${status.class}">
        <span class="window-range">
          ${w.drink_from_year || '?'} – ${w.drink_by_year || '?'}
          ${w.peak_year ? `(peak ${w.peak_year})` : ''}
        </span>
        <span class="window-source">via ${w.source}</span>
        <span class="window-status">${status.text}</span>
        ${w.source === 'manual' ? `<button class="btn-small" onclick="deleteWindow(${wineId}, 'manual')">×</button>` : ''}
      </div>
    `;
  }).join('');
  
  container.innerHTML = html;
}

function getWindowStatus(window, currentYear) {
  const { drink_from_year, drink_by_year, peak_year } = window;
  
  if (drink_by_year && drink_by_year < currentYear) {
    return { class: 'status-critical', text: 'Past window' };
  }
  if (drink_by_year && drink_by_year === currentYear) {
    return { class: 'status-urgent', text: 'Final year' };
  }
  if (drink_by_year && drink_by_year <= currentYear + 1) {
    return { class: 'status-soon', text: `${drink_by_year - currentYear} year left` };
  }
  if (peak_year && peak_year === currentYear) {
    return { class: 'status-peak', text: 'At peak' };
  }
  if (drink_from_year && drink_from_year > currentYear) {
    return { class: 'status-hold', text: `Hold until ${drink_from_year}` };
  }
  if (drink_by_year) {
    return { class: 'status-ok', text: `${drink_by_year - currentYear} years left` };
  }
  return { class: 'status-unknown', text: 'Open window' };
}

async function saveManualWindow() {
  const wineId = getCurrentWineId(); // implement based on your modal state
  const drinkFrom = document.getElementById('manual-drink-from').value;
  const drinkBy = document.getElementById('manual-drink-by').value;
  
  if (!drinkFrom && !drinkBy) {
    alert('Enter at least one year');
    return;
  }
  
  await fetch(`/api/wines/${wineId}/drinking-windows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: 'manual',
      drink_from_year: drinkFrom ? parseInt(drinkFrom) : null,
      drink_by_year: drinkBy ? parseInt(drinkBy) : null,
      confidence: 'high'
    })
  });
  
  loadDrinkingWindows(wineId);
}

async function deleteWindow(wineId, source) {
  await fetch(`/api/wines/${wineId}/drinking-windows/${source}`, { method: 'DELETE' });
  loadDrinkingWindows(wineId);
}
```

### 4.3 CSS Styles

Add to your stylesheet:

```css
/* Drinking Window Styles */
.drinking-window-section {
  margin: 1rem 0;
  padding: 1rem;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
}

.window-entry {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem;
  margin: 0.25rem 0;
  border-radius: 4px;
  font-size: 0.9rem;
}

.window-range {
  font-weight: 600;
  min-width: 120px;
}

.window-source {
  color: #666;
  font-size: 0.8rem;
}

.window-status {
  margin-left: auto;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.8rem;
  font-weight: 500;
}

.status-critical { background: #fee; }
.status-critical .window-status { background: #c00; color: white; }

.status-urgent { background: #fff3e0; }
.status-urgent .window-status { background: #f57c00; color: white; }

.status-soon { background: #fff8e1; }
.status-soon .window-status { background: #ffa000; color: white; }

.status-peak { background: #fff9c4; }
.status-peak .window-status { background: #fbc02d; color: #333; }

.status-hold { background: #e3f2fd; }
.status-hold .window-status { background: #1976d2; color: white; }

.status-ok { background: #e8f5e9; }
.status-ok .window-status { background: #388e3c; color: white; }

.status-unknown { background: #f5f5f5; }
.status-unknown .window-status { background: #9e9e9e; color: white; }

.manual-entry {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px dashed #ccc;
}

.window-inputs {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.window-inputs input {
  width: 80px;
  padding: 0.25rem 0.5rem;
}
```

### 4.4 Settings Panel Updates

Add to the Settings tab in `index.html`:

```html
<div class="settings-section">
  <h4>Drinking Window Rules</h4>
  
  <div class="setting-row">
    <label for="urgency-months">Flag wines closing within:</label>
    <select id="urgency-months">
      <option value="6">6 months</option>
      <option value="12">12 months</option>
      <option value="18">18 months</option>
      <option value="24">24 months</option>
      <option value="36">36 months</option>
    </select>
  </div>
  
  <div class="setting-row">
    <label>
      <input type="checkbox" id="include-no-window">
      Include wines without drinking window data (uses age fallback)
    </label>
  </div>
  
  <div class="setting-row">
    <label>Window source priority:</label>
    <p class="hint">Drag to reorder. First available source wins.</p>
    <ul id="source-priority-list" class="sortable-list">
      <!-- Populated by JS -->
    </ul>
  </div>
</div>
```

Update `settings.js` to handle new settings:

```javascript
async function loadWindowSettings() {
  const settings = await getSettings();
  
  document.getElementById('urgency-months').value = settings.reduce_window_urgency_months || '12';
  document.getElementById('include-no-window').checked = settings.reduce_include_no_window === 'true';
  
  const priority = JSON.parse(settings.reduce_window_source_priority || '["manual","halliday","vivino"]');
  renderSourcePriorityList(priority);
}

function renderSourcePriorityList(priority) {
  const list = document.getElementById('source-priority-list');
  const sourceNames = {
    manual: 'Manual entry',
    halliday: 'Halliday',
    wine_spectator: 'Wine Spectator',
    decanter: 'Decanter',
    vivino: 'Vivino',
    gambero_rosso: 'Gambero Rosso',
    guia_penin: 'Guía Peñín'
  };
  
  list.innerHTML = priority.map(source => `
    <li data-source="${source}" draggable="true">${sourceNames[source] || source}</li>
  `).join('');
  
  // Add drag-and-drop handlers
  initSortable(list, saveSourcePriority);
}

async function saveSourcePriority() {
  const list = document.getElementById('source-priority-list');
  const priority = Array.from(list.children).map(li => li.dataset.source);
  await updateSetting('reduce_window_source_priority', JSON.stringify(priority));
}
```

---

## 5. API Wrapper Updates

Add to `api.js`:

```javascript
// Drinking Windows API
async function getDrinkingWindows(wineId) {
  const response = await fetch(`/api/wines/${wineId}/drinking-windows`);
  return response.json();
}

async function saveDrinkingWindow(wineId, windowData) {
  const response = await fetch(`/api/wines/${wineId}/drinking-windows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(windowData)
  });
  return response.json();
}

async function deleteDrinkingWindow(wineId, source) {
  const response = await fetch(`/api/wines/${wineId}/drinking-windows/${source}`, {
    method: 'DELETE'
  });
  return response.json();
}

async function getUrgentWines(months = 12) {
  const response = await fetch(`/api/drinking-windows/urgent?months=${months}`);
  return response.json();
}
```

---

## 6. File Summary

| File | Action |
|------|--------|
| `migrations/007_drinking_windows.sql` | Create new |
| `drinkingWindows.js` (routes) | Create new |
| `reduceNow.js` | Update evaluate endpoint |
| `searchProviders.js` or `windowParser.js` | Add window parsing functions |
| `claude.js` | Update extraction prompt, add saveExtractedWindows() |
| `index.html` | Add window display in modal, update settings panel |
| `bottles.js` or `drinkingWindows.js` (frontend) | Add window display/edit functions |
| `settings.js` | Add window settings handlers |
| `api.js` | Add window API wrappers |
| `styles.css` | Add window status styles |

---

## 7. Testing Checklist

After implementation, verify:

| Test | Expected Result |
|------|-----------------|
| Run migration | `drinking_windows` table created, settings inserted |
| Fetch ratings for wine with known window | Window extracted and saved |
| View wine modal | Drinking window displayed with status |
| Add manual window | Saves as source "manual", displays first |
| Delete manual window | Removed from display |
| Run evaluate with wines past window | Returns as priority 1, urgency "critical" |
| Run evaluate with wines at peak | Returns as priority 3, urgency "peak" |
| Change urgency months setting | Evaluate returns different candidates |
| Reorder source priority | Affects which window displays as primary |

---

## 8. Future Enhancements

- **Maturity curve visualisation**: Show timeline graphic of drinking window
- **Notifications**: Alert when wines enter urgent zone
- **Bulk window fetch**: "Refresh all windows" button to re-fetch for cellar
- **Window aggregation**: When multiple sources disagree, show consensus range
- **Regional defaults**: If no window found, estimate based on wine type/region
